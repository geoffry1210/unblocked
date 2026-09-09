import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSymbols } from "../lib/api.js";
import { useMarketData } from "../lib/useMarketData.js";
import {
  sma, ema, bollinger, rsi, macd, vwap, stochRsi,
  atr, adx, aroon, stochastic, cci, williamsR, obv, momentum, roc,
  awesomeOscillator, acceleratorOscillator, standardDeviation, donchianChannels,
  keltnerChannels, moneyFlowIndex, chaikinMoneyFlow, vwma, balanceOfPower, trix,
  elderForceIndex, superTrend, ichimoku, ultimateOscillator, typicalPrice, medianPrice,
  averagePrice, envelopes,
} from "../lib/indicators.js";
import * as batch3 from "../lib/indicatorsBatch3.js";
import { TradingChart } from "./Chart.jsx";
import { AdSlot } from "./AdSlot.jsx";
import { IndicatorPicker } from "./IndicatorPicker.jsx";

// Each indicator now carries its own config (period, color, etc.), not just
// an on/off flag — this is what makes the settings popover possible.
const INDICATOR_DEFS = {
  ma20: { label: "MA", type: "overlay", defaults: { enabled: true, period: 20, color: "#2962FF" } },
  ema9: { label: "EMA", type: "overlay", defaults: { enabled: false, period: 9, color: "#FF6D00" } },
  bb: { label: "Bollinger", type: "overlay", defaults: { enabled: false, period: 20, mult: 2, color: "#2962FF" } },
  vwap: { label: "VWAP", type: "overlay", defaults: { enabled: false, color: "#2962FF" } },
  rsi: { label: "RSI", type: "pane", defaults: { enabled: true, period: 14, color: "#7E57C2" } },
  macd: { label: "MACD", type: "pane", defaults: { enabled: false, fast: 12, slow: 26, signal: 9, color: "#2962FF" } },
  stochrsi: { label: "Stoch RSI", type: "pane", defaults: { enabled: false, period: 14, smoothD: 3, color: "#2962FF" } },

  // Batch 2 — added via the indicator picker (see IndicatorPicker.jsx /
  // indicatorCatalog.js). All default to disabled since there are now 31
  // total; the picker's job is discovery, not pre-cluttering the toolbar.
  atr: { label: "ATR", type: "pane", defaults: { enabled: false, period: 14, color: "#FF6D00" } },
  adx: { label: "ADX", type: "pane", defaults: { enabled: false, period: 14, color: "#8B93A3" } },
  aroon: { label: "Aroon", type: "pane", defaults: { enabled: false, period: 14, color: "#2ED9A0" } },
  stoch: { label: "Stochastic", type: "pane", defaults: { enabled: false, period: 14, smoothD: 3, color: "#2962FF" } },
  cci: { label: "CCI", type: "pane", defaults: { enabled: false, period: 20, color: "#F5B700" } },
  williamsr: { label: "Williams %R", type: "pane", defaults: { enabled: false, period: 14, color: "#FF5C77" } },
  obv: { label: "OBV", type: "pane", defaults: { enabled: false, color: "#4FA9FF" } },
  mom: { label: "Momentum", type: "pane", defaults: { enabled: false, period: 10, color: "#7C5CFF" } },
  roc: { label: "ROC", type: "pane", defaults: { enabled: false, period: 9, color: "#2ED9A0" } },
  ao: { label: "Awesome Osc", type: "pane", defaults: { enabled: false, color: "#F5B700" } },
  ac: { label: "Accelerator Osc", type: "pane", defaults: { enabled: false, color: "#7C5CFF" } },
  stddev: { label: "Std Deviation", type: "pane", defaults: { enabled: false, period: 20, color: "#FF9F40" } },
  donchian: { label: "Donchian", type: "overlay", defaults: { enabled: false, period: 20, color: "#4FA9FF" } },
  keltner: { label: "Keltner", type: "overlay", defaults: { enabled: false, period: 20, mult: 2, color: "#7C5CFF" } },
  mfi: { label: "MFI", type: "pane", defaults: { enabled: false, period: 14, color: "#F5B700" } },
  cmf: { label: "Chaikin MF", type: "pane", defaults: { enabled: false, period: 20, color: "#2ED9A0" } },
  vwma: { label: "VWMA", type: "overlay", defaults: { enabled: false, period: 20, color: "#FF9F40" } },
  bop: { label: "BOP", type: "pane", defaults: { enabled: false, color: "#7C5CFF" } },
  trix: { label: "TRIX", type: "pane", defaults: { enabled: false, period: 15, color: "#F5B700" } },
  efi: { label: "Force Index", type: "pane", defaults: { enabled: false, period: 13, color: "#FF5C77" } },
  supertrend: { label: "SuperTrend", type: "overlay", defaults: { enabled: false, period: 10, mult: 3, color: "#2ED9A0" } },
  ichimoku: { label: "Ichimoku", type: "overlay", defaults: { enabled: false, color: "#2ED9A0" } },
  ultosc: { label: "Ultimate Osc", type: "pane", defaults: { enabled: false, color: "#F5B700" } },
  typicalprice: { label: "Typical Price", type: "overlay", defaults: { enabled: false, color: "#4FA9FF" } },
  medianprice: { label: "Median Price", type: "overlay", defaults: { enabled: false, color: "#4FA9FF" } },
  avgprice: { label: "Average Price", type: "overlay", defaults: { enabled: false, color: "#4FA9FF" } },
  envelopes: { label: "Envelopes", type: "overlay", defaults: { enabled: false, period: 20, color: "#7C5CFF" } },
};

