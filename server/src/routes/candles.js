// GET /candles?symbol=BTCUSDT&tf=15m&exchange=binance&marketType=spot&limit=200&before=<ms>
// Serves historical candles for the initial chart load and for paging in
// older history as the user pans left, before the WebSocket subscription
// takes over for live updates.
//
// exchange/marketType default to binance/spot so existing frontend calls
// that don't pass them yet keep working unchanged.
//
// `before` (optional, ms epoch) fetches candles strictly older than that
// timestamp — this is how the frontend loads more history on demand
// instead of being capped at whatever the initial page returned.
//
// tf can be ANY valid interval string (e.g. 15m, 4h, 1d — or a fully
// custom one like 7m, 13h, 2d, 3M):
//   - If it's natively offered by this exchange/marketType (see
//     services/timeframes.js), it's read directly from stored candles —
//     exact, exchange-confirmed data.
//   - Otherwise (including exchange gaps like Bybit's missing 8h/3d, and
//     truly custom sizes no exchange offers) it's synthesized on the fly
//     by rolling up 1-minute candles (see services/aggregate.js). This
//     caps a non-native interval's available history at however deep our
//     1-minute data goes (90 days), even where a native equivalent at a
//     coarser grain might go back years.
//
// On-demand activation: the symbols table holds thousands of discovered
// pairs, but only a curated "core" set is actively relayed/stored at any
// time (see services/pruner.js) — this is what keeps a free-tier Postgres
// from filling up the way it did before. When someone requests a symbol
// that isn't yet active, this route flips it on, kicks off a background
// backfill so history starts populating, AND emits an activation event
// (see services/activationBus.js) so the live relay subscribes it
// immediately rather than only picking it up on the next restart.

import { Router } from "express";
import { pool } from "../db/pool.js";
import { runBackfill } from "../services/backfillRunner.js";
import { emitActivation } from "../services/activationBus.js";
import { supportsTimeframe } from "../services/timeframes.js";
import { parseCustomTimeframe, aggregateCandles, rawMinuteLimitFor } from "../services/aggregate.js";

const router = Router();

async function readStoredCandles({ pair, tf, exchange, marketType, beforeMs, limit }) {
  const conditions = ["symbol = $1", "timeframe = $2", "exchange = $3", "market_type = $4"];
  const params = [pair, tf, exchange, marketType];
  if (beforeMs) {
    params.push(new Date(beforeMs).toISOString());
    conditions.push(`open_time < $${params.length}`);
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT open_time, open, high, low, close, volume
     FROM candles
     WHERE ${conditions.join(" AND ")}
     ORDER BY open_time DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.reverse(); // ascending
}

router.get("/", async (req, res) => {
  const { symbol, tf, limit = "200", exchange = "binance", marketType = "spot", before } = req.query;

  if (!symbol || !tf) {
    return res.status(400).json({ error: "symbol and tf are required" });
  }
  const parsedTf = parseCustomTimeframe(tf);
  if (!parsedTf) {
    return res.status(400).json({ error: `tf must look like e.g. 15m, 4h, 1d, 1w, 1M, or a custom interval like 7m, 13h, 2d` });
  }
  const parsedLimit = Math.min(Number(limit) || 200, 2000);
  const beforeMs = before ? Number(before) : null;
  if (before && (Number.isNaN(beforeMs) || beforeMs <= 0)) {
    return res.status(400).json({ error: "before must be a positive epoch-ms timestamp" });
  }
  const pair = symbol.toUpperCase();

  try {
    // Touch last_requested_at on every request (keeps the pruner from
    // deactivating something actively being viewed), and detect + flip on
    // a currently-inactive symbol in the same round trip.
    const { rows: symRows } = await pool.query(
      `UPDATE symbols SET last_requested_at = now()
       WHERE exchange = $1 AND market_type = $2 AND pair = $3
       RETURNING active`,
      [exchange, marketType, pair]
    );

    if (symRows.length > 0 && symRows[0].active === false) {
      await pool.query(
        `UPDATE symbols SET active = true WHERE exchange = $1 AND market_type = $2 AND pair = $3`,
        [exchange, marketType, pair]
      );
      console.log(`On-demand activation: ${exchange}/${marketType} ${pair} — starting background backfill + live subscribe`);
      // Live subscribe — the relay (if running for this exchange/marketType,
      // which it always is now, see exchanges/index.js) picks this up
      // immediately instead of waiting for a restart.
      emitActivation({ exchange, marketType, symbol: pair });
      // Fire-and-forget — backfills every native timeframe this
      // exchange/symbol supports (1m included), which is also what feeds
      // the aggregation fallback below.
      runBackfill({ exchangeFilter: exchange, symbolFilter: pair }).catch((err) =>
        console.error(`Background backfill failed for ${exchange}/${marketType} ${pair}`, err)
      );
    }

    if (supportsTimeframe(exchange, marketType, tf)) {
      const rows = await readStoredCandles({ pair, tf, exchange, marketType, beforeMs, limit: parsedLimit });
      return res.json(rows);
    }

    // Non-native (exchange gap like Bybit's 8h, or fully custom like
    // "7m") — synthesize from 1-minute candles.
    const rawLimit = rawMinuteLimitFor(parsedLimit, parsedTf);
    const rawRows = await readStoredCandles({ pair, tf: "1m", exchange, marketType, beforeMs, limit: rawLimit });
    const rawCandles = rawRows.map((r) => ({
      t: new Date(r.open_time).getTime(),
      o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume),
    }));
    const aggregated = aggregateCandles(rawCandles, parsedTf.count, parsedTf.unit).slice(-parsedLimit);
    res.json(
      aggregated.map((c) => ({
        open_time: new Date(c.t).toISOString(), open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v,
      }))
    );
  } catch (err) {
    console.error("Failed to fetch candles", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
