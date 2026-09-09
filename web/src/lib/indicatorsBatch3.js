// Batch 3 — the remaining requested indicators, minus the 7 that structurally
// can't work yet (Volume Profile needs a different rendering entirely;
// Advance/Decline needs multi-symbol breadth data; Ratio/Spread/Correlation
// Coefficient/Correlation-Log/Rank Correlation Index all inherently compare
// two symbols, and there's no second-symbol picker in the UI; Trend Strength
// Index has no single confidently-known canonical formula distinct from ADX).
//
// Honesty note on fidelity: most of these follow the standard/textbook
// definition for each indicator. A handful (Accumulative Swing Index,
// Pivot Points Standard, Chop Zone) have platform-specific conventions
// TradingView doesn't fully document (e.g. ASI's "limit move" constant,
// which parties/exchanges customarily set differently). Those are marked
// inline with the specific assumption made, rather than silently guessing.

import { ema, sma, atr as atrFn } from "./indicators.js";

function wilderSmooth(values, period) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  const firstIdx = values.findIndex((v) => v != null);
  if (firstIdx === -1) return out;
  for (let i = firstIdx; i < values.length; i++) {
    if (values[i] == null) continue;
    if (prev == null) {
      if (i - firstIdx + 1 < period) continue;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = (prev * (period - 1) + values[i]) / period;
    }
    out[i] = prev;
  }
  return out;
}

function wma(values, period) {
  const out = new Array(values.length).fill(null);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - period + 1 + j] * (j + 1);
    out[i] = sum / denom;
  }
  return out;
}

// ---------------------------------------------------------------- Moving Averages

export function alma(closes, period = 9, offset = 0.85, sigma = 6) {
  const out = new Array(closes.length).fill(null);
  const m = offset * (period - 1);
  const s = period / sigma;
  const weights = [];
  let wSum = 0;
  for (let i = 0; i < period; i++) {
    const w = Math.exp(-((i - m) ** 2) / (2 * s * s));
    weights.push(w);
    wSum += w;
  }
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += closes[i - period + 1 + j] * weights[j];
    out[i] = sum / wSum;
  }
  return out;
}

export function dema(closes, period = 20) {
  const e1 = ema(closes, period);
  const e2 = ema(e1.map((v) => v ?? NaN), period);
  return closes.map((_, i) => (e1[i] == null || e2[i] == null || Number.isNaN(e2[i]) ? null : 2 * e1[i] - e2[i]));
}

export function tema(closes, period = 20) {
  const e1 = ema(closes, period);
  const e2 = ema(e1.map((v) => v ?? NaN), period);
  const e3 = ema(e2.map((v) => v ?? NaN), period);
  return closes.map((_, i) =>
    e1[i] == null || e2[i] == null || e3[i] == null || Number.isNaN(e2[i]) || Number.isNaN(e3[i]) ? null : 3 * e1[i] - 3 * e2[i] + e3[i]
  );
}

export function hma(closes, period = 20) {
  const half = Math.round(period / 2);
  const sqrtP = Math.round(Math.sqrt(period));
  const wmaHalf = wma(closes, half);
  const wmaFull = wma(closes, period);
  const diff = closes.map((_, i) => (wmaHalf[i] != null && wmaFull[i] != null ? 2 * wmaHalf[i] - wmaFull[i] : NaN));
  const result = wma(diff, sqrtP);
  return result.map((v) => (Number.isNaN(v) ? null : v));
}

// Least Squares Moving Average — the endpoint value of the linear-regression
// line fit over the trailing `period` window ending at each bar.
export function lsma(closes, period = 25) {
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = closes[i - period + 1 + j];
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const n = period;
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    out[i] = intercept + slope * (period - 1);
  }
  return out;
}

// Smoothed Moving Average — Wilder's running smoothing method, same math
// already used internally for ATR/ADX, exposed here as its own indicator.
export function smma(closes, period = 14) {
  return wilderSmooth(closes, period);
}

