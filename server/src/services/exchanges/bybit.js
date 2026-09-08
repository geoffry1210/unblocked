// Bybit V5 unified WebSocket — spot and linear (USDT-margined) perpetuals.
// Verified against Bybit's public API docs (bybit-exchange.github.io).
//
// Bybit's kline interval strings differ from Binance's ("60" not "1h",
// "D" not "1d") — TF_MAP handles the translation both ways.
//
// Sharded across multiple connections (see ../sharding.js), with symbols
// addable live post-startup — see registerActivationHandler below, which
// is what makes on-demand-activated symbols (routes/candles.js) start
// streaming immediately instead of only after the next full restart.

import WebSocket from "ws";
import { upsertCandle, getActiveSymbols } from "../../db/candles.js";
import { createShardGroup, addSymbolToShardGroup } from "./sharding.js";
import { onActivation } from "../activationBus.js";

const RECONNECT_DELAY_MS = 5000;
const PING_INTERVAL_MS = 20000;

const HOSTS = {
  spot: "wss://stream.bybit.com/v5/public/spot",
  perp: "wss://stream.bybit.com/v5/public/linear",
};

// our timeframe -> bybit interval string
const TF_TO_BYBIT = { "1m": "1", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
const BYBIT_TO_TF = Object.fromEntries(Object.entries(TF_TO_BYBIT).map(([tf, b]) => [b, tf]));
const TIMEFRAMES = Object.keys(TF_TO_BYBIT);

function buildSubscribeForSymbol(symbol) {
  const args = TIMEFRAMES.map((tf) => `kline.${TF_TO_BYBIT[tf]}.${symbol}`);
  return { op: "subscribe", args };
}

export async function startBybitRelay({ marketType, broadcastCandle }) {
  const symbols = await getActiveSymbols("bybit", marketType);
  if (symbols.length === 0) {
    console.warn(`No active bybit/${marketType} symbols at startup — relay idle until one activates on-demand`);
  }

  const group = createShardGroup(
    symbols,
    TIMEFRAMES.length,
    (shard, shardIndex) => connect(marketType, shard, shardIndex, broadcastCandle),
    { label: `Bybit ${marketType} relay` }
  );

  onActivation(({ exchange, marketType: mt, symbol }) => {
    if (exchange === "bybit" && mt === marketType) {
      addSymbolToShardGroup(group, symbol, buildSubscribeForSymbol);
    }
  });

  return group;
}

function connect(marketType, shard, shardIndex, broadcastCandle) {
  const ws = new WebSocket(HOSTS[marketType]);
  let pingTimer;

  ws.on("open", () => {
    shard.ws = ws;
    console.log(`Bybit ${marketType} relay [shard ${shardIndex}] connected — ${shard.symbols.length} symbols x ${TIMEFRAMES.length} timeframes`);
    const args = shard.symbols.flatMap((symbol) => TIMEFRAMES.map((tf) => `kline.${TF_TO_BYBIT[tf]}.${symbol}`));
    for (let i = 0; i < args.length; i += 50) {
      ws.send(JSON.stringify({ op: "subscribe", args: args.slice(i, i + 50) }));
    }
    pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op: "ping" }));
    }, PING_INTERVAL_MS);
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg.topic?.startsWith("kline.") || !Array.isArray(msg.data)) return;

    const [, bybitInterval, symbol] = msg.topic.split(".");
    const timeframe = BYBIT_TO_TF[bybitInterval];
    if (!timeframe) return;

    for (const k of msg.data) {
      const candle = { openTime: Number(k.start), o: Number(k.open), h: Number(k.high), l: Number(k.low), c: Number(k.close), v: Number(k.volume) };
      broadcastCandle("bybit", marketType, symbol, timeframe, candle, k.confirm);

      if (k.confirm) {
        try {
          await upsertCandle({ exchange: "bybit", marketType, symbol, timeframe, openTimeMs: candle.openTime, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
        } catch (err) {
          console.error(`Failed to write bybit/${marketType} candle ${symbol} ${timeframe}`, err);
        }
      }
    }
  });

  ws.on("close", () => {
    shard.ws = null;
    clearInterval(pingTimer);
    console.warn(`Bybit ${marketType} relay [shard ${shardIndex}] disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connect(marketType, shard, shardIndex, broadcastCandle), RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error(`Bybit ${marketType} relay [shard ${shardIndex}] error`, err.message);
    ws.close();
  });
}
