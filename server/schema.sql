-- Unblocked — schema
-- Run with: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS symbols (
  id                 SERIAL PRIMARY KEY,
  pair               TEXT NOT NULL,
  display            TEXT NOT NULL,
  exchange           TEXT NOT NULL DEFAULT 'binance',
  market_type        TEXT NOT NULL DEFAULT 'spot',
  active             BOOLEAN NOT NULL DEFAULT true,
  is_core            BOOLEAN NOT NULL DEFAULT false, -- protected from the pruner regardless of recency
  last_requested_at  TIMESTAMPTZ,                    -- drives on-demand activation + pruning
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exchange, market_type, pair)
);

CREATE TABLE IF NOT EXISTS candles (
  exchange    TEXT NOT NULL DEFAULT 'binance',
  market_type TEXT NOT NULL DEFAULT 'spot',
  symbol      TEXT NOT NULL,
  timeframe   TEXT NOT NULL,
  open_time   TIMESTAMPTZ NOT NULL,
  open        NUMERIC NOT NULL,
  high        NUMERIC NOT NULL,
  low         NUMERIC NOT NULL,
  close       NUMERIC NOT NULL,
  volume      NUMERIC NOT NULL,
  PRIMARY KEY (exchange, market_type, symbol, timeframe, open_time)
);

CREATE INDEX IF NOT EXISTS idx_candles_ex_mkt_symbol_tf_time
  ON candles (exchange, market_type, symbol, timeframe, open_time DESC);

CREATE TABLE IF NOT EXISTS whale_events (
  id          SERIAL PRIMARY KEY,
  symbol      TEXT NOT NULL,
  event_time  TIMESTAMPTZ NOT NULL,
  event_type  TEXT NOT NULL,
  amount_usd  NUMERIC,
  wallet      TEXT,
  source      TEXT NOT NULL DEFAULT 'coinradar',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whale_events_symbol_time
  ON whale_events (symbol, event_time DESC);

-- Seed the curated always-on core (adjust as needed):
-- INSERT INTO symbols (pair, display, exchange, market_type, active, is_core)
-- VALUES ('BTCUSDT', 'BTC/USDT', 'binance', 'spot', true, true), ...