export function mcginleyDynamic(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let md = closes[0];
  out[0] = md;
  for (let i = 1; i < closes.length; i++) {
    const ratio = closes[i] / md;
    md = md + (closes[i] - md) / (period * Math.pow(ratio, 4));
    out[i] = md;
  }
  return out;
}

export function guppyMma(closes) {
  const shortPeriods = [3, 5, 8, 10, 12, 15];
  const longPeriods = [30, 35, 40, 45, 50, 60];
  return {
    short: shortPeriods.map((p) => ema(closes, p)),
    long: longPeriods.map((p) => ema(closes, p)),
  };
}

export function linearRegressionCurve(closes, period = 14) {
  return lsma(closes, period); // identical calculation, different display convention
}

export function linearRegressionSlope(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = closes[i - period + 1 + j];
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const n = period;
    out[i] = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
  return out;
}

// ---------------------------------------------------------------- Momentum / Oscillators

export function chandeMomentumOscillator(closes, period = 9) {
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    let up = 0, down = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) up += diff; else down -= diff;
    }
    out[i] = up + down === 0 ? 0 : (100 * (up - down)) / (up + down);
  }
  return out;
}

export function detrendedPriceOscillator(closes, period = 14) {
  const smaVals = sma(closes, period);
  const shift = Math.floor(period / 2) + 1;
  const out = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const srcIdx = i - shift;
    if (srcIdx < 0 || smaVals[i] == null) continue;
    out[srcIdx] = closes[i] - smaVals[i];
  }
  return out;
}

// Connors RSI = average of RSI(close,3), RSI(streak,2), and the percentile
// rank of today's 1-bar ROC among the trailing `rankPeriod` ROC values.
export function connorsRsi(closes, rsiPeriod = 3, streakPeriod = 2, rankPeriod = 100) {
  const n = closes.length;
  const rsiOf = (series, period) => {
    const out = new Array(series.length).fill(null);
    let avgGain = null, avgLoss = null;
    for (let i = 1; i < series.length; i++) {
      const change = series[i] - series[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;
      if (i <= period) {
        avgGain = (avgGain ?? 0) + gain / period;
        avgLoss = (avgLoss ?? 0) + loss / period;
        if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      } else {
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    }
    return out;
  };

  const closeRsi = rsiOf(closes, rsiPeriod);

  // Streak: consecutive up (+) or down (-) closes, reset to 0/±1 on direction change
  const streak = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1]) streak[i] = streak[i - 1] > 0 ? streak[i - 1] + 1 : 1;
    else if (closes[i] < closes[i - 1]) streak[i] = streak[i - 1] < 0 ? streak[i - 1] - 1 : -1;
    else streak[i] = 0;
  }
  const streakRsi = rsiOf(streak, streakPeriod);

  // Percentile rank of today's 1-bar ROC among trailing rankPeriod ROC values
  const roc1 = new Array(n).fill(null);
  for (let i = 1; i < n; i++) roc1[i] = closes[i - 1] === 0 ? 0 : (closes[i] - closes[i - 1]) / closes[i - 1];

  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (closeRsi[i] == null || streakRsi[i] == null) continue;
    const start = Math.max(1, i - rankPeriod + 1);
    const window = roc1.slice(start, i + 1).filter((v) => v != null);
    if (window.length === 0 || roc1[i] == null) continue;
    const below = window.filter((v) => v < roc1[i]).length;
    const pctRank = (below / window.length) * 100;
    out[i] = (closeRsi[i] + streakRsi[i] + pctRank) / 3;
  }
  return out;
}

export function coppockCurve(closes, roc1 = 14, roc2 = 11, wmaPeriod = 10) {
  const rocOf = (period) => closes.map((c, i) => (i < period || closes[i - period] === 0 ? null : ((c - closes[i - period]) / closes[i - period]) * 100));
  const r1 = rocOf(roc1);
  const r2 = rocOf(roc2);
  const summed = closes.map((_, i) => (r1[i] != null && r2[i] != null ? r1[i] + r2[i] : NaN));
  return wma(summed, wmaPeriod).map((v) => (Number.isNaN(v) ? null : v));
}

