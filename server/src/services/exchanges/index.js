// Exchange relay registry. Each adapter owns its own connection, reconnect,
// and candle-write logic — this file just starts whichever exchange/market
// type combos have ever had symbols discovered for them (see
// services/symbolSync.js), so adding a new exchange×market_type pair is:
// write the adapter file, register it below, run a symbol sync. No other
// file needs to change.
//
// Deliberately NOT filtered to WHERE active = true: under the on-demand
// activation model (routes/candles.js, services/pruner.js), a combo can
// have zero currently-active symbols yet still need a relay running and
// ready — the moment someone views a pair in that combo, activationBus.js
// needs an already-listening relay to subscribe it live. Each adapter's
// shard group handles starting with zero symbols fine (see
// createShardGroup in sharding.js), so there's no real cost to always
// starting every known combo.

import { pool } from "../../db/pool.js";
import { startBinanceRelay } from "./binance.js";
import { startBybitRelay } from "./bybit.js";
import { startBitunixRelay } from "./bitunix.js";
import { startMexcRelay } from "./mexc.js";
import { startWeexRelay } from "./weex.js";

const ADAPTERS = {
  binance: (marketType, ctx) => startBinanceRelay({ marketType, ...ctx }),
  bybit: (marketType, ctx) => startBybitRelay({ marketType, ...ctx }),
  bitunix: (_marketType, ctx) => startBitunixRelay(ctx), // perp-only adapter, ignores marketType
  mexc: (_marketType, ctx) => startMexcRelay(ctx),
  weex: (_marketType, ctx) => startWeexRelay(ctx),
};

export async function startAllRelays({ broadcastCandle }) {
  const { rows } = await pool.query(
    "SELECT DISTINCT exchange, market_type FROM symbols ORDER BY exchange, market_type"
  );

  if (rows.length === 0) {
    console.warn("No symbols found across any exchange — nothing to relay (run a symbol sync first)");
    return;
  }

  for (const { exchange, market_type: marketType } of rows) {
    const start = ADAPTERS[exchange];
    if (!start) {
      console.warn(`No adapter registered for exchange "${exchange}" — skipping`);
      continue;
    }
    start(marketType, { broadcastCandle }).catch((err) => {
      console.error(`Failed to start ${exchange}/${marketType} relay`, err);
    });
  }
}
