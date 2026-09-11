// Frontend mirror of server/src/services/aggregate.js — same bucket math,
// operating on the frontend's candle shape { t, o, h, l, c, v } (matching
// what useMarketData/api.js already use everywhere) instead of DB rows.
// See the server file for the full rationale; kept brief here.

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

export function parseCustomTimeframe(tf) {
  const match = /^(\d+)(s|m|h|d|w|M)$/.exec(tf);
  if (!match) return null;
  const count = Number(match[1]);
  const unit = match[2];
  if (!count || count < 1) return null;
  return { count, unit };
}

export function bucketStartFor(t, count, unit) {
  if (unit === "M") {
    const d = new Date(t);
    const monthIndex = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const bucketIndex = Math.floor(monthIndex / count);
    const bucketYear = Math.floor((bucketIndex * count) / 12);
    const bucketMonth = (bucketIndex * count) % 12;
    return Date.UTC(bucketYear, bucketMonth, 1);
  }
  const bucketMs = count * UNIT_MS[unit];
  return Math.floor(t / bucketMs) * bucketMs;
}

/** candles: [{ t, o, h, l, c, v }] ascending by t. Used for the initial
 * client-side pass when needed; the server already aggregates historical
 * data (see routes/candles.js), so this mainly backs live aggregation
 * below via repeated single-bucket recomputation. */
export function aggregateCandles(candles, count, unit) {
  const buckets = new Map();
  for (const c of candles) {
    const bucketStart = bucketStartFor(c.t, count, unit);
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

/**
 * Incremental live aggregator for a custom interval — rolls up 1-minute
 * candles into the current custom bucket as they arrive over the
 * WebSocket, without double-counting volume from repeated "still forming"
 * updates to the same 1-minute candle.
 *
 * Why keyed-by-constituent rather than a running sum: each WS message for
 * a still-open 1-minute candle carries that candle's CURRENT cumulative
 * OHLCV, not a delta since the last message. Naively adding every
 * message's volume would double-count. Instead, each 1-minute candle's
 * latest known state is stored once (keyed by its own open time) and the
 * whole bucket is recomputed from scratch from all constituents whenever
 * any one of them updates — correct regardless of how many times a given
 * 1-minute candle re-fires before it closes.
 */
export function createLiveAggregator(count, unit) {
  let bucketStart = null;
  let constituents = new Map(); // minuteOpenTime -> latest {t,o,h,l,c,v}

  function recompute() {
    const values = [...constituents.values()].sort((a, b) => a.t - b.t);
    if (values.length === 0) return null;
    return {
      t: bucketStart,
      o: values[0].o,
      h: Math.max(...values.map((v) => v.h)),
      l: Math.min(...values.map((v) => v.l)),
      c: values[values.length - 1].c,
      v: values.reduce((sum, v) => sum + v.v, 0),
    };
  }

  /**
   * Feed one 1-minute candle update. Returns:
   *   { bar, isNewBucket } — bar is the current (possibly still-forming)
   *   aggregated bar for the active bucket; isNewBucket is true exactly
   *   once, the first update after crossing into a new bucket (the
   *   caller should treat the *previous* bar as finalized/closed then).
   */
  function ingest(minuteCandle) {
    const thisBucketStart = bucketStartFor(minuteCandle.t, count, unit);

    if (bucketStart === null) {
      bucketStart = thisBucketStart;
      constituents.set(minuteCandle.t, minuteCandle);
      return { bar: recompute(), isNewBucket: false };
    }

    if (thisBucketStart === bucketStart) {
      constituents.set(minuteCandle.t, minuteCandle);
      return { bar: recompute(), isNewBucket: false };
    }

    // Crossed into a new bucket — the caller finalizes the old bar
    // (already returned on the previous call) and we start fresh.
    bucketStart = thisBucketStart;
    constituents = new Map([[minuteCandle.t, minuteCandle]]);
    return { bar: recompute(), isNewBucket: true };
  }

  return { ingest };
}