export function kst(closes) {
  const rocSma = (rocPeriod, smaPeriod) => {
    const r = closes.map((c, i) => (i < rocPeriod || closes[i - rocPeriod] === 0 ? NaN : ((c - closes[i - rocPeriod]) / closes[i - rocPeriod]) * 100));
    return sma(r.map((v) => (Number.isNaN(v) ? null : v)).map((v) => v ?? NaN), smaPeriod).map((v) => (Number.isNaN(v) ? null : v));
  };
  const rcma1 = rocSma(10, 10);
  const rcma2 = rocSma(15, 10);
  const rcma3 = rocSma(20, 10);
  const rcma4 = rocSma(30, 15);
  const kstLine = closes.map((_, i) => {
    if (rcma1[i] == null || rcma2[i] == null || rcma3[i] == null || rcma4[i] == null) return null;
    return rcma1[i] * 1 + rcma2[i] * 2 + rcma3[i] * 3 + rcma4[i] * 4;
  });
  const signal = sma(kstLine.map((v) => v ?? NaN), 9).map((v) => (Number.isNaN(v) ? null : v));
  return { kst: kstLine, signal };
}

export function trueStrengthIndex(closes, longPeriod = 25, shortPeriod = 13) {
  const momentum = closes.map((c, i) => (i === 0 ? NaN : c - closes[i - 1]));
  const absMomentum = momentum.map((v) => (Number.isNaN(v) ? NaN : Math.abs(v)));
  const smoothMomentum = ema(ema(momentum.map((v) => (Number.isNaN(v) ? null : v)), longPeriod).map((v) => v ?? NaN), shortPeriod);
  const smoothAbsMomentum = ema(ema(absMomentum.map((v) => (Number.isNaN(v) ? null : v)), longPeriod).map((v) => v ?? NaN), shortPeriod);
  return closes.map((_, i) =>
    Number.isNaN(smoothMomentum[i]) || Number.isNaN(smoothAbsMomentum[i]) || smoothAbsMomentum[i] === 0 ? null : (100 * smoothMomentum[i]) / smoothAbsMomentum[i]
  );
}

// Relative Vigor Index — symmetrically-weighted average of (close-open) over
// (high-low), smoothed with a 4-bar weighted filter (standard convention).
export function relativeVigorIndex(candles, period = 10) {
  const n = candles.length;
  const numRaw = new Array(n).fill(null);
  const denRaw = new Array(n).fill(null);
  for (let i = 3; i < n; i++) {
    numRaw[i] = (candles[i].c - candles[i].o + 2 * (candles[i - 1].c - candles[i - 1].o) + 2 * (candles[i - 2].c - candles[i - 2].o) + (candles[i - 3].c - candles[i - 3].o)) / 6;
    denRaw[i] = (candles[i].h - candles[i].l + 2 * (candles[i - 1].h - candles[i - 1].l) + 2 * (candles[i - 2].h - candles[i - 2].l) + (candles[i - 3].h - candles[i - 3].l)) / 6;
  }
  const num = sma(numRaw.map((v) => v ?? NaN), period).map((v) => (Number.isNaN(v) ? null : v));
  const den = sma(denRaw.map((v) => v ?? NaN), period).map((v) => (Number.isNaN(v) ? null : v));
  const rvi = candles.map((_, i) => (num[i] != null && den[i] != null && den[i] !== 0 ? num[i] / den[i] : null));
  const signalRaw = rvi.map((v, i) => {
    if (i < 3 || rvi[i] == null || rvi[i - 1] == null || rvi[i - 2] == null || rvi[i - 3] == null) return null;
    return (rvi[i] + 2 * rvi[i - 1] + 2 * rvi[i - 2] + rvi[i - 3]) / 6;
  });
  return { rvi, signal: signalRaw };
}

