// Canonical timeframe list (ordered small -> large) and each exchange's
// REAL native kline support — verified against each exchange's own API
// docs, not assumed to be uniform:
//
//   Binance spot:  1s,1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
//   Binance perp:  same, minus 1s (USDⓈ-M futures klines start at 1m)
//   Bybit (both):  1m,3m,5m,15m,30m,1h,2h,4h,6h,12h,1d,1w,1M
//                  (no 1s, and no 8h — Bybit's hour steps are 1/2/4/6/12h)
//   Bitunix perp:  1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
//                  (no 1s)
//
// There is no native "year" kline on any exchange here — 1M (month) is the
// largest anyone offers. Viewing year-scale trends already works fine by
// panning across enough 1w/1M candles; a true synthesized "1y" bucket
// would need server-side aggregation from monthly candles, which is a
// separate feature, not implemented here.

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
  return EXCHANGE_TIMEFRAMES[exchange]?.[marketType] ?? [];
}

export function supportsTimeframe(exchange, marketType, tf) {
  return timeframesFor(exchange, marketType).includes(tf);
}
