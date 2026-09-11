// Rolls up finer candles into arbitrary custom bucket sizes. This is how
// "custom intervals" (e.g. 7m, 13h, 2d — anything not natively offered by
// an exchange, see services/timeframes.js) get served: no exchange has a
// native "7 minute" kline API, but every exchange/market combo we support
// always has native 1-minute candles, so any coarser interval can be
// synthesized by grouping consecutive 1m candles and combining their OHLCV
// (open = first bar's open, high = max, low = min, close = last bar's
// close, volume = sum).
//
// Practical consequence: a custom interval's available history is capped
// at however deep our 1m data goes (90 days per backfillRunner's depth
// policy), even for exchanges/timeframes where a *native* equivalent might
// go back years. This is the same tradeoff every charting platform makes
// for non-native/custom intervals resampled from finer base data.

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/**
 * Parses a timeframe string like "15m", "4h", "1d", "1M", "7m", "13h" into
 * { count, unit }. Accepts the same shape for both native and custom
 * timeframes — callers decide separately whether a given (count, unit)
 * happens to match something natively available.
 */
export function parseCustomTimeframe(tf) {
  const match = /^(\d+)(s|m|h|d|w|M)$/.exec(tf);
  if (!match) return null;
  const count = Number(match[1]);
  const unit = match[2];
  if (!count || count < 1) return null;
  return { count, unit };
}

// Fixed-duration buckets (seconds/minutes/hours/days/weeks all have an
// exact millisecond length, unlike months).
function aggregateByFixedBucket(candles, bucketMs) {
  const buckets = new Map();
  for (const c of candles) {
    const bucketStart = Math.floor(c.t / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { t: bucketStart, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    } else {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c; // candles arrive in ascending time order — last write wins for close
      existing.v += c.v;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

// Calendar-month buckets — months are 28-31 days, so these can't use fixed
// millisecond bucketing. Groups by UTC calendar month, N months at a time,
// anchored so "2 months" produces Jan-Feb, Mar-Apr, etc. (consistent
// regardless of which month the data happens to start in).
function aggregateByMonths(candles, monthCount) {
  const buckets = new Map();
  for (const c of candles) {
    const d = new Date(c.t);
    const monthIndex = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const bucketIndex = Math.floor(monthIndex / monthCount);
    const bucketYear = Math.floor((bucketIndex * monthCount) / 12);
    const bucketMonth = (bucketIndex * monthCount) % 12;
    const bucketStart = Date.UTC(bucketYear, bucketMonth, 1);
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { t: bucketStart, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    } else {
      existing.h = Math.max(existing.h, c.h);
      existing.l = Math.min(existing.l, c.l);
      existing.c = c.c;
      existing.v += c.v;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

/** candles: [{ t (ms), o, h, l, c, v }] ascending by t. */
export function aggregateCandles(candles, count, unit) {
  if (unit === "M") return aggregateByMonths(candles, count);
  return aggregateByFixedBucket(candles, count * UNIT_MS[unit]);
}

/**
 * How many 1-minute base candles are needed to build `limit` bars of the
 * requested custom interval — used to size the raw DB query. Deliberately
 * an overestimate (e.g. "M" uses a 31-day upper bound) rather than exact,
 * since asking for a few extra rows is harmless but asking for too few
 * would silently under-fill the requested limit.
 */
export function rawMinuteLimitFor(limit, { count, unit }) {
  const perBarMinutes = { s: count / 60, m: count, h: count * 60, d: count * 1440, w: count * 1440 * 7, M: count * 1440 * 31 }[unit];
  return Math.min(Math.ceil(limit * Math.max(perBarMinutes, 1)), 200_000);
}
