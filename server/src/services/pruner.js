// Periodic cleanup: deactivates + deletes candle history for any
// non-core symbol nobody's requested recently. This is the actual fix for
// the storage/memory blowout — on-demand activation (routes/candles.js)
// lets the symbol list grow to cover any pair someone looks at, and this
// is what keeps that growth from being one-directional and eventually
// refilling a free-tier Postgres the same way the old "relay everything"
// approach did.
//
// Core symbols (is_core = true) are never touched, regardless of recency
// — that's the permanent curated set the site always shows data for.

import { pool } from "../db/pool.js";

const IDLE_DAYS = 3;
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export async function runPruner() {
  const { rows: stale } = await pool.query(
    `SELECT exchange, market_type, pair FROM symbols
     WHERE is_core = false
       AND active = true
       AND (last_requested_at IS NULL OR last_requested_at < now() - interval '${IDLE_DAYS} days')`
  );

  if (stale.length === 0) {
    console.log("Pruner: nothing idle enough to prune");
    return { prunedSymbols: 0, deletedCandles: 0 };
  }

  let deletedCandles = 0;
  for (const { exchange, market_type: marketType, pair } of stale) {
    const del = await pool.query(
      `DELETE FROM candles WHERE exchange = $1 AND market_type = $2 AND symbol = $3`,
      [exchange, marketType, pair]
    );
    deletedCandles += del.rowCount;
    await pool.query(
      `UPDATE symbols SET active = false WHERE exchange = $1 AND market_type = $2 AND pair = $3`,
      [exchange, marketType, pair]
    );
  }

  console.log(`Pruner: deactivated ${stale.length} idle symbol(s), deleted ${deletedCandles} candle row(s)`);
  return { prunedSymbols: stale.length, deletedCandles };
}

export function startPruner() {
  console.log(`Pruner started — checking every ${RUN_INTERVAL_MS / 3600000}h for symbols idle > ${IDLE_DAYS} days`);
  runPruner().catch((err) => console.error("Pruner run failed", err));
  setInterval(() => {
    runPruner().catch((err) => console.error("Pruner run failed", err));
  }, RUN_INTERVAL_MS);
}
