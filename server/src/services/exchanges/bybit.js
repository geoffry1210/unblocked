// Bybit V5 unified WebSocket — spot and linear (USDT-margined) perpetuals.
//
// *** TEMPORARY DIAGNOSTIC LOGGING ADDED — see lines marked [DIAG] ***
// See binance.js's file header for the full rationale — same instrumentation
// pattern here: a per-shard message heartbeat plus explicit write
// attempt/success logging. Remove all [DIAG] lines once the root cause of
// the week-long write silence is found and fixed.
//
// Verified against Bybit's public API docs (bybit-exchange.github.io).
//
// Bybit's kline interval strings differ from Binance's ("60" not "1h", "D"
// not "1d") — TF_TO_BYBIT handles the translation. Bybit's real supported
// range has no 1s and no 8h (its hour steps are 1/2/4/6/12h only — see
// services/timeframes.js), unlike Binance/Bitunix which both have 8h.
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
const DIAG_HEARTBEAT_MS = 30000; // [DIAG]

const HOSTS = {
  spot: "wss://stream.bybit.com/v5/public/spot",
  perp: "wss://stream.bybit.com/v5/public/linear",
};

const TF_TO_BYBIT = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720",
  "1d": "D", "1w": "W", "1M": "M",
};
const BYBIT_TO_TF = Object.fromEntries(Object.entries(TF_TO_BYBIT).map(([tf, b]) => [b, tf]));

function buildSubscribeForSymbol(marketType, symbol) {
  const args = timeframesFor("bybit", marketType).map((tf) => `kline.${TF_TO_BYBIT[tf]}.${symbol}`);
  return { op: "subscribe", args };
}

export async function startBybitRelay({ marketType, broadcastCandle }) {
  const timeframes = timeframesFor("bybit", marketType);
  const symbols = await getActiveSymbols("bybit", marketType);
  if (symbols.length === 0) {
    console.warn(`No active bybit/${marketType} symbols at startup — relay idle until one activates on-demand`);
  }

  const group = createShardGroup(
    symbols,
    timeframes.length,
    (shard, shardIndex) => connect(marketType, timeframes, shard, shardIndex, broadcastCandle),
    { label: `Bybit ${marketType} relay` }
  );

  onActivation(({ exchange, marketType: mt, symbol }) => {
    if (exchange === "bybit" && mt === marketType) {
      addSymbolToShardGroup(group, symbol, (sym) => buildSubscribeForSymbol(marketType, sym));
    }
  });

  return group;
}

function connect(marketType, timeframes, shard, shardIndex, broadcastCandle) {
  const ws = new WebSocket(HOSTS[marketType]);
  let pingTimer;
  let msgCount = 0; // [DIAG]
  let klineCount = 0; // [DIAG]

  const heartbeat = setInterval(() => { // [DIAG]
    console.log(`[DIAG] Bybit ${marketType} [shard ${shardIndex}]: ${msgCount} raw messages, ${klineCount} kline events in last ${DIAG_HEARTBEAT_MS / 1000}s`);
    msgCount = 0;
    klineCount = 0;
  }, DIAG_HEARTBEAT_MS); // [DIAG]

  ws.on("open", () => {
    shard.ws = ws;
    console.log(`Bybit ${marketType} relay [shard ${shardIndex}] connected — ${shard.symbols.length} symbols x ${timeframes.length} timeframes`);
    const args = shard.symbols.flatMap((symbol) => timeframes.map((tf) => `kline.${TF_TO_BYBIT[tf]}.${symbol}`));
    for (let i = 0; i < args.length; i += 50) {
      ws.send(JSON.stringify({ op: "subscribe", args: args.slice(i, i + 50) }));
    }
    console.log(`[DIAG] Bybit ${marketType} [shard ${shardIndex}]: sent ${Math.ceil(args.length / 50)} subscribe message(s) covering ${args.length} topics`); // [DIAG]
    pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op: "ping" }));
    }, PING_INTERVAL_MS);
  });

  ws.on("message", async (raw) => {
    msgCount++; // [DIAG]
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.log(`[DIAG] Bybit ${marketType} [shard ${shardIndex}]: non-JSON message, ${err.message}`); // [DIAG]
      return;
    }
    if (!msg.topic?.startsWith("kline.") || !Array.isArray(msg.data)) {
      if (msg.op !== "pong" && msg.op !== "subscribe" && msg.success === undefined) {
        console.log(`[DIAG] Bybit ${marketType} [shard ${shardIndex}]: unrecognized message shape:`, JSON.stringify(msg).slice(0, 200)); // [DIAG]
      }
      return;
    }

    const [, bybitInterval, symbol] = msg.topic.split(".");
    const timeframe = BYBIT_TO_TF[bybitInterval];
    if (!timeframe) return;
    klineCount++; // [DIAG]

    for (const k of msg.data) {
      const candle = { openTime: Number(k.start), o: Number(k.open), h: Number(k.high), l: Number(k.low), c: Number(k.close), v: Number(k.volume) };
      broadcastCandle("bybit", marketType, symbol, timeframe, candle, k.confirm);

      if (k.confirm) {
        console.log(`[DIAG] Bybit ${marketType} [shard ${shardIndex}]: candle CLOSE detected ${symbol} ${timeframe} @${candle.openTime} — attempting write`); // [DIAG]
        try {
          await upsertCandle({ exchange: "bybit", marketType, symbol, timeframe, openTimeMs: candle.openTime, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
          console.log(`[DIAG] Bybit ${marketType} [shard ${shardIndex}]: write SUCCEEDED ${symbol} ${timeframe} @${candle.openTime}`); // [DIAG]
        } catch (err) {
          console.error(`Failed to write bybit/${marketType} candle ${symbol} ${timeframe}`, err);
        }
      }
    }
  });

  ws.on("close", () => {
    shard.ws = null;
    clearInterval(pingTimer);
    clearInterval(heartbeat); // [DIAG]
    console.warn(`Bybit ${marketType} relay [shard ${shardIndex}] disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connect(marketType, timeframes, shard, shardIndex, broadcastCandle), RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error(`Bybit ${marketType} relay [shard ${shardIndex}] error`, err.message);
    ws.close();
  });
}