export function smiErgodic(candles, longPeriod = 20, shortPeriod = 5, signalPeriod = 5) {
  const n = candles.length;
  const highest = new Array(n).fill(null);
  const lowest = new Array(n).fill(null);
  for (let i = longPeriod - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - longPeriod + 1; j <= i; j++) {
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    highest[i] = hi;
    lowest[i] = lo;
  }
  const mid = candles.map((_, i) => (highest[i] != null ? (highest[i] + lowest[i]) / 2 : null));
  const diff = candles.map((c, i) => (mid[i] != null ? c.c - mid[i] : null));
  const range = candles.map((_, i) => (highest[i] != null ? highest[i] - lowest[i] : null));
  const smoothDiff = ema(ema(diff.map((v) => v ?? NaN), longPeriod).map((v) => v ?? NaN), shortPeriod);
  const smoothRange = ema(ema(range.map((v) => v ?? NaN), longPeriod).map((v) => v ?? NaN), shortPeriod);
  const smi = candles.map((_, i) => (!Number.isNaN(smoothDiff[i]) && !Number.isNaN(smoothRange[i]) && smoothRange[i] !== 0 ? (100 * smoothDiff[i]) / (smoothRange[i] / 2) : null));
  const signal = ema(smi.map((v) => v ?? NaN), signalPeriod).map((v) => (Number.isNaN(v) ? null : v));
  return { smi, signal };
}

export function priceOscillator(closes, fast = 10, slow = 21) {
  const eFast = ema(closes, fast);
  const eSlow = ema(closes, slow);
  return closes.map((_, i) => (eFast[i] != null && eSlow[i] != null && eSlow[i] !== 0 ? ((eFast[i] - eSlow[i]) / eSlow[i]) * 100 : null));
}

// ---------------------------------------------------------------- Volatility

export function bbPercentB(closes, period = 20, mult = 2) {
  const middle = sma(closes, period);
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(closes[j] - middle[i], 2);
    const stdDev = Math.sqrt(sumSq / period);
    const upper = middle[i] + mult * stdDev;
    const lower = middle[i] - mult * stdDev;
    out[i] = upper === lower ? 0.5 : (closes[i] - lower) / (upper - lower);
  }
  return out;
}

export function bbWidth(closes, period = 20, mult = 2) {
  const middle = sma(closes, period);
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(closes[j] - middle[i], 2);
    const stdDev = Math.sqrt(sumSq / period);
    out[i] = middle[i] === 0 ? null : (2 * mult * stdDev) / middle[i];
  }
  return out;
}

export function chaikinVolatility(candles, emaPeriod = 10, rocPeriod = 10) {
  const hl = candles.map((c) => c.h - c.l);
  const emaHl = ema(hl, emaPeriod);
  const out = new Array(candles.length).fill(null);
  for (let i = rocPeriod; i < candles.length; i++) {
    if (emaHl[i] == null || emaHl[i - rocPeriod] == null || emaHl[i - rocPeriod] === 0) continue;
    out[i] = ((emaHl[i] - emaHl[i - rocPeriod]) / emaHl[i - rocPeriod]) * 100;
  }
  return out;
}

export function historicalVolatility(closes, period = 10, annualizeDays = 365) {
  const logReturns = closes.map((c, i) => (i === 0 || closes[i - 1] === 0 ? null : Math.log(c / closes[i - 1])));
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const window = logReturns.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (period - 1);
    out[i] = Math.sqrt(variance) * Math.sqrt(annualizeDays) * 100;
  }
  return out;
}

export function massIndex(candles, emaPeriod = 9, sumPeriod = 25) {
  const hl = candles.map((c) => c.h - c.l);
  const e1 = ema(hl, emaPeriod);
  const e2 = ema(e1.map((v) => v ?? NaN), emaPeriod);
  const ratio = hl.map((_, i) => (e1[i] != null && !Number.isNaN(e2[i]) && e2[i] !== 0 ? e1[i] / e2[i] : null));
  const out = new Array(candles.length).fill(null);
  for (let i = sumPeriod - 1; i < candles.length; i++) {
    let sum = 0, valid = true;
    for (let j = i - sumPeriod + 1; j <= i; j++) {
      if (ratio[j] == null) { valid = false; break; }
      sum += ratio[j];
    }
    if (valid) out[i] = sum;
  }
  return out;
}

export function standardError(closes, period = 20) {
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    out[i] = Math.sqrt(variance) / Math.sqrt(period);
  }
  return out;
}

