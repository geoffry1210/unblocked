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

const router = Router();

const VALID_TIMEFRAMES = new Set(["1m", "15m", "1h", "4h", "1d"]);

router.get("/", async (req, res) => {
  const { symbol, tf, limit = "200", exchange = "binance", marketType = "spot", before } = req.query;

  if (!symbol || !tf) {
    return res.status(400).json({ error: "symbol and tf are required" });
  }
  if (!VALID_TIMEFRAMES.has(tf)) {
    return res.status(400).json({ error: `tf must be one of ${[...VALID_TIMEFRAMES].join(", ")}` });
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

      // Fire-and-forget — the route responds immediately with whatever
      // candles exist right now (likely none yet), and the frontend's
      // existing "no candles yet" state covers the gap gracefully while
      // this fills in behind the scenes.
      runBackfill({ exchangeFilter: exchange, symbolFilter: pair }).catch((err) =>
        console.error(`Background backfill failed for ${exchange}/${marketType} ${pair}`, err)
      );
    }

    const conditions = ["symbol = $1", "timeframe = $2", "exchange = $3", "market_type = $4"];
    const params = [pair, tf, exchange, marketType];
    if (beforeMs) {
      params.push(new Date(beforeMs).toISOString());
      conditions.push(`open_time < $${params.length}`);
    }
    params.push(parsedLimit);

    const { rows } = await pool.query(
      `SELECT open_time, open, high, low, close, volume
       FROM candles
       WHERE ${conditions.join(" AND ")}
       ORDER BY open_time DESC
       LIMIT $${params.length}`,
      params
    );

    res.json(rows.reverse());
  } catch (err) {
    console.error("Failed to fetch candles", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
