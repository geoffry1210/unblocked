// Binance — spot and USDT-margined perpetual futures.
//
// Both products expose the identical combined-stream kline schema; only the
// WebSocket host differs (spot: stream.binance.com, perp: fstream.binance.com).
// Interval strings match ours exactly (1s,1m,3m,...,1M) — spot supports the
// full range including 1s; perp starts at 1m (see services/timeframes.js).
//
// Streams are subscribed via the SUBSCRIBE method sent after connecting,
// not embedded in the connection URL — the URL-embedded style breaks once
// the symbol list grows into the hundreds (URL too long to open).
//
// Sharded across multiple connections (see ../sharding.js) so no single
// connection's subscription count gets close to Binance's per-connection
// ceiling, and symbols can be added live post-startup — see
// registerActivationHandler below, which is what makes on-demand-activated
// symbols (routes/candles.js) start streaming immediately instead of only
// after the next full restart.

import WebSocket from "ws";
import { upsertCandle, getActiveSymbols } from "../../db/candles.js";
import { createShardGroup, addSymbolToShardGroup } from "./sharding.js";
import { onActivation } from "../activationBus.js";
import { timeframesFor } from "../timeframes.js";

const RECONNECT_DELAY_MS = 5000;

const HOSTS = {
  spot: "wss://stream.binance.com:9443/stream",
  perp: "wss://fstream.binance.com/stream",
};

function buildSubscribeForSymbol(marketType, symbol) {
  const streams = timeframesFor("binance", marketType).map((tf) => `${symbol.toLowerCase()}@kline_${tf}`);
  return { method: "SUBSCRIBE", params: streams, id: Date.now() };
}

export async function startBinanceRelay({ marketType, broadcastCandle }) {
  const timeframes = timeframesFor("binance", marketType);
  const symbols = await getActiveSymbols("binance", marketType);
  if (symbols.length === 0) {
    console.warn(`No active binance/${marketType} symbols at startup — relay idle until one activates on-demand`);
  }

  const group = createShardGroup(
    symbols,
    timeframes.length,
    (shard, shardIndex) => connect(marketType, timeframes, shard, shardIndex, broadcastCandle),
    { label: `Binance ${marketType} relay` }
  );

  // Symbols activated after startup (someone views a pair that wasn't
  // already active) get subscribed live instead of waiting for a restart.
  onActivation(({ exchange, marketType: mt, symbol }) => {
    if (exchange === "binance" && mt === marketType) {
      addSymbolToShardGroup(group, symbol, (sym) => buildSubscribeForSymbol(marketType, sym));
    }
  });

  return group;
}

function connect(marketType, timeframes, shard, shardIndex, broadcastCandle) {
  const ws = new WebSocket(HOSTS[marketType]);

  ws.on("open", () => {
    shard.ws = ws;
    console.log(`Binance ${marketType} relay [shard ${shardIndex}] connected — ${shard.symbols.length} symbols x ${timeframes.length} timeframes`);
    // Read shard.symbols fresh (not a captured snapshot) so symbols added
    // live before a reconnect get re-subscribed automatically.
    const streams = shard.symbols.flatMap((symbol) => timeframes.map((tf) => `${symbol.toLowerCase()}@kline_${tf}`));
    let id = 1;
    for (let i = 0; i < streams.length; i += 50) {
      ws.send(JSON.stringify({ method: "SUBSCRIBE", params: streams.slice(i, i + 50), id: id++ }));
    }
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const k = msg.data?.k;
    if (!k) return;

    const symbol = k.s;
    const timeframe = k.i;
    const candle = { openTime: k.t, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v) };

    broadcastCandle("binance", marketType, symbol, timeframe, candle, k.x);

    if (k.x) {
      try {
        await upsertCandle({ exchange: "binance", marketType, symbol, timeframe, openTimeMs: k.t, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
      } catch (err) {
        console.error(`Failed to write binance/${marketType} candle ${symbol} ${timeframe}`, err);
      }
    }
  });

  ws.on("close", () => {
    shard.ws = null;
    console.warn(`Binance ${marketType} relay [shard ${shardIndex}] disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
    setTimeout(() => connect(marketType, timeframes, shard, shardIndex, broadcastCandle), RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    console.error(`Binance ${marketType} relay [shard ${shardIndex}] error`, err.message);
    ws.close();
  });
}