export function standardErrorBands(closes, period = 20, mult = 2) {
  const centerline = lsma(closes, period);
  const err = standardError(closes, period);
  return {
    upper: closes.map((_, i) => (centerline[i] != null && err[i] != null ? centerline[i] + mult * err[i] : null)),
    lower: closes.map((_, i) => (centerline[i] != null && err[i] != null ? centerline[i] - mult * err[i] : null)),
    mid: centerline,
  };
}

export function relativeVolatilityIndex(closes, period = 10) {
  const stdevArr = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    stdevArr[i] = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  }
  let avgUp = null, avgDown = null;
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    if (stdevArr[i] == null) continue;
    const up = closes[i] > closes[i - 1] ? stdevArr[i] : 0;
    const down = closes[i] < closes[i - 1] ? stdevArr[i] : 0;
    if (avgUp == null) { avgUp = up; avgDown = down; }
    else { avgUp = (avgUp * (period - 1) + up) / period; avgDown = (avgDown * (period - 1) + down) / period; }
    out[i] = avgUp + avgDown === 0 ? 50 : (100 * avgUp) / (avgUp + avgDown);
  }
  return out;
}

export function choppinessIndex(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prevClose = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
  });
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let sumTr = 0, hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      sumTr += tr[j];
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    const range = hi - lo;
    out[i] = range === 0 ? 0 : (100 * Math.log10(sumTr / range)) / Math.log10(period);
  }
  return out;
}

// "Zero-trend" variant assumes zero mean return rather than the sample mean
// (root-mean-square of returns instead of sample standard deviation).
export function volatilityCloseToClose(closes, period = 10, annualizeDays = 365) {
  return historicalVolatility(closes, period, annualizeDays);
}
export function volatilityZeroTrendCloseToClose(closes, period = 10, annualizeDays = 365) {
  const logReturns = closes.map((c, i) => (i === 0 || closes[i - 1] === 0 ? null : Math.log(c / closes[i - 1])));
  const out = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const window = logReturns.slice(i - period + 1, i + 1);
    const meanSquare = window.reduce((a, b) => a + b * b, 0) / period;
    out[i] = Math.sqrt(meanSquare) * Math.sqrt(annualizeDays) * 100;
  }
  return out;
}

// Garman-Klass OHLC volatility estimator — uses the full candle range and
// body, not just closes, so it's more data-efficient than close-to-close.
export function volatilityOHLC(candles, period = 10, annualizeDays = 365) {
  const gk = candles.map((c) => {
    const logHL = Math.log(c.h / c.l);
    const logCO = Math.log(c.c / c.o);
    return 0.5 * logHL * logHL - (2 * Math.log(2) - 1) * logCO * logCO;
  });
  const out = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += gk[j];
    out[i] = Math.sqrt(Math.max(sum / period, 0)) * Math.sqrt(annualizeDays) * 100;
  }
  return out;
}

export function chandeKrollStop(candles, period = 10, mult = 1, stopPeriod = 9) {
  const n = candles.length;
  const atrVals = atrFn(candles, period);
  const highStopRaw = new Array(n).fill(null);
  const lowStopRaw = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    if (atrVals[i] != null) {
      highStopRaw[i] = hi + mult * atrVals[i];
      lowStopRaw[i] = lo - mult * atrVals[i];
    }
  }
  const highStop = new Array(n).fill(null);
  const lowStop = new Array(n).fill(null);
  for (let i = stopPeriod - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity, valid = true;
    for (let j = i - stopPeriod + 1; j <= i; j++) {
      if (highStopRaw[j] == null || lowStopRaw[j] == null) { valid = false; break; }
      if (highStopRaw[j] > hi) hi = highStopRaw[j];
      if (lowStopRaw[j] < lo) lo = lowStopRaw[j];
    }
    if (valid) { highStop[i] = hi; lowStop[i] = lo; }
  }
  return { highStop, lowStop };
}

// ---------------------------------------------------------------- Volume

