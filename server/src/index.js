// Unblocked server — entry point

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

import { startAllRelays } from "./services/exchanges/index.js";
import { attachWebSocketServer } from "./services/wsServer.js";
import { startWhaleAlertPoller } from "./services/whaleAlertPoller.js";
import { startPruner } from "./services/pruner.js";
import candlesRouter from "./routes/candles.js";
import symbolsRouter from "./routes/symbols.js";
import adminBackfillRouter from "./routes/adminBackfill.js";
import adminSymbolsRouter from "./routes/adminSymbols.js";
import { pool } from "./db/pool.js";

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/candles", candlesRouter);
app.use("/symbols", symbolsRouter);
app.use("/internal/backfill", adminBackfillRouter);
app.use("/internal/symbols", adminSymbolsRouter);

const server = createServer(app);

// Attach the WS server first — it hands back broadcast functions the
// exchange relays need to push live ticks to subscribed clients.
const { broadcastCandle, broadcastWhaleEvent } = attachWebSocketServer(server);

startAllRelays({ broadcastCandle }).catch((err) => {
  console.error("Failed to start exchange relays", err);
});

// Poll CoinRadar's /api/whale/:ticker for each unique tracked ticker
// (deduped across exchanges — whale events are on-chain/ticker-based, not
// exchange-specific, so there's no reason to poll the same ticker twice
// just because it's listed on both Binance and Bybit) and broadcast new
// events to subscribed chart clients.
pool
  .query("SELECT DISTINCT pair FROM symbols WHERE active = true")
  .then(({ rows }) => {
    startWhaleAlertPoller({
      symbols: rows.map((r) => r.pair),
      broadcastWhaleEvent,
    });
  })
  .catch((err) => {
    console.error("Failed to start whale alert poller", err);
  });

// Keeps on-demand-activated symbols (see routes/candles.js) from
// accumulating forever — anything non-core that's gone idle gets
// deactivated and its candle history deleted, which is what actually
// prevents storage from creeping back toward the limit that took the
// site down before.
startPruner();

const port = process.env.PORT || 3001;
server.listen(port, () => console.log(`Unblocked server listening on :${port}`));
