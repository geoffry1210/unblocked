// GET /symbols
// Returns every known pair — active or not — so search/discovery can find
// any of the thousands of symbols synced in, not just the small curated
// set that's actively relayed at any given moment. Requesting candles for
// an inactive one (see routes/candles.js) is what flips it on.

import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pair, display, exchange, market_type AS "marketType", active
       FROM symbols
       ORDER BY is_core DESC, active DESC, pair`
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch symbols", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