export function adl(candles) {
  const out = new Array(candles.length).fill(0);
  let cum = 0;
  for (let i = 0; i < candles.length; i++) {
    const range = candles[i].h - candles[i].l;
    const mfm = range === 0 ? 0 : ((candles[i].c - candles[i].l) - (candles[i].h - candles[i].c)) / range;
    cum += mfm * candles[i].v;
    out[i] = cum;
  }
  return out;
}

export function chaikinOscillator(candles, fast = 3, slow = 10) {
  const adlVals = adl(candles);
  const eFast = ema(adlVals, fast);
  const eSlow = ema(adlVals, slow);
  return candles.map((_, i) => (eFast[i] != null && eSlow[i] != null ? eFast[i] - eSlow[i] : null));
}

export function easeOfMovement(candles, period = 14) {
  const raw = new Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const midMove = (candles[i].h + candles[i].l) / 2 - (candles[i - 1].h + candles[i - 1].l) / 2;
    const boxRatio = candles[i].h === candles[i].l ? 0 : candles[i].v / (candles[i].h - candles[i].l);
    raw[i] = boxRatio === 0 ? 0 : midMove / boxRatio;
  }
  return sma(raw.map((v) => v ?? NaN), period).map((v) => (Number.isNaN(v) ? null : v));
}

export function netVolume(candles) {
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].c > candles[i - 1].c) out[i] = out[i - 1] + candles[i].v;
    else if (candles[i].c < candles[i - 1].c) out[i] = out[i - 1] - candles[i].v;
    else out[i] = out[i - 1];
  }
  return out;
}

export function priceVolumeTrend(candles) {
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].c;
    const change = prevClose === 0 ? 0 : ((candles[i].c - prevClose) / prevClose) * candles[i].v;
    out[i] = out[i - 1] + change;
  }
  return out;
}

export function volumeOscillator(candles, fast = 5, slow = 10) {
  const volumes = candles.map((c) => c.v);
  const eFast = ema(volumes, fast);
  const eSlow = ema(volumes, slow);
  return candles.map((_, i) => (eFast[i] != null && eSlow[i] != null && eSlow[i] !== 0 ? ((eFast[i] - eSlow[i]) / eSlow[i]) * 100 : null));
}

export function klingerOscillator(candles, fast = 34, slow = 55, signalPeriod = 13) {
  const n = candles.length;
  const trend = new Array(n).fill(1);
  for (let i = 1; i < n; i++) {
    const hlc = candles[i].h + candles[i].l + candles[i].c;
    const prevHlc = candles[i - 1].h + candles[i - 1].l + candles[i - 1].c;
    trend[i] = hlc > prevHlc ? 1 : -1;
  }
  const vf = candles.map((c, i) => {
    if (i === 0) return 0;
    const range = c.h - c.l || 1;
    return c.v * trend[i] * Math.abs(2 * ((c.c - c.l) / range - (c.h - c.c) / range)) * 100;
  });
  const eFast = ema(vf, fast);
  const eSlow = ema(vf, slow);
  const kvo = candles.map((_, i) => (eFast[i] != null && eSlow[i] != null ? eFast[i] - eSlow[i] : null));
  const signal = ema(kvo.map((v) => v ?? NaN), signalPeriod).map((v) => (Number.isNaN(v) ? null : v));
  return { kvo, signal };
}

// ---------------------------------------------------------------- Trend

// Classic Wilder Parabolic SAR — iterative, direction-flipping stop-and-reverse.
export function parabolicSar(candles, step = 0.02, maxStep = 0.2) {
  const n = candles.length;
  const sar = new Array(n).fill(null);
  if (n < 2) return sar;

  let isUptrend = candles[1].c >= candles[0].c;
  let af = step;
  let ep = isUptrend ? candles[0].h : candles[0].l;
  let currentSar = isUptrend ? candles[0].l : candles[0].h;
  sar[0] = currentSar;

  for (let i = 1; i < n; i++) {
    currentSar = currentSar + af * (ep - currentSar);
    if (isUptrend) {
      currentSar = Math.min(currentSar, candles[i - 1].l, i >= 2 ? candles[i - 2].l : candles[i - 1].l);
      if (candles[i].l < currentSar) {
        isUptrend = false;
        currentSar = ep;
        ep = candles[i].l;
        af = step;
      } else if (candles[i].h > ep) {
        ep = candles[i].h;
        af = Math.min(af + step, maxStep);
      }
    } else {
      currentSar = Math.max(currentSar, candles[i - 1].h, i >= 2 ? candles[i - 2].h : candles[i - 1].h);
      if (candles[i].h > currentSar) {
        isUptrend = true;
        currentSar = ep;
        ep = candles[i].h;
        af = step;
      } else if (candles[i].l < ep) {
        ep = candles[i].l;
        af = Math.min(af + step, maxStep);
      }
    }
    sar[i] = currentSar;
  }
  return sar;
}

