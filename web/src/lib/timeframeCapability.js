// Frontend mirror of server/src/services/timeframes.js — kept in sync
// manually since the frontend and server are separate deployables without
// a shared package. If the server's capability map ever changes, this
// needs the same edit. See the server file for the full rationale/sourcing
// per exchange; kept brief here since it's a duplicate.

export const ALL_TIMEFRAMES = ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"];

const BINANCE_FULL = ["1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"];
const BINANCE_PERP = BINANCE_FULL.filter((tf) => tf !== "1s");
const BYBIT_ALL = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w", "1M"];
const BITUNIX_PERP = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"];

export const EXCHANGE_TIMEFRAMES = {
  binance: { spot: BINANCE_FULL, perp: BINANCE_PERP },
  bybit: { spot: BYBIT_ALL, perp: BYBIT_ALL },
  bitunix: { perp: BITUNIX_PERP },
};

export function timeframesFor(exchange, marketType) {
  return EXCHANGE_TIMEFRAMES[exchange]?.[marketType] ?? ["1m", "15m", "1h", "4h", "1d"];
}