// Batch 3 — the remaining 50 requested indicators (see indicatorsBatch3.js
// for the math). With 81 total indicators now, hand-writing another 50
// if-blocks like the ones above would be unmaintainable, so this is a
// small generic registry instead: each entry knows how to compute itself
// and shape its own result into overlay/pane form. AppShell just loops
// over it once (see the `batch3Overlays`/`batch3Panes` block below) —
// the original 7 + Batch 2's 24 stay exactly as hand-wired above,
// untouched, to avoid any risk to what's already working.
const BATCH3_REGISTRY = [
  { key: "adl", label: "ADL", type: "pane", defaults: { enabled: false, color: "#4FA9FF" }, compute: (c) => batch3.adl(c), toPane: (r) => ({ lines: [{ values: r, color: "#4FA9FF" }] }) },
  { key: "alma", label: "ALMA", type: "overlay", defaults: { enabled: false, period: 9, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.alma(cl, cfg.period), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
  { key: "bbpb", label: "BB %B", type: "pane", defaults: { enabled: false, period: 20, mult: 2, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.bbPercentB(cl, cfg.period, cfg.mult), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }], bounds: [0, 1], refLines: [{ value: 0, color: "#2A3140" }, { value: 1, color: "#2A3140" }] }) },
  { key: "bbw", label: "BB Width", type: "pane", defaults: { enabled: false, period: 20, mult: 2, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.bbWidth(cl, cfg.period, cfg.mult), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "chosc", label: "Chaikin Osc", type: "pane", defaults: { enabled: false, fast: 3, slow: 10, color: "#2ED9A0" }, compute: (c, cl, cfg) => batch3.chaikinOscillator(c, cfg.fast, cfg.slow), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "chvol", label: "Chaikin Vol", type: "pane", defaults: { enabled: false, period: 10, color: "#FF9F40" }, compute: (c, cl, cfg) => batch3.chaikinVolatility(c, cfg.period, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "cks", label: "Chande Kroll", type: "overlay", defaults: { enabled: false, period: 10, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.chandeKrollStop(c, cfg.period), toOverlay: (r) => [{ values: r.highStop, color: "#FF5C77", dash: true }, { values: r.lowStop, color: "#2ED9A0", dash: true }] },
  { key: "cmo", label: "Chande Mom Osc", type: "pane", defaults: { enabled: false, period: 9, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.chandeMomentumOscillator(cl, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }], bounds: [-100, 100] }) },
  { key: "chopzone", label: "Chop Zone", type: "pane", defaults: { enabled: false, period: 14, color: "#4FA9FF" }, compute: (c, cl, cfg) => batch3.chopZone(c, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }], bounds: [0, 100] }) },
  { key: "chopidx", label: "Choppiness", type: "pane", defaults: { enabled: false, period: 14, color: "#FF9F40" }, compute: (c, cl, cfg) => batch3.choppinessIndex(c, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }], bounds: [0, 100] }) },
  { key: "crsi", label: "Connors RSI", type: "pane", defaults: { enabled: false, color: "#2ED9A0" }, compute: (c, cl) => batch3.connorsRsi(cl), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }], bounds: [0, 100], refLines: [{ value: 30, color: "#2A3140" }, { value: 70, color: "#2A3140" }] }) },
  { key: "coppock", label: "Coppock", type: "pane", defaults: { enabled: false, color: "#F5B700" }, compute: (c, cl) => batch3.coppockCurve(cl), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "dpo", label: "DPO", type: "pane", defaults: { enabled: false, period: 14, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.detrendedPriceOscillator(cl, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "dema", label: "DEMA", type: "overlay", defaults: { enabled: false, period: 20, color: "#FF5C77" }, compute: (c, cl, cfg) => batch3.dema(cl, cfg.period), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
  { key: "eom", label: "Ease of Movement", type: "pane", defaults: { enabled: false, period: 14, color: "#4FA9FF" }, compute: (c, cl, cfg) => batch3.easeOfMovement(c, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "emacross", label: "EMA Cross", type: "overlay", defaults: { enabled: false, fast: 9, slow: 21, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.emaCross(cl, cfg.fast, cfg.slow), toOverlay: (r) => [{ values: r.fast, color: "#F5B700" }, { values: r.slow, color: "#2ED9A0" }] },
  { key: "fisher", label: "Fisher Transform", type: "pane", defaults: { enabled: false, period: 9, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.fisherTransform(c, cfg.period), toPane: (r) => ({ lines: [{ values: r.fisher, color: "#7C5CFF" }, { values: r.signal, color: "#F5B700" }] }) },
  { key: "gmma", label: "Guppy MMA", type: "overlay", defaults: { enabled: false, color: "#2ED9A0" }, compute: (c, cl) => batch3.guppyMma(cl), toOverlay: (r) => [...r.short.map((v) => ({ values: v, color: "#2ED9A0" })), ...r.long.map((v) => ({ values: v, color: "#FF5C77" }))] },
  { key: "hv", label: "Historical Vol", type: "pane", defaults: { enabled: false, period: 10, color: "#FF9F40" }, compute: (c, cl, cfg) => batch3.historicalVolatility(cl, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "hma", label: "Hull MA", type: "overlay", defaults: { enabled: false, period: 20, color: "#4FA9FF" }, compute: (c, cl, cfg) => batch3.hma(cl, cfg.period), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
  { key: "klinger", label: "Klinger", type: "pane", defaults: { enabled: false, fast: 34, slow: 55, signal: 13, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.klingerOscillator(c, cfg.fast, cfg.slow, cfg.signal), toPane: (r) => ({ lines: [{ values: r.kvo, color: "#F5B700" }, { values: r.signal, color: "#7C5CFF" }] }) },
  { key: "kst", label: "KST", type: "pane", defaults: { enabled: false, color: "#2ED9A0" }, compute: (c, cl) => batch3.kst(cl), toPane: (r) => ({ lines: [{ values: r.kst, color: "#2ED9A0" }, { values: r.signal, color: "#F5B700" }] }) },
  { key: "lsma", label: "LSMA", type: "overlay", defaults: { enabled: false, period: 25, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.lsma(cl, cfg.period), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
  { key: "lrc", label: "Lin Reg Curve", type: "overlay", defaults: { enabled: false, period: 14, color: "#FF9F40" }, compute: (c, cl, cfg) => batch3.linearRegressionCurve(cl, cfg.period), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
  { key: "lrs", label: "Lin Reg Slope", type: "pane", defaults: { enabled: false, period: 14, color: "#4FA9FF" }, compute: (c, cl, cfg) => batch3.linearRegressionSlope(cl, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "macross", label: "MA Cross", type: "overlay", defaults: { enabled: false, fast: 9, slow: 21, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.maCross(cl, cfg.fast, cfg.slow), toOverlay: (r) => [{ values: r.fast, color: "#F5B700" }, { values: r.slow, color: "#2ED9A0" }] },
  { key: "maemacross", label: "MA+EMA Cross", type: "overlay", defaults: { enabled: false, period: 9, period2: 21, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.maWithEmaCross(cl, cfg.period, cfg.period2), toOverlay: (r) => [{ values: r.ma, color: "#F5B700" }, { values: r.ema, color: "#2ED9A0" }] },
  { key: "massindex", label: "Mass Index", type: "pane", defaults: { enabled: false, color: "#FF5C77" }, compute: (c) => batch3.massIndex(c), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "mcginley", label: "McGinley Dyn", type: "overlay", defaults: { enabled: false, period: 14, color: "#4FA9FF" }, compute: (c, cl, cfg) => batch3.mcginleyDynamic(cl, cfg.period), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
  { key: "machannel", label: "MA Channel", type: "overlay", defaults: { enabled: false, period: 20, mult: 2, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.movingAverageChannel(c, cfg.period, cfg.mult), toOverlay: (r, cfg) => [{ values: r.upper, color: cfg.color, dash: true }, { values: r.lower, color: cfg.color, dash: true }] },
  { key: "netvol", label: "Net Volume", type: "pane", defaults: { enabled: false, color: "#2ED9A0" }, compute: (c) => batch3.netVolume(c), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "psar", label: "Parabolic SAR", type: "overlay", defaults: { enabled: false, step: 0.02, maxStep: 0.2, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.parabolicSar(c, cfg.step, cfg.maxStep), toOverlay: (r, cfg) => [{ values: r, color: cfg.color, dotted: true }] },
  { key: "pivots", label: "Pivot Points", type: "overlay", defaults: { enabled: false, color: "#4FA9FF" }, compute: (c) => batch3.pivotPointsStandard(c), toOverlay: (r) => [{ values: r.pivot, color: "#8B93A3" }, { values: r.r1, color: "#FF5C77", dash: true }, { values: r.s1, color: "#2ED9A0", dash: true }] },
  { key: "pricechannel", label: "Price Channel", type: "overlay", defaults: { enabled: false, period: 20, color: "#FF9F40" }, compute: (c, cl, cfg) => donchianChannels(c, cfg.period), toOverlay: (r, cfg) => [{ values: r.upper, color: cfg.color, dash: true }, { values: r.lower, color: cfg.color, dash: true }] },
  { key: "priceosc", label: "Price Osc", type: "pane", defaults: { enabled: false, fast: 10, slow: 21, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.priceOscillator(cl, cfg.fast, cfg.slow), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "pvt", label: "Price Vol Trend", type: "pane", defaults: { enabled: false, color: "#2ED9A0" }, compute: (c) => batch3.priceVolumeTrend(c), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "rvi", label: "Rel Vigor Idx", type: "pane", defaults: { enabled: false, period: 10, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.relativeVigorIndex(c, cfg.period), toPane: (r) => ({ lines: [{ values: r.rvi, color: "#F5B700" }, { values: r.signal, color: "#7C5CFF" }] }) },
  { key: "rvolidx", label: "Rel Volatility", type: "pane", defaults: { enabled: false, period: 10, color: "#4FA9FF" }, compute: (c, cl, cfg) => batch3.relativeVolatilityIndex(cl, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }], bounds: [0, 100] }) },
  { key: "stderr", label: "Std Error", type: "pane", defaults: { enabled: false, period: 20, color: "#FF9F40" }, compute: (c, cl, cfg) => batch3.standardError(cl, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "stderrbands", label: "Std Error Bands", type: "overlay", defaults: { enabled: false, period: 20, mult: 2, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.standardErrorBands(cl, cfg.period, cfg.mult), toOverlay: (r, cfg) => [{ values: r.upper, color: cfg.color, dash: true }, { values: r.lower, color: cfg.color, dash: true }, { values: r.mid, color: cfg.color }] },
  { key: "smiergodic", label: "SMI Ergodic", type: "pane", defaults: { enabled: false, color: "#2ED9A0" }, compute: (c) => batch3.smiErgodic(c), toPane: (r) => ({ lines: [{ values: r.smi, color: "#2ED9A0" }, { values: r.signal, color: "#F5B700" }] }) },
  { key: "smma", label: "Smoothed MA", type: "overlay", defaults: { enabled: false, period: 14, color: "#4FA9FF" }, compute: (c, cl, cfg) => batch3.smma(cl, cfg.period), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
  { key: "tema", label: "Triple EMA", type: "overlay", defaults: { enabled: false, period: 20, color: "#FF5C77" }, compute: (c, cl, cfg) => batch3.tema(cl, cfg.period), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
  { key: "tsi", label: "True Strength", type: "pane", defaults: { enabled: false, color: "#F5B700" }, compute: (c, cl) => batch3.trueStrengthIndex(cl), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "volc2c", label: "Vol Close-Close", type: "pane", defaults: { enabled: false, period: 10, color: "#2ED9A0" }, compute: (c, cl, cfg) => batch3.volatilityCloseToClose(cl, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "volzeroc2c", label: "Vol Zero Trend", type: "pane", defaults: { enabled: false, period: 10, color: "#7C5CFF" }, compute: (c, cl, cfg) => batch3.volatilityZeroTrendCloseToClose(cl, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "volohlc", label: "Vol O-H-L-C", type: "pane", defaults: { enabled: false, period: 10, color: "#FF9F40" }, compute: (c, cl, cfg) => batch3.volatilityOHLC(c, cfg.period), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "volosc", label: "Volume Osc", type: "pane", defaults: { enabled: false, fast: 5, slow: 10, color: "#4FA9FF" }, compute: (c, cl, cfg) => batch3.volumeOscillator(c, cfg.fast, cfg.slow), toPane: (r, cfg) => ({ lines: [{ values: r, color: cfg.color }] }) },
  { key: "vortex", label: "Vortex", type: "pane", defaults: { enabled: false, period: 14, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.vortexIndicator(c, cfg.period), toPane: (r) => ({ lines: [{ values: r.viPlus, color: "#2ED9A0" }, { values: r.viMinus, color: "#FF5C77" }] }) },
  { key: "alligator", label: "Alligator", type: "overlay", defaults: { enabled: false, color: "#2ED9A0" }, compute: (c) => batch3.williamsAlligator(c), toOverlay: (r) => [{ values: r.jaw, color: "#4FA9FF" }, { values: r.teeth, color: "#FF5C77" }, { values: r.lips, color: "#2ED9A0" }] },
  { key: "fractal", label: "Fractal", type: "overlay", defaults: { enabled: false, color: "#F5B700" }, compute: (c) => batch3.williamsFractal(c), toOverlay: (r) => [{ values: r.up, color: "#FF5C77" }, { values: r.down, color: "#2ED9A0" }] },
  { key: "zigzag", label: "Zig Zag", type: "overlay", defaults: { enabled: false, deviation: 5, color: "#F5B700" }, compute: (c, cl, cfg) => batch3.zigZag(c, cfg.deviation), toOverlay: (r, cfg) => [{ values: r, color: cfg.color }] },
];
BATCH3_REGISTRY.forEach((entry) => {
  INDICATOR_DEFS[entry.key] = { label: entry.label, type: entry.type, defaults: entry.defaults };
});

const COLOR_PRESETS = ["#F5B700", "#2ED9A0", "#7C5CFF", "#FF5C77", "#FF9F40", "#4FA9FF"];

// Batch 1 of the full tool catalog — grouped the same way TradingView groups
// its toolbar, so each group collapses into one icon instead of one row per
// tool. Gann/Elliott/pattern-recognition tools are deliberately deferred —
// everything else gets filled in over Batches 2-5.
const DRAW_GROUPS = [
  {
    key: "cursor",
    icon: "⊹",
    label: "Cursor",
    tools: [
      { key: "eraser", label: "Eraser", clicksNeeded: 1 },
    ],
  },
  {
    key: "lines",
    icon: "╱",
    label: "Lines",
    tools: [
      { key: "trendline", label: "Trend Line", clicksNeeded: 2 },
      { key: "ray", label: "Ray", clicksNeeded: 2 },
      { key: "infoline", label: "Info Line", clicksNeeded: 2 },
      { key: "extended", label: "Extended Line", clicksNeeded: 2 },
      { key: "trendangle", label: "Trend Angle", clicksNeeded: 2 },
      { key: "hline", label: "Horizontal Line", clicksNeeded: 1 },
      { key: "horizontal", label: "Horizontal Ray", clicksNeeded: 1 },
      { key: "vertical", label: "Vertical Line", clicksNeeded: 1 },
      { key: "cross", label: "Cross Line", clicksNeeded: 1 },
      { key: "anchoredvwap", label: "Anchored VWAP", clicksNeeded: 1 },
      { key: "flattop", label: "Flat Top/Bottom", clicksNeeded: 3 },
    ],
  },
  {
    key: "fib",
    icon: "◇",
    label: "Fib",
    tools: [
      { key: "fib", label: "Fib Retracement", clicksNeeded: 2 },
      { key: "fibext", label: "Fib Extension", clicksNeeded: 2 },
      { key: "fibchannel", label: "Fib Channel", clicksNeeded: 3 },
      { key: "fibtimezone", label: "Fib Time Zone", clicksNeeded: 2 },
    ],
  },
  {
    key: "channels",
    icon: "≋",
    label: "Channels",
    tools: [
      { key: "parallelchannel", label: "Parallel Channel", clicksNeeded: 3 },
      { key: "disjointchannel", label: "Disjoint Channel", clicksNeeded: 4 },
    ],
  },
  {
    key: "shapes",
    icon: "▭",
    label: "Shapes",
    tools: [
      { key: "rectangle", label: "Rectangle", clicksNeeded: 2 },
      { key: "circle", label: "Circle", clicksNeeded: 2 },
      { key: "ellipse", label: "Ellipse", clicksNeeded: 2 },
      { key: "triangle", label: "Triangle", clicksNeeded: 3 },
      { key: "curve", label: "Curve", clicksNeeded: 3 },
      { key: "arc", label: "Arc", clicksNeeded: 3 },
      { key: "polygon", label: "Polygon", clicksNeeded: "unlimited" },
      { key: "polyline", label: "Polyline", clicksNeeded: "unlimited" },
      { key: "path", label: "Path", clicksNeeded: "unlimited" },
      { key: "brush", label: "Brush", clicksNeeded: "freehand" },
      { key: "highlighter", label: "Highlighter", clicksNeeded: "freehand" },
    ],
  },
  {
    key: "annotation",
    icon: "T",
    label: "Text",
    tools: [
      { key: "text", label: "Text", clicksNeeded: 1 },
    ],
  },
];

const ALL_DRAW_TOOLS = DRAW_GROUPS.flatMap((g) => g.tools);

// IndicatorPicker's catalog uses its own stable `id`s (indicatorCatalog.js);
// this maps each implemented catalog entry to the INDICATOR_DEFS key that
// actually renders it here. Not always 1:1 — e.g. catalog's "Directional
// Movement" (id "dm") reuses the same ADX calculation and key, since +DI/-DI
// already come back from adx().
const CATALOG_ID_TO_DEF_KEY = {
  ao: "ao", aosc: "ao", ac: "ac", aroon: "aroon", adx: "adx", dm: "adx",
  avgprice: "avgprice", atr: "atr", bop: "bop", bb: "bb", cmf: "cmf", cci: "cci",
  donchian: "donchian", efi: "efi", envelopes: "envelopes", ichimoku: "ichimoku",
  keltner: "keltner", medianprice: "medianprice", momentum: "mom", mfi: "mfi",
  ma: "ma20", macd: "macd", obv: "obv", roc: "roc", rsi: "rsi", stddev: "stddev",
  stoch: "stoch", stochrsi: "stochrsi", supertrend: "supertrend", trix: "trix",
  typicalprice: "typicalprice", ultosc: "ultosc", vwap: "vwap", vwma: "vwma",
  williamsr: "williamsr",
  // Batch 3 — registry keys were kept identical to their catalog ids, so
  // this is just an identity map rather than 50 more manual pairs.
  ...Object.fromEntries(BATCH3_REGISTRY.map((e) => [e.key, e.key])),
};

// Per-tool icons for the flyout grid — name shows only as a hover tooltip
// (native `title` attribute), not as always-visible text.
const TOOL_ICONS = {
  eraser: "⌫",
  trendline: "╱",
  ray: "→",
  infoline: "ℹ",
  extended: "↔",
  trendangle: "∠",
  hline: "—",
  horizontal: "⇥",
  vertical: "|",
  cross: "✛",
  anchoredvwap: "Ⓥ",
  flattop: "⊓",
  fib: "▽",
  fibext: "⋙",
  fibchannel: "║",
  fibtimezone: "⋮",
  parallelchannel: "≡",
  disjointchannel: "⧉",
  rectangle: "▭",
  circle: "○",
  ellipse: "⬭",
  triangle: "△",
  curve: "∿",
  arc: "⌒",
  polygon: "⬠",
  polyline: "⌇",
  path: "↝",
  brush: "🖌",
  highlighter: "▰",
  text: "T",
};

const EXCHANGE_LABELS = { binance: "Binance", bybit: "Bybit", bitunix: "Bitunix", mexc: "MEXC", weex: "Weex" };
const MARKET_TYPE_LABELS = { spot: "Spot", perp: "Perp" };

// A single symbol is now identified by (exchange, marketType, pair) — the
// same pair (e.g. BTCUSDT) exists identically-named across every exchange
// and market type, so this composite key is what actually disambiguates
// selection, storage, and data fetching everywhere below.
function symbolKey(s) {
  return s ? `${s.exchange}:${s.marketType}:${s.pair}` : "";
}

function drawingsStorageKey(activeSymbol, tf) {
  return `unblocked.drawings.v3.${symbolKey(activeSymbol)}.${tf}`;
}
function indicatorConfigStorageKey() {
  return "unblocked.indicators.v1";
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : fallback;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function defaultIndicatorConfig() {
  const cfg = {};
  Object.entries(INDICATOR_DEFS).forEach(([key, def]) => {
    // lineWidth/lineStyle apply generically to every indicator (see `st()`
    // in AppShell's render body) — default here rather than in all 83+
    // individual `defaults` objects; a def can still override them.
    cfg[key] = { lineWidth: 1, lineStyle: "solid", ...def.defaults };
  });
  return cfg;
}

function WhalePulseLayer({ events, candles }) {
  if (candles.length === 0) return null;
  const w = 100 / candles.length;
  function xForTime(eventTimeSec) {
    const eventMs = eventTimeSec * 1000;
    let idx = candles.findIndex((c) => c.t > eventMs);
    if (idx === -1) idx = candles.length - 1;
    if (idx === 0 && candles[0].t > eventMs) return null;
    return idx * w + w / 2;
  }
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
      {events.map((e) => {
        const x = xForTime(e.time);
        if (x == null) return null;
        const valLabel = e.value >= 1e6 ? `${(e.value / 1e6).toFixed(2)}M` : e.value >= 1e3 ? `${(e.value / 1e3).toFixed(2)}K` : e.value?.toFixed(2);
        return (
          <div
            key={e.id}
            style={{ position: "absolute", left: `${x}%`, top: "30%", width: 10, height: 10, borderRadius: "50%", background: "#7C5CFF", animation: "whalePulse 2.2s ease-out" }}
            title={`🐋 ${valLabel} — ${e.from?.slice(0, 8)}... → ${e.to?.slice(0, 8)}...`}
          />
        );
      })}
    </div>
  );
}

function PriceTicker({ candles, connected }) {
  if (candles.length < 2) {
    return (
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#4A5063" }}>
        {connected ? "loading price..." : "connecting..."}
      </div>
    );
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const up = last.c >= prev.c;
  const [flash, setFlash] = useState(false);
  const lastRef = useRef(last.c);
  useEffect(() => {
    if (last.c !== lastRef.current) {
      setFlash(true);
      lastRef.current = last.c;
      const t = setTimeout(() => setFlash(false), 400);
      return () => clearTimeout(t);
    }
  }, [last.c]);
  return (
    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: "tabular-nums", fontSize: 20, fontWeight: 700, color: flash ? (up ? "#2ED9A0" : "#FF5C77") : "#E8EAED", transition: "color 250ms ease", whiteSpace: "nowrap" }}>
      ${last.c < 10 ? last.c.toFixed(4) : last.c.toFixed(2)}
      <span style={{ fontSize: 12, marginLeft: 8, color: up ? "#2ED9A0" : "#FF5C77" }}>
        {up ? "▲" : "▼"} {(((last.c - prev.c) / prev.c) * 100).toFixed(2)}%
      </span>
      {!connected && <span style={{ fontSize: 10, marginLeft: 8, color: "#FF5C77" }}>● reconnecting</span>}
    </div>
  );
}

// Search bar with autocomplete. Each row now shows exchange + market type
// alongside the pair (e.g. "BTC/USDT · Binance · Spot") since the same
// pair name exists identically across every exchange/market combo — the
// display field alone ("BTC/USDT") is no longer enough to tell them apart.
function SymbolSearch({ symbols, activeLabel, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);

  const labelFor = (s) => `${s.display} · ${EXCHANGE_LABELS[s.exchange] || s.exchange} · ${MARKET_TYPE_LABELS[s.marketType] || s.marketType}`;

  const filtered = useMemo(() => {
    if (!query) return symbols.slice(0, 10);
    const q = query.toLowerCase();
    return symbols.filter((s) => labelFor(s).toLowerCase().includes(q)).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, query]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (s) => {
    onSelect(s);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: "relative", width: 240 }}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={activeLabel || "search pair..."}
        style={{ width: "100%", background: "#131720", border: "1px solid #2A3140", borderRadius: 6, padding: "7px 10px", color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, outline: "none" }}
      />
      {open && (
        <div style={{ position: "absolute", top: "110%", left: 0, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 8, zIndex: 30, width: 260, maxHeight: 300, overflow: "auto" }}>
          {filtered.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#4A5063", fontFamily: "'Manrope', sans-serif" }}>No matches</div>}
          {filtered.map((s, i) => (
            <div
              key={symbolKey(s)}
              onMouseDown={() => pick(s)}
              onMouseEnter={() => setHighlight(i)}
              style={{ padding: "8px 10px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#E8EAED", cursor: "pointer", background: i === highlight ? "#232A38" : "transparent" }}
            >
              {s.display} <span style={{ color: "#4A5063" }}>· {EXCHANGE_LABELS[s.exchange] || s.exchange} · {MARKET_TYPE_LABELS[s.marketType] || s.marketType}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Small popover for adjusting a single indicator's period(s) and color.
const LINE_WIDTHS = [1, 2, 3, 4];
const LINE_STYLES = [
  { value: "solid", label: "Solid", dash: "none" },
  { value: "dashed", label: "Dashed", dash: "4,3" },
  { value: "dotted", label: "Dotted", dash: "1,2" },
];

// Human-readable labels for the raw cfg field names, since "smoothD" or
// "maxStep" isn't something to show verbatim in a settings dialog.
const INPUT_LABELS = {
  period: "Length", period2: "Length 2", fast: "Fast Length", slow: "Slow Length",
  signal: "Signal Smoothing", mult: "Multiplier", smoothD: "%D Smoothing",
  step: "Start", maxStep: "Max Step", deviation: "Deviation %",
};
const NON_INPUT_FIELDS = new Set(["enabled", "color", "lineWidth", "lineStyle"]);

function IndicatorSettings({ indKey, def, cfg, onChange, onClose }) {
  const ref = useRef(null);
  const [tab, setTab] = useState("inputs");
  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  const inputFields = Object.keys(cfg).filter((k) => !NON_INPUT_FIELDS.has(k));

  return (
    <div
      ref={ref}
      style={{ position: "absolute", top: "110%", left: 0, zIndex: 30, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 8, width: 240, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden" }}
    >
      <div style={{ display: "flex", borderBottom: "1px solid #2A3140" }}>
        {[["inputs", "Inputs"], ["style", "Style"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1, padding: "9px 0", background: "none", border: "none", cursor: "pointer",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              color: tab === key ? "#E8EAED" : "#4A5063",
              borderBottom: tab === key ? "2px solid #F5B700" : "2px solid transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {tab === "inputs" && (
          inputFields.length === 0 ? (
            <div style={{ fontSize: 11, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace" }}>No configurable inputs for {def.label}.</div>
          ) : (
            inputFields.map((field) => (
              <label key={field} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11, color: "#8B93A3", fontFamily: "'JetBrains Mono', monospace" }}>
                {INPUT_LABELS[field] || field}
                <input
                  type="number"
                  step={field === "deviation" ? 0.5 : field === "maxStep" || field === "step" ? 0.01 : 1}
                  value={cfg[field]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) onChange({ ...cfg, [field]: v });
                  }}
                  style={{ width: 64, background: "#0B0E14", border: "1px solid #2A3140", borderRadius: 4, color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "3px 6px" }}
                />
              </label>
            ))
          )
        )}

        {tab === "style" && (
          <>
            <div>
              <div style={{ fontSize: 11, color: "#8B93A3", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>Color</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => onChange({ ...cfg, color: c })}
                    style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: cfg.color === c ? "2px solid #E8EAED" : "2px solid transparent", cursor: "pointer" }}
                  />
                ))}
                {/* Full custom color, matching TradingView's "any color" swatch */}
                <input
                  type="color"
                  value={cfg.color}
                  onChange={(e) => onChange({ ...cfg, color: e.target.value })}
                  title="Custom color"
                  style={{ width: 22, height: 22, padding: 0, border: "1px solid #2A3140", borderRadius: "50%", background: "none", cursor: "pointer" }}
                />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: "#8B93A3", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>Line width</div>
              <div style={{ display: "flex", gap: 6 }}>
                {LINE_WIDTHS.map((w) => (
                  <button
                    key={w}
                    onClick={() => onChange({ ...cfg, lineWidth: w })}
                    style={{
                      width: 30, height: 24, background: cfg.lineWidth === w ? "#2A3140" : "#0B0E14",
                      border: "1px solid " + (cfg.lineWidth === w ? "#F5B700" : "#2A3140"), borderRadius: 4, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <div style={{ width: 16, height: w, background: "#E8EAED", borderRadius: 1 }} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: "#8B93A3", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>Line style</div>
              <div style={{ display: "flex", gap: 6 }}>
                {LINE_STYLES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => onChange({ ...cfg, lineStyle: s.value })}
                    title={s.label}
                    style={{
                      width: 44, height: 24, background: cfg.lineStyle === s.value ? "#2A3140" : "#0B0E14",
                      border: "1px solid " + (cfg.lineStyle === s.value ? "#F5B700" : "#2A3140"), borderRadius: 4, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <svg width="28" height="2"><line x1="0" y1="1" x2="28" y2="1" stroke="#E8EAED" strokeWidth="2" strokeDasharray={s.dash} /></svg>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IndicatorChip({ indKey, def, cfg, onToggle, onChange }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Every indicator now has a Style tab (color/width/line style) at minimum,
  // even ones with no numeric Inputs — so the settings gear is always shown.

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: cfg.enabled ? `${cfg.color}22` : "transparent",
          border: "1px solid " + (cfg.enabled ? cfg.color + "55" : "#232A38"),
          borderRadius: 6,
          padding: "3px 4px 3px 10px",
        }}
      >
        <button
          onClick={() => onToggle(indKey)}
          style={{ background: "none", border: "none", color: cfg.enabled ? cfg.color : "#8B93A3", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", padding: "2px 0" }}
        >
          {def.label}{"period" in cfg ? ` ${cfg.period}` : ""}
        </button>
        {(
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            title="Settings"
            style={{ background: "none", border: "none", color: cfg.enabled ? cfg.color : "#4A5063", cursor: "pointer", fontSize: 11, padding: "2px 6px" }}
          >
            ⚙
          </button>
        )}
      </div>
      {settingsOpen && (
        <IndicatorSettings indKey={indKey} def={def} cfg={cfg} onChange={(next) => onChange(indKey, next)} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

function ToolGroupDropdown({ group, activeTool, onSelect, direction = "down" }) {
  const [open, setOpen] = useState(false);
  // The rail button shows whichever tool was last picked from this group —
  // matching TradingView, where the rail icon always reflects a specific
  // real tool (defaulting to the group's first one), not a generic category
  // glyph. Tapping the rail activates that tool directly; tapping again
  // (while already open) lets you switch which tool the slot represents.
  const [lastToolKey, setLastToolKey] = useState(group.tools[0].key);
  const ref = useRef(null);
  const isActive = activeTool === lastToolKey || group.tools.some((t) => t.key === activeTool);
  const flyoutStyle = direction === "right" ? { top: 0, left: "110%" } : { top: "110%", left: 0 };

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (t) => {
    setLastToolKey(t.key);
    onSelect(t.key);
    setOpen(false);
  };

  const handleRailClick = () => {
    // If a tool from this group is already active, tapping again opens the
    // picker (to switch tools) instead of just re-toggling the same one.
    if (activeTool && group.tools.some((t) => t.key === activeTool)) {
      setOpen((o) => !o);
    } else {
      const def = group.tools.find((t) => t.key === lastToolKey);
      pick(def);
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={handleRailClick}
        onContextMenu={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        title={group.tools.find((t) => t.key === lastToolKey)?.label}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: isActive ? "#F5B70022" : "transparent",
          color: isActive ? "#F5B700" : "#8B93A3",
          border: "1px solid " + (isActive ? "#F5B70055" : "#232A38"),
          borderRadius: 6, padding: "8px", fontSize: 15, cursor: "pointer", width: 34,
        }}
      >
        {TOOL_ICONS[lastToolKey] || group.icon}
      </button>
      {open && (
        <div style={{ position: "absolute", ...flyoutStyle, zIndex: 30, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 8, width: 210, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          <div style={{ padding: "6px 12px", fontSize: 10, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, borderBottom: "1px solid #232A38" }}>{group.label.toUpperCase()}</div>
          {group.tools.map((t) => (
            <div
              key={t.key}
              onClick={() => pick(t)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer",
                background: activeTool === t.key ? "#F5B70011" : "transparent",
              }}
            >
              <span style={{ width: 18, textAlign: "center", fontSize: 14, color: activeTool === t.key ? "#F5B700" : "#8B93A3" }}>{TOOL_ICONS[t.key] || "?"}</span>
              <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: activeTool === t.key ? "#F5B700" : "#E8EAED" }}>{t.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ onBack }) {
  const [symbols, setSymbols] = useState([]);
  const [symbolsError, setSymbolsError] = useState(null);
  // activeSymbol is the full row from /symbols — { pair, display,
  // exchange, marketType } — not just a bare pair string. That's what lets
  // us tell apart the ~5 identically-named "BTC/USDT" entries.
  const [activeSymbol, setActiveSymbol] = useState(null);
  const [tf, setTf] = useState("15m");
  const [indicatorConfig, setIndicatorConfig] = useState(() => {
    const saved = loadJSON(indicatorConfigStorageKey(), null);
    const defaults = defaultIndicatorConfig();
    if (!saved) return defaults;
    const merged = {};
    Object.keys(defaults).forEach((k) => { merged[k] = { ...defaults[k], ...(saved[k] || {}) }; });
    return merged;
  });

  const [drawTool, setDrawTool] = useState(null);
  const [drawings, setDrawings] = useState([]);
  const [pendingPoints, setPendingPoints] = useState([]);
  const [magnetOn, setMagnetOn] = useState(false);
  const [locked, setLocked] = useState(false);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    fetchSymbols()
      .then((rows) => {
        setSymbols(rows);
        if (rows.length > 0) setActiveSymbol(rows[0]);
      })
      .catch((err) => {
        console.error(err);
        setSymbolsError("Could not reach the server — check VITE_API_URL and that /server is running.");
      });
  }, []);

  const { candles, whaleEvents, loading, loadMore, connected } = useMarketData({
    exchange: activeSymbol?.exchange,
    marketType: activeSymbol?.marketType,
    symbol: activeSymbol?.pair || "",
    timeframe: tf,
  });

  useEffect(() => {
    if (!activeSymbol) return;
    setDrawings(loadJSON(drawingsStorageKey(activeSymbol, tf), []));
    setPendingPoints([]);
    setDrawTool(null);
  }, [activeSymbol, tf]);

  useEffect(() => {
    if (!activeSymbol) return;
    try {
      localStorage.setItem(drawingsStorageKey(activeSymbol, tf), JSON.stringify(drawings));
    } catch {
      // Storage can fail (quota, private browsing) — not worth surfacing.
    }
  }, [drawings, activeSymbol, tf]);

  useEffect(() => {
    try {
      localStorage.setItem(indicatorConfigStorageKey(), JSON.stringify(indicatorConfig));
    } catch {
      // same as above
    }
  }, [indicatorConfig]);

  const closes = candles.map((c) => c.c);
  const cfg = indicatorConfig;
  const indicators = useMemo(
    () => ({
      smaVals: sma(closes, cfg.ma20.period),
      emaVals: ema(closes, cfg.ema9.period),
      bbVals: bollinger(closes, cfg.bb.period, cfg.bb.mult),
      vwapVals: vwap(candles),
      rsiVals: rsi(closes, cfg.rsi.period),
      macdVals: macd(closes, cfg.macd.fast, cfg.macd.slow, cfg.macd.signal),
      stochRsiVals: stochRsi(closes, cfg.stochrsi.period, cfg.stochrsi.period, cfg.stochrsi.smoothD),
      // Batch 2 — only computed when enabled, since several of these (esp.
      // Ichimoku, ADX) are meaningfully more expensive than a moving average.
      atrVals: cfg.atr.enabled ? atr(candles, cfg.atr.period) : null,
      adxVals: cfg.adx.enabled ? adx(candles, cfg.adx.period) : null,
      aroonVals: cfg.aroon.enabled ? aroon(candles, cfg.aroon.period) : null,
      stochVals: cfg.stoch.enabled ? stochastic(candles, cfg.stoch.period, cfg.stoch.smoothD, 3) : null,
      cciVals: cfg.cci.enabled ? cci(candles, cfg.cci.period) : null,
      williamsRVals: cfg.williamsr.enabled ? williamsR(candles, cfg.williamsr.period) : null,
      obvVals: cfg.obv.enabled ? obv(candles) : null,
      momVals: cfg.mom.enabled ? momentum(closes, cfg.mom.period) : null,
      rocVals: cfg.roc.enabled ? roc(closes, cfg.roc.period) : null,
      aoVals: cfg.ao.enabled ? awesomeOscillator(candles) : null,
      acVals: cfg.ac.enabled ? acceleratorOscillator(candles) : null,
      stddevVals: cfg.stddev.enabled ? standardDeviation(closes, cfg.stddev.period) : null,
      donchianVals: cfg.donchian.enabled ? donchianChannels(candles, cfg.donchian.period) : null,
      keltnerVals: cfg.keltner.enabled ? keltnerChannels(candles, cfg.keltner.period, cfg.keltner.mult) : null,
      mfiVals: cfg.mfi.enabled ? moneyFlowIndex(candles, cfg.mfi.period) : null,
      cmfVals: cfg.cmf.enabled ? chaikinMoneyFlow(candles, cfg.cmf.period) : null,
      vwmaVals: cfg.vwma.enabled ? vwma(candles, cfg.vwma.period) : null,
      bopVals: cfg.bop.enabled ? balanceOfPower(candles) : null,
      trixVals: cfg.trix.enabled ? trix(closes, cfg.trix.period) : null,
      efiVals: cfg.efi.enabled ? elderForceIndex(candles, cfg.efi.period) : null,
      supertrendVals: cfg.supertrend.enabled ? superTrend(candles, cfg.supertrend.period, cfg.supertrend.mult) : null,
      ichimokuVals: cfg.ichimoku.enabled ? ichimoku(candles) : null,
      ultoscVals: cfg.ultosc.enabled ? ultimateOscillator(candles) : null,
      typicalPriceVals: cfg.typicalprice.enabled ? typicalPrice(candles) : null,
      medianPriceVals: cfg.medianprice.enabled ? medianPrice(candles) : null,
      avgPriceVals: cfg.avgprice.enabled ? averagePrice(candles) : null,
      envelopesVals: cfg.envelopes.enabled ? envelopes(closes, cfg.envelopes.period) : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      candles, cfg.ma20.period, cfg.ema9.period, cfg.bb.period, cfg.bb.mult, cfg.rsi.period,
      cfg.macd.fast, cfg.macd.slow, cfg.macd.signal, cfg.stochrsi.period, cfg.stochrsi.smoothD,
      cfg.atr.enabled, cfg.atr.period, cfg.adx.enabled, cfg.adx.period, cfg.aroon.enabled, cfg.aroon.period,
      cfg.stoch.enabled, cfg.stoch.period, cfg.stoch.smoothD, cfg.cci.enabled, cfg.cci.period,
      cfg.williamsr.enabled, cfg.williamsr.period, cfg.obv.enabled, cfg.mom.enabled, cfg.mom.period,
      cfg.roc.enabled, cfg.roc.period, cfg.ao.enabled, cfg.ac.enabled, cfg.stddev.enabled, cfg.stddev.period,
      cfg.donchian.enabled, cfg.donchian.period, cfg.keltner.enabled, cfg.keltner.period, cfg.keltner.mult,
      cfg.mfi.enabled, cfg.mfi.period, cfg.cmf.enabled, cfg.cmf.period, cfg.vwma.enabled, cfg.vwma.period,
      cfg.bop.enabled, cfg.trix.enabled, cfg.trix.period, cfg.efi.enabled, cfg.efi.period,
      cfg.supertrend.enabled, cfg.supertrend.period, cfg.supertrend.mult, cfg.ichimoku.enabled, cfg.ultosc.enabled,
      cfg.typicalprice.enabled, cfg.medianprice.enabled, cfg.avgprice.enabled, cfg.envelopes.enabled, cfg.envelopes.period,
    ]
  );

  // Spreads each indicator's own line-width/line-style setting into a
  // pushed overlay/pane-line object — every cfg now carries these two
  // fields (added to defaultIndicatorConfig below), so this is just a
  // shorthand to avoid repeating `width: cfg.X.lineWidth, style: cfg.X.lineStyle`
  // at every single push call site.
  const st = (c) => ({ width: c.lineWidth || 1, style: c.lineStyle || "solid" });

  const overlays = [];
  if (cfg.ma20.enabled) overlays.push({ values: indicators.smaVals, color: cfg.ma20.color, ...st(cfg.ma20) });
  if (cfg.ema9.enabled) overlays.push({ values: indicators.emaVals, color: cfg.ema9.color, ...st(cfg.ema9) });
  if (cfg.bb.enabled) {
    overlays.push({ values: indicators.bbVals.mid, color: "#FF6D00", ...st(cfg.bb) });
    overlays.push({ values: indicators.bbVals.upper, color: cfg.bb.color, dash: true, ...st(cfg.bb) });
    overlays.push({ values: indicators.bbVals.lower, color: cfg.bb.color, dash: true, ...st(cfg.bb) });
  }
  if (cfg.vwap.enabled) overlays.push({ values: indicators.vwapVals, color: cfg.vwap.color, ...st(cfg.vwap) });
  // Batch 2 overlays
  if (cfg.donchian.enabled) {
    overlays.push({ values: indicators.donchianVals.upper, color: cfg.donchian.color, dash: true, ...st(cfg.donchian) });
    overlays.push({ values: indicators.donchianVals.lower, color: cfg.donchian.color, dash: true, ...st(cfg.donchian) });
  }
  if (cfg.keltner.enabled) {
    overlays.push({ values: indicators.keltnerVals.upper, color: cfg.keltner.color, dash: true, ...st(cfg.keltner) });
    overlays.push({ values: indicators.keltnerVals.lower, color: cfg.keltner.color, dash: true, ...st(cfg.keltner) });
  }
  if (cfg.vwma.enabled) overlays.push({ values: indicators.vwmaVals, color: cfg.vwma.color, ...st(cfg.vwma) });
  if (cfg.supertrend.enabled) overlays.push({ values: indicators.supertrendVals.value, color: cfg.supertrend.color, ...st(cfg.supertrend) });
  if (cfg.ichimoku.enabled) {
    overlays.push({ values: indicators.ichimokuVals.tenkan, color: "#2962FF", ...st(cfg.ichimoku) });
    overlays.push({ values: indicators.ichimokuVals.kijun, color: "#B71C1C", ...st(cfg.ichimoku) });
    overlays.push({ values: indicators.ichimokuVals.senkouA, color: "#2ED9A0", dash: true, ...st(cfg.ichimoku) });
    overlays.push({ values: indicators.ichimokuVals.senkouB, color: "#FF5C77", dash: true, ...st(cfg.ichimoku) });
  }
  if (cfg.typicalprice.enabled) overlays.push({ values: indicators.typicalPriceVals, color: cfg.typicalprice.color, ...st(cfg.typicalprice) });
  if (cfg.medianprice.enabled) overlays.push({ values: indicators.medianPriceVals, color: cfg.medianprice.color, ...st(cfg.medianprice) });
  if (cfg.avgprice.enabled) overlays.push({ values: indicators.avgPriceVals, color: cfg.avgprice.color, ...st(cfg.avgprice) });
  if (cfg.envelopes.enabled) {
    overlays.push({ values: indicators.envelopesVals.upper, color: cfg.envelopes.color, dash: true, ...st(cfg.envelopes) });
    overlays.push({ values: indicators.envelopesVals.lower, color: cfg.envelopes.color, dash: true, ...st(cfg.envelopes) });
  }

  const indicatorPanes = [];
  if (cfg.rsi.enabled) {
    indicatorPanes.push({
      key: "rsi",
      lines: [{ values: indicators.rsiVals, color: cfg.rsi.color, ...st(cfg.rsi) }],
      bounds: [0, 100],
      refLines: [{ value: 30, color: "#2A3140" }, { value: 70, color: "#2A3140" }],
      stretchFactor: 1.4,
    });
  }
  if (cfg.macd.enabled) {
    indicatorPanes.push({
      key: "macd",
      lines: [
        { values: indicators.macdVals.macdLine, color: cfg.macd.color, ...st(cfg.macd) },
        { values: indicators.macdVals.signalLine, color: "#FF6D00", ...st(cfg.macd) },
      ],
      histogram: { values: indicators.macdVals.histogram, upColor: "#2ED9A055", downColor: "#FF5C7755" },
      stretchFactor: 1.4,
    });
  }
  if (cfg.stochrsi.enabled) {
    indicatorPanes.push({
      key: "stochrsi",
      lines: [
        { values: indicators.stochRsiVals.k, color: cfg.stochrsi.color, ...st(cfg.stochrsi) },
        { values: indicators.stochRsiVals.d, color: "#FF6D00", ...st(cfg.stochrsi) },
      ],
      bounds: [0, 100],
      refLines: [{ value: 20, color: "#2A3140" }, { value: 80, color: "#2A3140" }],
      stretchFactor: 1.4,
    });
  }

  // Batch 2 panes
  if (cfg.atr.enabled) indicatorPanes.push({ key: "atr", lines: [{ values: indicators.atrVals, color: cfg.atr.color, ...st(cfg.atr) }], stretchFactor: 1.2 });
  if (cfg.adx.enabled) {
    indicatorPanes.push({
      key: "adx",
      lines: [
        { values: indicators.adxVals.adx, color: cfg.adx.color, ...st(cfg.adx) },
        { values: indicators.adxVals.plusDI, color: "#4CAF50", ...st(cfg.adx) },
        { values: indicators.adxVals.minusDI, color: "#F44336", ...st(cfg.adx) },
      ],
      bounds: [0, 100],
      stretchFactor: 1.4,
    });
  }
  if (cfg.aroon.enabled) {
    indicatorPanes.push({
      key: "aroon",
      lines: [
        { values: indicators.aroonVals.up, color: "#2ED9A0", ...st(cfg.aroon) },
        { values: indicators.aroonVals.down, color: "#FF5C77", ...st(cfg.aroon) },
      ],
      bounds: [0, 100],
      stretchFactor: 1.4,
    });
  }
  if (cfg.stoch.enabled) {
    indicatorPanes.push({
      key: "stoch",
      lines: [
        { values: indicators.stochVals.k, color: cfg.stoch.color, ...st(cfg.stoch) },
        { values: indicators.stochVals.d, color: "#FF6D00", ...st(cfg.stoch) },
      ],
      bounds: [0, 100],
      refLines: [{ value: 20, color: "#2A3140" }, { value: 80, color: "#2A3140" }],
      stretchFactor: 1.4,
    });
  }
  if (cfg.cci.enabled) indicatorPanes.push({ key: "cci", lines: [{ values: indicators.cciVals, color: cfg.cci.color, ...st(cfg.cci) }], stretchFactor: 1.2 });
  if (cfg.williamsr.enabled) indicatorPanes.push({ key: "williamsr", lines: [{ values: indicators.williamsRVals, color: cfg.williamsr.color, ...st(cfg.williamsr) }], bounds: [-100, 0], stretchFactor: 1.2 });
  if (cfg.obv.enabled) indicatorPanes.push({ key: "obv", lines: [{ values: indicators.obvVals, color: cfg.obv.color, ...st(cfg.obv) }], stretchFactor: 1.2 });
  if (cfg.mom.enabled) indicatorPanes.push({ key: "mom", lines: [{ values: indicators.momVals, color: cfg.mom.color, ...st(cfg.mom) }], stretchFactor: 1.2 });
  if (cfg.roc.enabled) indicatorPanes.push({ key: "roc", lines: [{ values: indicators.rocVals, color: cfg.roc.color, ...st(cfg.roc) }], stretchFactor: 1.2 });
  if (cfg.ao.enabled) indicatorPanes.push({ key: "ao", histogram: { values: indicators.aoVals, upColor: "#2ED9A055", downColor: "#FF5C7755" }, stretchFactor: 1.2 });
  if (cfg.ac.enabled) indicatorPanes.push({ key: "ac", histogram: { values: indicators.acVals, upColor: "#2ED9A055", downColor: "#FF5C7755" }, stretchFactor: 1.2 });
  if (cfg.stddev.enabled) indicatorPanes.push({ key: "stddev", lines: [{ values: indicators.stddevVals, color: cfg.stddev.color, ...st(cfg.stddev) }], stretchFactor: 1.2 });
  if (cfg.mfi.enabled) indicatorPanes.push({ key: "mfi", lines: [{ values: indicators.mfiVals, color: cfg.mfi.color, ...st(cfg.mfi) }], bounds: [0, 100], refLines: [{ value: 20, color: "#2A3140" }, { value: 80, color: "#2A3140" }], stretchFactor: 1.4 });
  if (cfg.cmf.enabled) indicatorPanes.push({ key: "cmf", lines: [{ values: indicators.cmfVals, color: cfg.cmf.color, ...st(cfg.cmf) }], stretchFactor: 1.2 });
  if (cfg.bop.enabled) indicatorPanes.push({ key: "bop", lines: [{ values: indicators.bopVals, color: cfg.bop.color, ...st(cfg.bop) }], stretchFactor: 1.2 });
  if (cfg.trix.enabled) indicatorPanes.push({ key: "trix", lines: [{ values: indicators.trixVals, color: cfg.trix.color, ...st(cfg.trix) }], stretchFactor: 1.2 });
  if (cfg.efi.enabled) indicatorPanes.push({ key: "efi", lines: [{ values: indicators.efiVals, color: cfg.efi.color, ...st(cfg.efi) }], stretchFactor: 1.2 });
  if (cfg.ultosc.enabled) indicatorPanes.push({ key: "ultosc", lines: [{ values: indicators.ultoscVals, color: cfg.ultosc.color, ...st(cfg.ultosc) }], bounds: [0, 100], stretchFactor: 1.4 });

  // Batch 3 — generic pass over the registry, only computing/rendering
  // indicators the user actually turned on (same performance discipline
  // as the hand-wired ones above; several of these, e.g. Guppy MMA's 12
  // EMAs or Pivot Points, aren't free to compute on every render).
  BATCH3_REGISTRY.forEach((entry) => {
    const c = cfg[entry.key];
    if (!c?.enabled || candles.length === 0) return;
    const raw = entry.compute(candles, closes, c);
    if (entry.type === "overlay") {
      overlays.push(...entry.toOverlay(raw, c).map((l) => ({ ...l, ...st(c) })));
    } else {
      const paneConfig = entry.toPane(raw, c);
      indicatorPanes.push({
        key: entry.key,
        stretchFactor: 1.2,
        ...paneConfig,
        lines: (paneConfig.lines || []).map((l) => ({ ...l, ...st(c) })),
      });
    }
  });

  const toggleIndicator = (key) => setIndicatorConfig((c) => ({ ...c, [key]: { ...c[key], enabled: !c[key].enabled } }));
  const updateIndicator = (key, next) => setIndicatorConfig((c) => ({ ...c, [key]: next }));

  // Picker "add" semantics — force-enable rather than toggle, since picking
  // an indicator from search should always turn it on, even if it's
  // already enabled (re-selecting shouldn't silently turn it off).
  const handlePickerSelect = (entry) => {
    const key = CATALOG_ID_TO_DEF_KEY[entry.id];
    if (!key) return; // shouldn't happen for implemented:true entries, but stay safe
    setIndicatorConfig((c) => ({ ...c, [key]: { ...c[key], enabled: true } }));
  };

  const selectDrawTool = (key) => {
    setPendingPoints([]);
    setDrawTool((cur) => (cur === key ? null : key));
  };

  const handleChartClick = (time, price) => {
    if (!drawTool) return;

    // Magnet mode: snap to the nearest candle's exact time and its close
    // price, instead of wherever the tap/click landed pixel-wise. Matches
    // TradingView's magnet behavior for the common case (snapping to close,
    // not distinguishing which of OHLC is nearest).
    if (magnetOn && candles.length > 0) {
      let nearest = candles[0];
      let nearestDist = Infinity;
      for (const c of candles) {
        const d = Math.abs(c.t / 1000 - time);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = c;
        }
      }
      time = nearest.t / 1000;
      price = nearest.c;
    }

    if (drawTool === "eraser") {
      if (locked || drawings.length === 0 || candles.length === 0) return;
      const timeSpan = candles[candles.length - 1].t / 1000 - candles[0].t / 1000 || 1;
      const prices = candles.map((c) => c.c);
      const priceSpan = Math.max(...prices) - Math.min(...prices) || 1;
      let closestId = null;
      let closestDist = Infinity;
      drawings.forEach((d) => {
        d.points.forEach((p) => {
          const dNorm = Math.abs(p.time - time) / timeSpan + Math.abs(p.price - price) / priceSpan;
          if (dNorm < closestDist) {
            closestDist = dNorm;
            closestId = d.id;
          }
        });
      });
      // Threshold is generous since we're only comparing against a
      // drawing's anchor points, not the full rendered line/shape.
      if (closestId != null && closestDist < 0.08) {
        setDrawings((prev) => prev.filter((d) => d.id !== closestId));
      }
      return;
    }

    const toolDef = ALL_DRAW_TOOLS.find((t) => t.key === drawTool);
    const point = { time, price };

    if (drawTool === "text") {
      const text = window.prompt("Note text:");
      if (text) {
        setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: "text", points: [point], text, color: "#E8EAED" }]);
      }
      setDrawTool(null);
      return;
    }

    if (toolDef.clicksNeeded === "unlimited") {
      // Polygon/Polyline/Path — keeps accumulating points on every click;
      // there's no fixed count to auto-finish on, so the person taps a
      // "done" button (rendered in the header overlay) to close it out,
      // or cancels to discard what's been placed so far.
      setPendingPoints((prev) => [...prev, point]);
      return;
    }

    const nextPoints = [...pendingPoints, point];
    if (nextPoints.length < toolDef.clicksNeeded) {
      setPendingPoints(nextPoints);
    } else {
      setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: drawTool, points: nextPoints }]);
      setPendingPoints([]);
      setDrawTool(null);
    }
  };

  const finishUnlimitedDrawing = () => {
    if (pendingPoints.length >= 2) {
      setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: drawTool, points: pendingPoints }]);
    }
    setPendingPoints([]);
    setDrawTool(null);
  };

  const cancelDrawing = () => {
    setPendingPoints([]);
    setDrawTool(null);
  };

  // Brush/Highlighter capture a whole freehand stroke in Chart.jsx (via
  // native pointer events, since lightweight-charts' click handler only
  // fires on discrete taps, not drag) and hand back the full point list
  // once the gesture ends — bypassing the click-by-click flow entirely.
  const handleFreehandComplete = (points) => {
    if (points.length < 2) return;
    setDrawings((prev) => [...prev, { id: `${Date.now()}`, type: drawTool, points, color: drawTool === "highlighter" ? "#F5B70066" : "#F5B700" }]);
    setDrawTool(null);
  };

  const removeDrawing = (id) => setDrawings((prev) => prev.filter((d) => d.id !== id));

  if (symbolsError) {
    return (
      <div style={{ padding: 40, color: "#FF5C77", fontFamily: "'Manrope', sans-serif" }}>
        {symbolsError}
        <div style={{ marginTop: 16 }}>
          <button onClick={onBack} style={{ background: "none", border: "1px solid #2A3140", color: "#E8EAED", padding: "8px 16px", borderRadius: 6, cursor: "pointer" }}>← back</button>
        </div>
      </div>
    );
  }

  if (!activeSymbol) {
    return <div style={{ padding: 40, color: "#8B93A3", fontFamily: "'Manrope', sans-serif" }}>Loading symbols...</div>;
  }

  const activeLabel = `${activeSymbol.display} · ${EXCHANGE_LABELS[activeSymbol.exchange] || activeSymbol.exchange} · ${MARKET_TYPE_LABELS[activeSymbol.marketType] || activeSymbol.marketType}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 16px", borderBottom: "1px solid #1D232F" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: "#8B93A3", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>← back</button>
          <SymbolSearch symbols={symbols} activeLabel={activeLabel} onSelect={setActiveSymbol} />
          <div style={{ marginLeft: "auto" }}>
            <PriceTicker candles={candles} connected={connected} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {["1m", "15m", "1h", "4h", "1d"].map((t) => (
              <button key={t} onClick={() => setTf(t)} style={{ background: tf === t ? "#191F2A" : "transparent", color: tf === t ? "#F5B700" : "#8B93A3", border: "1px solid " + (tf === t ? "#2A3140" : "transparent"), borderRadius: 6, padding: "5px 9px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 18, background: "#1D232F" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {Object.entries(INDICATOR_DEFS)
              .filter(([key]) => indicatorConfig[key]?.enabled)
              .map(([key, def]) => (
                <IndicatorChip key={key} indKey={key} def={def} cfg={indicatorConfig[key]} onToggle={toggleIndicator} onChange={updateIndicator} />
              ))}
            <button
              onClick={() => setPickerOpen(true)}
              style={{ background: "transparent", color: "#8B93A3", border: "1px solid #232A38", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}
            >
              + Indicators
            </button>
          </div>
        </div>
      </header>

      <div style={{ display: "flex", flex: "1 1 80%", minHeight: 0 }}>
        <aside style={{ width: 44, flexShrink: 0, borderRight: "1px solid #1D232F", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 5px", overflow: "visible" }}>
          <button
            onClick={() => { setDrawTool(null); setPendingPoints([]); }}
            title="Cursor"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 34, padding: "8px", fontSize: 15, cursor: "pointer",
              background: !drawTool ? "#F5B70022" : "transparent",
              color: !drawTool ? "#F5B700" : "#8B93A3",
              border: "1px solid " + (!drawTool ? "#F5B70055" : "#232A38"),
              borderRadius: 6,
            }}
          >
            ⊹
          </button>

          {DRAW_GROUPS.map((group) => (
            <ToolGroupDropdown key={group.key} group={group} activeTool={drawTool} onSelect={selectDrawTool} direction="right" />
          ))}

          <div style={{ width: "70%", height: 1, background: "#1D232F", margin: "4px 0" }} />

          <button
            onClick={() => setMagnetOn((v) => !v)}
            title="Magnet mode — snap drawings to candle close"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, padding: "8px", fontSize: 14, cursor: "pointer", background: magnetOn ? "#F5B70022" : "transparent", color: magnetOn ? "#F5B700" : "#8B93A3", border: "1px solid " + (magnetOn ? "#F5B70055" : "#232A38"), borderRadius: 6 }}
          >
            ⊚
          </button>
          <button
            onClick={() => setLocked((v) => !v)}
            title={locked ? "Locked — drawings can't be erased" : "Unlocked"}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, padding: "8px", fontSize: 14, cursor: "pointer", background: locked ? "#F5B70022" : "transparent", color: locked ? "#F5B700" : "#8B93A3", border: "1px solid " + (locked ? "#F5B70055" : "#232A38"), borderRadius: 6 }}
          >
            {locked ? "🔒" : "🔓"}
          </button>
          <button
            onClick={() => setDrawingsHidden((v) => !v)}
            title={drawingsHidden ? "Drawings hidden — tap to show" : "Hide drawings"}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, padding: "8px", fontSize: 14, cursor: "pointer", background: "transparent", color: drawingsHidden ? "#4A5063" : "#8B93A3", border: "1px solid #232A38", borderRadius: 6 }}
          >
            👁
          </button>
          <button
            onClick={() => { if (drawings.length > 0 && window.confirm(`Remove all ${drawings.length} drawings?`)) setDrawings([]); }}
            title="Remove all drawings"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, padding: "8px", fontSize: 14, cursor: "pointer", background: "transparent", color: "#8B93A3", border: "1px solid #232A38", borderRadius: 6 }}
          >
            🗑
          </button>
        </aside>

        <main style={{ flex: 1, position: "relative", padding: "12px 16px 4px", minHeight: 0, display: "flex", flexDirection: "column" }}>
          {drawTool && (
            <div style={{ position: "absolute", top: 4, left: 16, zIndex: 5, display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", background: "#0B0E1499", padding: "2px 8px", borderRadius: 4 }}>
              {(() => {
                const toolDef = ALL_DRAW_TOOLS.find((t) => t.key === drawTool);
                const needed = toolDef?.clicksNeeded;
                if (needed === "freehand") return "drag to draw";
                if (needed === "unlimited") return `${pendingPoints.length} point${pendingPoints.length === 1 ? "" : "s"} placed`;
                const done = pendingPoints.length;
                return needed === 1 ? "click point" : `click point ${done + 1} of ${needed}`;
              })()}
              {ALL_DRAW_TOOLS.find((t) => t.key === drawTool)?.clicksNeeded === "unlimited" && (
                <>
                  <span onClick={finishUnlimitedDrawing} style={{ cursor: "pointer", color: pendingPoints.length >= 2 ? "#2ED9A0" : "#4A5063" }}>✓ done</span>
                  <span onClick={cancelDrawing} style={{ cursor: "pointer", color: "#FF5C77" }}>✕ cancel</span>
                </>
              )}
            </div>
          )}
          <WhalePulseLayer events={whaleEvents} candles={candles} />
          {loading ? (
            <div style={{ color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: 20 }}>loading candles...</div>
          ) : candles.length === 0 ? (
            <div style={{ color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: 20 }}>
              No historical candles yet for {activeLabel} — either it needs backfilling, or the relay hasn't written any live candles for it yet.
            </div>
          ) : (
            <TradingChart
              candles={candles}
              overlays={overlays}
              indicatorPanes={indicatorPanes}
              height="100%"
              up="#2ED9A0"
              down="#FF5C77"
              drawings={drawingsHidden ? [] : drawings}
              pendingPoints={pendingPoints}
              drawTool={drawTool}
              drawToolClicksNeeded={ALL_DRAW_TOOLS.find((t) => t.key === drawTool)?.clicksNeeded ?? 1}
              onChartClick={handleChartClick}
              onFreehandComplete={handleFreehandComplete}
              onLoadMore={loadMore}
            />
          )}
        </main>
      </div>

      {drawings.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 16px 8px" }}>
          {drawings.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 6, padding: "3px 8px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#8B93A3" }}>
              {d.type}{d.type === "text" ? `: ${d.text?.slice(0, 16)}` : ""}
              <span onClick={() => removeDrawing(d.id)} style={{ cursor: "pointer", color: "#FF5C77", fontWeight: 700 }}>×</span>
            </div>
          ))}
        </div>
      )}

      <AdSlot />
      <IndicatorPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={handlePickerSelect} />
    </div>
  );
}