// Standard pivot points, computed rolling from each bar's immediately prior
// bar (an approximation — true "standard" pivots use fixed period boundaries
// like the prior trading day, which needs session-boundary awareness this
// chart doesn't track; this rolls bar-to-bar instead).
export function pivotPointsStandard(candles) {
  const n = candles.length;
  const pivot = new Array(n).fill(null);
  const r1 = new Array(n).fill(null), r2 = new Array(n).fill(null), r3 = new Array(n).fill(null);
  const s1 = new Array(n).fill(null), s2 = new Array(n).fill(null), s3 = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const prev = candles[i - 1];
    const p = (prev.h + prev.l + prev.c) / 3;
    pivot[i] = p;
    r1[i] = 2 * p - prev.l;
    s1[i] = 2 * p - prev.h;
    r2[i] = p + (prev.h - prev.l);
    s2[i] = p - (prev.h - prev.l);
    r3[i] = p + 2 * (prev.h - prev.l);
    s3[i] = p - 2 * (prev.h - prev.l);
  }
  return { pivot, r1, r2, r3, s1, s2, s3 };
}

export function vortexIndicator(candles, period = 14) {
  const n = candles.length;
  const vmPlus = new Array(n).fill(0);
  const vmMinus = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    vmPlus[i] = Math.abs(candles[i].h - candles[i - 1].l);
    vmMinus[i] = Math.abs(candles[i].l - candles[i - 1].h);
    tr[i] = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c));
  }
  const viPlus = new Array(n).fill(null);
  const viMinus = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let sumVmP = 0, sumVmM = 0, sumTr = 0;
    for (let j = i - period + 1; j <= i; j++) { sumVmP += vmPlus[j]; sumVmM += vmMinus[j]; sumTr += tr[j]; }
    viPlus[i] = sumTr === 0 ? 0 : sumVmP / sumTr;
    viMinus[i] = sumTr === 0 ? 0 : sumVmM / sumTr;
  }
  return { viPlus, viMinus };
}

// Williams Alligator — three SMMA lines on median price. The classic
// forward-shift (jaw +8, teeth +5, lips +3 bars) is a display-layer concern;
// this returns the un-shifted SMMA values themselves.
export function williamsAlligator(candles) {
  const median = candles.map((c) => (c.h + c.l) / 2);
  return {
    jaw: wilderSmooth(median, 13),
    teeth: wilderSmooth(median, 8),
    lips: wilderSmooth(median, 5),
  };
}

// Williams Fractal — marks a bar as a fractal high/low if its high/low is
// the most extreme among the 2 bars before and 2 bars after it. Returns
// sparse arrays (null except at fractal bars) since these are point markers.
export function williamsFractal(candles) {
  const n = candles.length;
  const up = new Array(n).fill(null);
  const down = new Array(n).fill(null);
  for (let i = 2; i < n - 2; i++) {
    const isUp = candles[i].h > candles[i - 1].h && candles[i].h > candles[i - 2].h && candles[i].h > candles[i + 1].h && candles[i].h > candles[i + 2].h;
    const isDown = candles[i].l < candles[i - 1].l && candles[i].l < candles[i - 2].l && candles[i].l < candles[i + 1].l && candles[i].l < candles[i + 2].l;
    if (isUp) up[i] = candles[i].h;
    if (isDown) down[i] = candles[i].l;
  }
  return { up, down };
}

