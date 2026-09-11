// Bitunix — perpetual futures only (their public API is futures-focused;
// no spot public WS endpoint was found in their docs). Verified against
// bitunix.com/api-docs/futures/websocket.
//
// IMPORTANT DIFFERENCE FROM BINANCE/BYBIT: Bitunix's kline push message
// carries only a push timestamp (`ts`) and the current OHLCV for that
// timestamp — no candle open-time and no "closed"/"confirm" flag. Candle
// boundaries and close detection are therefore INFERRED here (bucket =
// ts floored to a fixed interval length in ms), not exchange-confirmed.
//
// THIS IS WHY "1M" (month) IS EXCLUDED FROM THE LIVE SET BELOW even though
// Bitunix's WS channel technically offers it (market_kline_1month) and the
// REST backfill (services/backfillRunner.js) fully supports it: months
// aren't a fixed number of milliseconds (28-31 days), so the fixed-bucket
// flooring this adapter relies on would misalign monthly candle
// boundaries. Historical 1M data for Bitunix still works fine via
// backfill/on-demand — it just won't get live in-progress updates. Every
// other timeframe down to 1m has a fixed, exact ms duration, so the same
// inference approach is safe for all of them.
//
// Sharded across multiple connections (see ../sharding.js), with symbols
// addable live post-startup — see registerActivationHandler below, which
// is what makes on-demand-activated symbols (routes/candles.js) start
// streaming immediately instead of only after the next full restart.

import WebSocket from "ws";
import { upsertCandle, getActiveSymbols } from "../../db/candles.js";
import { createShardGroup, addSymbolToShardGroup } from "./sharding.js";
import { onActivation } from "../activationBus.js";
import { timeframesFor } from "../timeframes.js";

const RECONNECT_DELAY_MS = 5000;
const PING_INTERVAL_MS = 20000;
const WS_URL = "wss://fapi.bitunix.com/public/";

const TF_TO_CHANNEL = {
  "1m": "market_kline_1min", "3m": "market_kline_3min", "5m": "market_kline_5min",
  "15m": "market_kline_15min", "30m": "market_kline_30min", "1h": "market_kline_60min",
  "2h": "market_kline_2h", "4h": "market_kline_4h", "6h": "market_kline_6h",
  "8h": "market_kline_8h", "12h": "market_kline_12h", "1d": "market_kline_1day",
  "3d": "market_kline_3day", "1w": "market_kline_1week",
  // "1M" intentionally omitted — see file header.
};
const CHANNEL_TO_TF = Object.fromEntries(Object.entries(TF_TO_CHANNEL).map(([tf, ch]) => [ch, tf]));
const TF_TO_MS = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};
// The live-streamable set — everything Bitunix supports minus 1M (see
// header comment). Backfill uses the full set from timeframesFor directly
// since it doesn't go through this bucket-inference logic at all.
const TIMEFRAMES = timeframesFor("bitunix", "perp").filter((tf) => tf !== "1M");

function buildSubscribeForSymbol(symbol) {
  return { op: "subscribe", args: TIMEFRAMES.map((tf) => ({ symbol, ch: TF_TO_CHANNEL[tf] })) };
}

export async function startBitunixRelay({ broadcastCandle }) {
  const marketType = "perp";
  const symbols = await getActiveSymbols("bitunix", marketType);
  if (symbols.length === 0) {
    console.warn("No active bitunix/perp symbols at startup — relay idle until one activates on-demand");
  }

  const group = createShardGroup(
    symbols,
    TIMEFRAMES.length,
    (shard, shardIndex) => connect(shard, shardIndex, broadcastCandle),
    { label: "Bitunix perp relay" }
  );

  onActivation(({ exchange, marketType: mt, symbol }) => {
    if (exchange === "bitunix" && mt === marketType) {
      addSymbolToShardGroup(group, symbol, buildSubscribeForSymbol);
    }
  });

  return group;
}

function connect(shard, shardIndex, broadcastCandle) {
  const ws = new WebSocket(WS_URL);
  let pingTimer;
  // key `${symbol}:${tf}` -> last seen {bucket, candle}, so we can detect
  // when a new bucket starts and treat the prior one as closed.
  const lastSeen = new Map();

  ws.on("open", () => {
    shard.ws = ws;
    console.log(`Bitunix perp relay [shard ${shardIndex}] connected — ${shard.symbols.length} symbols x ${TIMEFRAMES.length} timeframes`);
    const args = shard.symbols.flatMap((symbol) => TIMEFRAMES.map((tf) => ({ symbol, ch: TF_TO_CHANNEL[tf] })));
    for (let i = 0; i < args.length; i += 50) {
      ws.send(JSON.stringify({ op: "subscribe", args: args.slice(i, i + 50) }));
    }
    pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op: "ping", ping: Math.floor(Date.now() / 1000) }));
    }, PING_INTERVAL_MS);
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const tf = CHANNEL_TO_TF[msg.ch];
    if (!tf || !msg.data || !msg.symbol) return;

    const symbol = msg.symbol;
    const intervalMs = TF_TO_MS[tf];
    const bucket = Math.floor(Number(msg.ts) / intervalMs) * intervalMs;
    const candle = { openTime: bucket, o: Number(msg.data.o), h: Number(msg.data.h), l: Number(msg.data.l), c: Number(msg.data.c), v: Number(msg.data.b) };
    const key = `${symbol}:${tf}`;
    const prev = lastSeen.get(key);

    broadcastCandle("bitunix", "perp", symbol, tf, candle, false);

    if (prev && prev.bucket !== bucket) {
      broadcastCandle("bitunix", "perp", symbol, tf, prev.candle, true);
      try {
        await upsertCandle({ exchange: "bitunix", marketType: "perp", symbol, timeframe: tf, openTimeMs: prev.candle.openTime, o: prev.candle.o, h: prev.candle.h, l: prev.candle.l, c: prev.candle.c, v: prev.candle.v });
      } catch (err) {
        console.error(`Failed to write bitunix/perp candle ${symbol} ${tf}`, err);
      }
    }
    lastSeen.set(key, { bucket, candle });
  });

  ws.on("close", () => {
    shard.ws = null;
    clearInterval(pingTimer);
    console.warn(`Bitunix perp relay [shard ${shardIndex}] disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connect(shard, shardIndex, broadcastCandle), RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error(`Bitunix perp relay [shard ${shardIndex}] error`, err.message);
    ws.close();
  });
}
