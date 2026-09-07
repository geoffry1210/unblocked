// Discovers every USDT/USD/USDC-quoted, currently-tradable pair on each
// live exchange/market-type and upserts them into the `symbols` table.
//
// IMPORTANT: newly-discovered symbols are inserted INACTIVE. Symbol
// discovery and relay activation are deliberately separate now — this
// table can (and should) hold every pair that exists, but only a small
// curated "core" set plus whatever's been on-demand-activated recently
// (see routes/candles.js, services/pruner.js) is ever actually relayed or
// has candles stored. Running this sync again does NOT reactivate
// anything that was previously live and got pruned for going idle — that
// used to be exactly the bug that filled a free-tier Postgres and crashed
// the relay from holding thousands of live subscriptions in memory.
//
// This does NOT deactivate symbols that disappear from a given sync pass —
// deliberately conservative, so a transient API hiccup on one exchange
// can't silently wipe out the whole symbol list. Revisit if stale/delisted
// pairs actually become a problem in practice.

import { pool } from "../db/pool.js";

const FETCH_TIMEOUT_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err.name === "AbortError";
      const label = timedOut ? `timed out after ${FETCH_TIMEOUT_MS}ms` : err.message;
      if (attempt === retries) throw new Error(label);
      await sleep(500 * (attempt + 1));
    }
  }
}

const ALLOWED_QUOTES = new Set(["USDT", "USDC", "USD"]);

async function discoverBinanceSpot() {
  const json = await fetchJson("https://api.binance.com/api/v3/exchangeInfo");
  return json.symbols
    .filter((s) => s.status === "TRADING" && ALLOWED_QUOTES.has(s.quoteAsset))
    .map((s) => ({ pair: s.symbol, display: `${s.baseAsset}/${s.quoteAsset}`, exchange: "binance", marketType: "spot" }));
}

async function discoverBinancePerp() {
  const json = await fetchJson("https://fapi.binance.com/fapi/v1/exchangeInfo");
  return json.symbols
    .filter((s) => s.status === "TRADING" && s.contractType === "PERPETUAL" && ALLOWED_QUOTES.has(s.quoteAsset))
    .map((s) => ({ pair: s.symbol, display: `${s.baseAsset}/${s.quoteAsset}`, exchange: "binance", marketType: "perp" }));
}

// Bybit's instruments-info paginates for large categories — follow
// nextPageCursor until it's empty.
async function fetchBybitAll(category) {
  const all = [];
  let cursor = "";
  for (;;) {
    const url = `https://api.bybit.com/v5/market/instruments-info?category=${category}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const json = await fetchJson(url);
    const list = json?.result?.list || [];
    all.push(...list);
    cursor = json?.result?.nextPageCursor;
    if (!cursor || list.length === 0) break;
    await sleep(150);
  }
  return all;
}

async function discoverBybitSpot() {
  const list = await fetchBybitAll("spot");
  return list
    .filter((s) => s.status === "Trading" && ALLOWED_QUOTES.has(s.quoteCoin))
    .map((s) => ({ pair: s.symbol, display: `${s.baseCoin}/${s.quoteCoin}`, exchange: "bybit", marketType: "spot" }));
}

async function discoverBybitPerp() {
  const list = await fetchBybitAll("linear");
  return list
    .filter((s) => s.status === "Trading" && s.contractType === "LinearPerpetual" && ALLOWED_QUOTES.has(s.quoteCoin))
    .map((s) => ({ pair: s.symbol, display: `${s.baseCoin}/${s.quoteCoin}`, exchange: "bybit", marketType: "perp" }));
}

async function discoverBitunixPerp() {
  const json = await fetchJson("https://fapi.bitunix.com/api/v1/futures/market/trading_pairs");
  const list = json?.data || [];
  return list
    .filter((s) => s.symbolStatus === "OPEN" && ALLOWED_QUOTES.has(s.quote))
    .map((s) => ({ pair: s.symbol, display: `${s.base}/${s.quote}`, exchange: "bitunix", marketType: "perp" }));
}

const DISCOVERERS = [
  { name: "binance/spot", fn: discoverBinanceSpot },
  { name: "binance/perp", fn: discoverBinancePerp },
  { name: "bybit/spot", fn: discoverBybitSpot },
  { name: "bybit/perp", fn: discoverBybitPerp },
  { name: "bitunix/perp", fn: discoverBitunixPerp },
];

export async function syncSymbols({ onProgress = () => {} } = {}) {
  let totalUpserted = 0;
  const perExchange = {};

  for (const { name, fn } of DISCOVERERS) {
    try {
      const pairs = await fn();
      let count = 0;
      for (const p of pairs) {
        // Only inserts as inactive metadata on first discovery; on
        // conflict (already known), touches display only — never flips
        // active state either way, so this can run as often as needed
        // without undoing the pruner or reactivating stale symbols.
        await pool.query(
          `INSERT INTO symbols (pair, display, exchange, market_type, active)
           VALUES ($1, $2, $3, $4, false)
           ON CONFLICT (exchange, market_type, pair)
           DO UPDATE SET display = EXCLUDED.display`,
          [p.pair, p.display, p.exchange, p.marketType]
        );
        count++;
      }
      perExchange[name] = count;
      totalUpserted += count;
      onProgress(`${name}: ${count} pairs (USDT/USD/USDC) synced`);
    } catch (err) {
      onProgress(`${name}: FAILED — ${err.message}`);
      perExchange[name] = `FAILED: ${err.message}`;
    }
  }

  const summary = `Done. ${totalUpserted} symbols discovered across ${DISCOVERERS.length} exchange/market combos (inactive by default — request a chart for one to activate it, or use /internal/symbols to bulk-activate).`;
  onProgress(summary);
  return { totalUpserted, perExchange, summary };
}