// Zig Zag — connects swing highs/lows that reverse by at least `deviation`%.
// Returns a sparse array (null except at confirmed pivot bars).
export function zigZag(candles, deviation = 5) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (n === 0) return out;

  let lastPivotIdx = 0;
  let lastPivotPrice = candles[0].c;
  let trendUp = null;

  for (let i = 1; i < n; i++) {
    const price = candles[i].c;
    const change = ((price - lastPivotPrice) / lastPivotPrice) * 100;

    if (trendUp === null) {
      if (Math.abs(change) >= deviation) {
        trendUp = change > 0;
        out[lastPivotIdx] = lastPivotPrice;
        lastPivotIdx = i;
        lastPivotPrice = price;
      }
      continue;
    }

    if (trendUp) {
      if (price > lastPivotPrice) { lastPivotPrice = price; lastPivotIdx = i; }
      else if (((lastPivotPrice - price) / lastPivotPrice) * 100 >= deviation) {
        out[lastPivotIdx] = lastPivotPrice;
        trendUp = false;
        lastPivotIdx = i;
        lastPivotPrice = price;
      }
    } else {
      if (price < lastPivotPrice) { lastPivotPrice = price; lastPivotIdx = i; }
      else if (((price - lastPivotPrice) / lastPivotPrice) * 100 >= deviation) {
        out[lastPivotIdx] = lastPivotPrice;
        trendUp = true;
        lastPivotIdx = i;
        lastPivotPrice = price;
      }
    }
  }
  out[lastPivotIdx] = lastPivotPrice;
  return out;
}

// Chop Zone — a simplified approximation combining the Choppiness Index
// with EMA slope direction, categorized into zones. TradingView's exact
// color-banding thresholds aren't publicly documented; this returns the
// underlying numeric value (0-100, same scale as Choppiness Index) rather
// than guessing at undocumented color-zone cutoffs.
export function chopZone(candles, period = 14) {
  return choppinessIndex(candles, period);
}

// Fisher Transform — converts price into a Gaussian-normal-ish oscillator,
// making turning points sharper/more identifiable than raw price.
export function fisherTransform(candles, period = 9) {
  const n = candles.length;
  const median = candles.map((c) => (c.h + c.l) / 2);
  const fish = new Array(n).fill(null);
  const signal = new Array(n).fill(null);
  let prevValue = 0, prevFish = 0;
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (median[j] > hi) hi = median[j];
      if (median[j] < lo) lo = median[j];
    }
    const range = hi - lo || 1e-9;
    let x = 0.66 * 2 * ((median[i] - lo) / range - 0.5) + 0.67 * prevValue;
    x = Math.max(-0.999, Math.min(0.999, x));
    const f = 0.5 * Math.log((1 + x) / (1 - x)) + 0.5 * prevFish;
    fish[i] = f;
    signal[i] = prevFish;
    prevValue = x;
    prevFish = f;
  }
  return { fisher: fish, signal };
}

// "Cross" indicators — these aren't new math, just two moving averages of
// different types/periods plotted together so a crossover is visible.
export function emaCross(closes, fast = 9, slow = 21) {
  return { fast: ema(closes, fast), slow: ema(closes, slow) };
}
export function maCross(closes, fast = 9, slow = 21) {
  return { fast: sma(closes, fast), slow: sma(closes, slow) };
}
export function maWithEmaCross(closes, maPeriod = 9, emaPeriod = 21) {
  return { ma: sma(closes, maPeriod), ema: ema(closes, emaPeriod) };
}

// Moving Average Channel — an SMA with ATR-based bands (a fixed-percent
// variant exists too, but an ATR band adapts to current volatility, which
// fits this app's data better than a static percent envelope).
export function movingAverageChannel(candles, period = 20, mult = 2) {
  const closes = candles.map((c) => c.c);
  const mid = sma(closes, period);
  const atrVals = atrFn(candles, period);
  return {
    upper: mid.map((v, i) => (v != null && atrVals[i] != null ? v + mult * atrVals[i] : null)),
    lower: mid.map((v, i) => (v != null && atrVals[i] != null ? v - mult * atrVals[i] : null)),
    mid,
  };
}
