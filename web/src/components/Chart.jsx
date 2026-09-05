import { useEffect, useLayoutEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from "lightweight-charts";

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const fmt = (p) => (p < 10 ? p.toFixed(4) : p.toFixed(2));
const toSeconds = (ms) => Math.floor(ms / 1000);

function toCandleData(candles) {
  const out = [];
  let last = -Infinity;
  for (const c of candles) {
    const time = toSeconds(c.t);
    if (time <= last) continue;
    last = time;
    out.push({ time, open: c.o, high: c.h, low: c.l, close: c.c });
  }
  return out;
}

function toVolumeData(candles, up, down) {
  const out = [];
  let last = -Infinity;
  for (const c of candles) {
    const time = toSeconds(c.t);
    if (time <= last) continue;
    last = time;
    out.push({ time, value: c.v, color: c.c >= c.o ? up : down });
  }
  return out;
}

function toLineData(candles, values) {
  const out = [];
  let last = -Infinity;
  candles.forEach((c, i) => {
    const v = values[i];
    if (v == null) return;
    const time = toSeconds(c.t);
    if (time <= last) return;
    last = time;
    out.push({ time, value: v });
  });
  return out;
}

function toHistData(candles, values, upColor, downColor) {
  const out = [];
  let last = -Infinity;
  candles.forEach((c, i) => {
    const v = values[i];
    if (v == null) return;
    const time = toSeconds(c.t);
    if (time <= last) return;
    last = time;
    out.push({ time, value: v, color: v >= 0 ? upColor : downColor });
  });
  return out;
}

// Two invisible endpoints at [min, max] force a pane's autoscale to always
// span that full range, regardless of how narrow the real data's range is.
// Fixes oscillators (RSI/StochRSI) zooming into a tiny sliver when only a
// few candles' worth of history exists.
function toBoundsData(candles, min, max) {
  if (candles.length === 0) return [];
  const firstTime = toSeconds(candles[0].t);
  const lastTime = toSeconds(candles[candles.length - 1].t);
  if (lastTime <= firstTime) return [{ time: firstTime, value: min }];
  return [
    { time: firstTime, value: min },
    { time: lastTime, value: max },
  ];
}

/**
 * Unified trading chart — candles + volume on the main pane, any number of
 * overlay lines (MA/EMA/BB/VWAP) drawn on the same price scale, and any
 * number of indicator panes (RSI/MACD/StochRSI/...) stacked below, all
 * sharing one time axis with native zoom/pan/drag-to-scale.
 *
 * indicatorPanes: [{
 *   key, label, stretchFactor?,
 *   lines: [{ values, color, dash? }],
 *   histogram?: { values, upColor, downColor },
 *   bounds?: [min, max],             // fixes the pane's scale, e.g. [0,100] for RSI
 *   refLines?: [{ value, color }],   // e.g. RSI's 30/70 guides
 * }]
 *
 * Drawings use {time (unix seconds), price} points instead of screen
 * percentages, so they stay pinned to the right spot through pan/zoom.
 * Supported types: trendline, ray, extended, infoline, trendangle,
 * hline, horizontal, vertical, cross, fib, fibext, fibchannel,
 * fibtimezone, parallelchannel, disjointchannel, flattop, anchoredvwap,
 * rectangle, text.
 *
 * onLoadMore: called (at most once per pan gesture) when the visible range
 * scrolls near the left edge of what's currently loaded — this is how
 * backfilled history further back than the initial page gets pulled in.
 */
const FIB_EXT_LEVELS = [-0.618, -0.272, 0, 0.272, 0.618, 1, 1.272, 1.618, 2, 2.618];
const FIB_TIME_SEQUENCE = [1, 2, 3, 5, 8, 13, 21, 34, 55];

function anchoredVwapPoints(candles, anchorTimeSec) {
  let cumPV = 0, cumV = 0;
  const pts = [];
  for (const c of candles) {
    const t = toSeconds(c.t);
    if (t < anchorTimeSec) continue;
    const typical = (c.h + c.l + c.c) / 3;
    cumPV += typical * c.v;
    cumV += c.v;
    if (cumV > 0) pts.push({ time: t, value: cumPV / cumV });
  }
  return pts;
}
export function TradingChart({
  candles,
  overlays = [],
  indicatorPanes = [],
  height = 480,
  up = "#2ED9A0",
  down = "#FF5C77",
  drawings = [],
  pendingPoints = [],
  drawTool,
  drawToolClicksNeeded = 1,
  onChartClick,
  onFreehandComplete,
  onLoadMore,
}) {
  const containerRef = useRef(null);
  const overlaySvgRef = useRef(null);
  const chartRef = useRef(null);
  const mainSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const overlaySeriesRef = useRef([]);
  const paneSeriesRef = useRef({});
  const redrawDrawingsRef = useRef(() => {});
  const drawToolRef = useRef(drawTool);
  const onChartClickRef = useRef(onChartClick);
  const onFreehandCompleteRef = useRef(onFreehandComplete);
  const onLoadMoreRef = useRef(onLoadMore);
  const loadMoreArmedRef = useRef(true); // debounce: only fire once per approach to the edge
  const hoverPointRef = useRef(null); // live {time, price} under the pointer — drives the rubber-band preview
  const clicksNeededRef = useRef(drawToolClicksNeeded);
  const isPaintingRef = useRef(false); // true while a brush/highlighter stroke is actively being dragged
  const freehandPointsRef = useRef([]);

  useEffect(() => {
    drawToolRef.current = drawTool;
    onChartClickRef.current = onChartClick;
    onFreehandCompleteRef.current = onFreehandComplete;
    onLoadMoreRef.current = onLoadMore;
    clicksNeededRef.current = drawToolClicksNeeded;
  }, [drawTool, onChartClick, onFreehandComplete, onLoadMore, drawToolClicksNeeded]);

  // ---- create chart once ----
  useLayoutEffect(() => {
    const container = containerRef.current;
    const chart = createChart(container, {
      layout: { background: { color: "#0B0E14" }, textColor: "#8B93A3" },
      grid: { vertLines: { color: "#161B26" }, horzLines: { color: "#161B26" } },
      rightPriceScale: { borderColor: "#1D232F" },
      timeScale: { borderColor: "#1D232F", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(
      CandlestickSeries,
      { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down },
      0
    );
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } });
    mainSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" }, 0);
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    chart.subscribeClick((param) => {
      if (!drawToolRef.current || !param.point || param.time == null) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price == null) return;
      onChartClickRef.current?.(param.time, price);
    });

    const redraw = () => redrawDrawingsRef.current();
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    // Crosshair move fires on mouse hover (desktop) and on active touch-drag
    // (mobile) — there's no true "hover" on a phone before the first touch,
    // but this still drives the live preview during any pointer movement,
    // and is exactly the signal TradingView itself uses for both.
    chart.subscribeCrosshairMove((param) => {
      if (drawToolRef.current && param.point && param.time != null) {
        const price = candleSeries.coordinateToPrice(param.point.y);
        hoverPointRef.current = price == null ? null : { time: param.time, price };
      } else {
        hoverPointRef.current = null;
      }
      redraw();
    });

    // Brush/Highlighter: lightweight-charts' subscribeClick only fires on
    // discrete taps, not drag — so freehand capture happens via native
    // pointer events directly on the container instead, bypassing the
    // click-based drawing flow entirely.
    const isFreehandTool = () => drawToolRef.current === "brush" || drawToolRef.current === "highlighter";
    const capturePoint = (e) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = chart.timeScale().coordinateToTime(x);
      const price = candleSeries.coordinateToPrice(y);
      if (time != null && price != null) freehandPointsRef.current.push({ time, price });
    };
    const onPointerDown = (e) => {
      if (!isFreehandTool()) return;
      isPaintingRef.current = true;
      freehandPointsRef.current = [];
      capturePoint(e);
    };
    const onPointerMove = (e) => {
      if (!isPaintingRef.current) return;
      capturePoint(e);
      redraw();
    };
    const onPointerUp = () => {
      if (!isPaintingRef.current) return;
      isPaintingRef.current = false;
      if (freehandPointsRef.current.length >= 2) {
        onFreehandCompleteRef.current?.(freehandPointsRef.current.slice());
      }
      freehandPointsRef.current = [];
      redraw();
    };
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointerleave", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);


    // within 20 bars of the start of loaded data, ask the parent for an
    // older page. loadMoreArmedRef prevents re-firing on every pixel of
    // the same pan gesture — it re-arms once the user scrolls back away
    // from the edge (or once new data actually arrives and shifts things).
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || !onLoadMoreRef.current) return;
      if (range.from < 20) {
        if (loadMoreArmedRef.current) {
          loadMoreArmedRef.current = false;
          onLoadMoreRef.current();
        }
      } else {
        loadMoreArmedRef.current = true;
      }
    });

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointerleave", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- candles + volume ----
  useEffect(() => {
    if (!mainSeriesRef.current) return;
    mainSeriesRef.current.setData(toCandleData(candles));
    volumeSeriesRef.current.setData(toVolumeData(candles, up, down));
    redrawDrawingsRef.current();
  }, [candles, up, down]);

  // ---- overlay lines on the main pane (MA/EMA/BB/VWAP) ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    overlaySeriesRef.current.forEach((s) => chart.removeSeries(s));
    overlaySeriesRef.current = overlays.map((o) => {
      const s = chart.addSeries(
        LineSeries,
        { color: o.color, lineWidth: 1, lineStyle: o.dash ? 2 : 0, lastValueVisible: false, priceLineVisible: false },
        0
      );
      s.setData(toLineData(candles, o.values));
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays, candles]);

  // ---- indicator panes (RSI/MACD/StochRSI/...) ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    Object.values(paneSeriesRef.current).forEach((entry) => entry.forEach((s) => chart.removeSeries(s)));
    paneSeriesRef.current = {};

    indicatorPanes.forEach((pane, idx) => {
      const paneIndex = idx + 1;
      const series = [];

      (pane.lines || []).forEach((line, lineIdx) => {
        const s = chart.addSeries(
          LineSeries,
          { color: line.color, lineWidth: 1, lineStyle: line.dash ? 2 : 0, lastValueVisible: false, priceLineVisible: false },
          paneIndex
        );
        s.setData(toLineData(candles, line.values));
        series.push(s);

        // Reference guides (e.g. RSI's 30/70) hang off the first line series
        // in the pane — createPriceLine draws a fixed horizontal guide that
        // doesn't move with the data, exactly like TradingView's.
        if (lineIdx === 0 && pane.refLines) {
          pane.refLines.forEach((ref) => {
            s.createPriceLine({
              price: ref.value,
              color: ref.color || "#2A3140",
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: "",
            });
          });
        }
      });

      if (pane.histogram) {
        const s = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, paneIndex);
        s.setData(toHistData(candles, pane.histogram.values, pane.histogram.upColor, pane.histogram.downColor));
        series.push(s);
      }

      // Fixed-scale anchor — see toBoundsData's comment for why this exists.
      if (pane.bounds) {
        const [min, max] = pane.bounds;
        const s = chart.addSeries(
          LineSeries,
          { color: "transparent", lineVisible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false },
          paneIndex
        );
        s.setData(toBoundsData(candles, min, max));
        series.push(s);
      }

      paneSeriesRef.current[pane.key] = series;

      const p = chart.panes()[paneIndex];
      if (p) p.setStretchFactor(pane.stretchFactor ?? 1.5);
    });

    const mainPane = chart.panes()[0];
    if (mainPane) mainPane.setStretchFactor(indicatorPanes.length > 0 ? 5 : 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorPanes, candles]);

  // ---- drawings — SVG layer synced to chart coords ----
  useEffect(() => {
    const draw = () => {
      const chart = chartRef.current;
      const series = mainSeriesRef.current;
      const svg = overlaySvgRef.current;
      const container = containerRef.current;
      if (!chart || !series || !svg || !container) return;
      const rect = container.getBoundingClientRect();
      svg.setAttribute("width", rect.width);
      svg.setAttribute("height", rect.height);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const ns = "http://www.w3.org/2000/svg";
      const ts = chart.timeScale();
      let target = svg; // swapped to a translucent <g> during preview rendering
      const toXY = (p) => {
        const x = ts.timeToCoordinate(p.time);
        const y = series.priceToCoordinate(p.price);
        return x == null || y == null ? null : { x, y };
      };
      const addLine = (x1, y1, x2, y2, color, dash) => {
        const el = document.createElementNS(ns, "line");
        el.setAttribute("x1", x1);
        el.setAttribute("y1", y1);
        el.setAttribute("x2", x2);
        el.setAttribute("y2", y2);
        el.setAttribute("stroke", color);
        el.setAttribute("stroke-width", "1");
        if (dash) el.setAttribute("stroke-dasharray", dash);
        target.appendChild(el);
      };
      const addRect = (x1, y1, x2, y2, color) => {
        const el = document.createElementNS(ns, "rect");
        el.setAttribute("x", Math.min(x1, x2));
        el.setAttribute("y", Math.min(y1, y2));
        el.setAttribute("width", Math.abs(x2 - x1));
        el.setAttribute("height", Math.abs(y2 - y1));
        el.setAttribute("fill", color);
        el.setAttribute("fill-opacity", "0.12");
        el.setAttribute("stroke", color);
        el.setAttribute("stroke-width", "1");
        target.appendChild(el);
      };
      const addText = (x, y, text, color) => {
        const el = document.createElementNS(ns, "text");
        el.setAttribute("x", x);
        el.setAttribute("y", y);
        el.setAttribute("fill", color);
        el.setAttribute("font-size", "11");
        el.setAttribute("font-family", "'JetBrains Mono', monospace");
        el.textContent = text;
        target.appendChild(el);
      };
      const addPolyline = (pts, color) => {
        if (pts.length < 2) return;
        const el = document.createElementNS(ns, "polyline");
        el.setAttribute("points", pts.map((p) => `${p.x},${p.y}`).join(" "));
        el.setAttribute("fill", "none");
        el.setAttribute("stroke", color);
        el.setAttribute("stroke-width", "1.2");
        target.appendChild(el);
      };
      const addPath = (d, color, dash) => {
        const el = document.createElementNS(ns, "path");
        el.setAttribute("d", d);
        el.setAttribute("fill", "none");
        el.setAttribute("stroke", color);
        el.setAttribute("stroke-width", "1");
        if (dash) el.setAttribute("stroke-dasharray", dash);
        target.appendChild(el);
      };
      const addEllipse = (cx, cy, rx, ry, color) => {
        const el = document.createElementNS(ns, "ellipse");
        el.setAttribute("cx", cx);
        el.setAttribute("cy", cy);
        el.setAttribute("rx", Math.abs(rx));
        el.setAttribute("ry", Math.abs(ry));
        el.setAttribute("fill", color);
        el.setAttribute("fill-opacity", "0.12");
        el.setAttribute("stroke", color);
        el.setAttribute("stroke-width", "1");
        target.appendChild(el);
      };
      // Circle through 3 points (circumcircle) — used to draw an accurate
      // circular arc through a start, end, and "bulge" point, rather than
      // approximating with a bezier curve.
      const threePointCircle = (p1, p2, p3) => {
        const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
        if (Math.abs(d) < 1e-6) return null; // collinear — no finite circle
        const ux = ((p1.x ** 2 + p1.y ** 2) * (p2.y - p3.y) + (p2.x ** 2 + p2.y ** 2) * (p3.y - p1.y) + (p3.x ** 2 + p3.y ** 2) * (p1.y - p2.y)) / d;
        const uy = ((p1.x ** 2 + p1.y ** 2) * (p3.x - p2.x) + (p2.x ** 2 + p2.y ** 2) * (p1.x - p3.x) + (p3.x ** 2 + p3.y ** 2) * (p2.x - p1.x)) / d;
        return { cx: ux, cy: uy, r: Math.hypot(p1.x - ux, p1.y - uy) };
      };
      const extendPoint = (x1, y1, x2, y2, factor) => ({ x: x2 + (x2 - x1) * factor, y: y2 + (y2 - y1) * factor });
      // Linear interpolation along a line defined by two chart points, at
      // an arbitrary x pixel coordinate — used by channel tools to find
      // "where the trendline would be" at a third point's x position.
      const lineYatX = (p1, p2, x) => {
        if (p2.x === p1.x) return p1.y;
        const t = (x - p1.x) / (p2.x - p1.x);
        return p1.y + t * (p2.y - p1.y);
      };

      const renderOne = (d) => {
        if (d.type === "trendline") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) addLine(p1.x, p1.y, p2.x, p2.y, d.color || "#F5B700");
        } else if (d.type === "ray") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) {
            const far = extendPoint(p1.x, p1.y, p2.x, p2.y, 50);
            addLine(p1.x, p1.y, far.x, far.y, d.color || "#F5B700");
          }
        } else if (d.type === "extended") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) {
            const farA = extendPoint(p2.x, p2.y, p1.x, p1.y, 50);
            const farB = extendPoint(p1.x, p1.y, p2.x, p2.y, 50);
            addLine(farA.x, farA.y, farB.x, farB.y, d.color || "#F5B700");
          }
        } else if (d.type === "infoline") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) {
            addLine(p1.x, p1.y, p2.x, p2.y, d.color || "#F5B700");
            const priceA = d.points[0].price, priceB = d.points[1].price;
            const diff = priceB - priceA;
            const pct = priceA !== 0 ? (diff / priceA) * 100 : 0;
            const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
            addText(midX + 4, midY - 6, `${diff >= 0 ? "+" : ""}${fmt(diff)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`, d.color || "#F5B700");
          }
        } else if (d.type === "trendangle") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) {
            addLine(p1.x, p1.y, p2.x, p2.y, d.color || "#F5B700");
            const angle = (Math.atan2(-(p2.y - p1.y), p2.x - p1.x) * 180) / Math.PI;
            const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
            addText(midX + 4, midY - 6, `${angle.toFixed(1)}°`, d.color || "#F5B700");
          }
        } else if (d.type === "vertical") {
          const x = ts.timeToCoordinate(d.points[0].time);
          if (x != null) addLine(x, 0, x, rect.height, d.color || "#4FA9FF", "3,2");
        } else if (d.type === "cross") {
          const p1 = toXY(d.points[0]);
          if (p1) {
            addLine(0, p1.y, rect.width, p1.y, d.color || "#4FA9FF", "3,2");
            addLine(p1.x, 0, p1.x, rect.height, d.color || "#4FA9FF", "3,2");
          }
        } else if (d.type === "hline") {
          const p1 = toXY(d.points[0]);
          if (p1) {
            addLine(0, p1.y, rect.width, p1.y, d.color || "#2ED9A0", "4,3");
            addText(4, p1.y - 4, fmt(d.points[0].price), d.color || "#2ED9A0");
          }
        } else if (d.type === "horizontal") {
          const p1 = toXY(d.points[0]);
          if (p1) {
            addLine(0, p1.y, rect.width, p1.y, d.color || "#2ED9A0", "4,3");
            addText(4, p1.y - 4, fmt(d.points[0].price), d.color || "#2ED9A0");
          }
        } else if (d.type === "fib") {
          const priceA = d.points[0].price;
          const priceB = d.points[1].price;
          const high = Math.max(priceA, priceB);
          const low = Math.min(priceA, priceB);
          FIB_LEVELS.forEach((lv) => {
            const price = high - lv * (high - low);
            const y = series.priceToCoordinate(price);
            if (y == null) return;
            addLine(0, y, rect.width, y, d.color || "#7C5CFF", "2,2");
            addText(4, y - 4, `${(lv * 100).toFixed(1)}% ${fmt(price)}`, d.color || "#7C5CFF");
          });
        } else if (d.type === "fibext") {
          const a = d.points[0].price, b = d.points[1].price;
          const dir = b - a;
          FIB_EXT_LEVELS.forEach((lv) => {
            const price = a + lv * dir;
            const y = series.priceToCoordinate(price);
            if (y == null) return;
            addLine(0, y, rect.width, y, d.color || "#4FA9FF", "2,2");
            addText(4, y - 4, `${(lv * 100).toFixed(1)}% ${fmt(price)}`, d.color || "#4FA9FF");
          });
        } else if (d.type === "fibchannel") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          const p3 = toXY(d.points[2]);
          if (p1 && p2 && p3) {
            const far1 = extendPoint(p2.x, p2.y, p1.x, p1.y, 10);
            const far2 = extendPoint(p1.x, p1.y, p2.x, p2.y, 10);
            addLine(far1.x, far1.y, far2.x, far2.y, d.color || "#7C5CFF");
            const baseYatP3 = lineYatX(p1, p2, p3.x);
            const width = p3.y - baseYatP3; // pixel offset defining channel width
            [0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((lv) => {
              const offset = width * lv;
              const oFar1 = { x: far1.x, y: far1.y + offset };
              const oFar2 = { x: far2.x, y: far2.y + offset };
              addLine(oFar1.x, oFar1.y, oFar2.x, oFar2.y, d.color || "#7C5CFF", "2,2");
            });
          }
        } else if (d.type === "fibtimezone") {
          const startSec = d.points[0].time;
          const unitSec = Math.abs(d.points[1].time - d.points[0].time) || 1;
          FIB_TIME_SEQUENCE.forEach((n) => {
            const x = ts.timeToCoordinate(startSec + n * unitSec);
            if (x == null) return;
            addLine(x, 0, x, rect.height, d.color || "#F5B700", "2,3");
            addText(x + 2, 10, `${n}`, d.color || "#F5B700");
          });
        } else if (d.type === "parallelchannel") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          const p3 = toXY(d.points[2]);
          if (p1 && p2 && p3) {
            const far1 = extendPoint(p2.x, p2.y, p1.x, p1.y, 10);
            const far2 = extendPoint(p1.x, p1.y, p2.x, p2.y, 10);
            addLine(far1.x, far1.y, far2.x, far2.y, d.color || "#2ED9A0");
            const baseYatP3 = lineYatX(p1, p2, p3.x);
            const offset = p3.y - baseYatP3;
            addLine(far1.x, far1.y + offset, far2.x, far2.y + offset, d.color || "#2ED9A0");
          }
        } else if (d.type === "disjointchannel") {
          const a1 = toXY(d.points[0]);
          const a2 = toXY(d.points[1]);
          const b1 = toXY(d.points[2]);
          const b2 = toXY(d.points[3]);
          if (a1 && a2) {
            const farA1 = extendPoint(a2.x, a2.y, a1.x, a1.y, 10);
            const farA2 = extendPoint(a1.x, a1.y, a2.x, a2.y, 10);
            addLine(farA1.x, farA1.y, farA2.x, farA2.y, d.color || "#F5B700");
          }
          if (b1 && b2) {
            const farB1 = extendPoint(b2.x, b2.y, b1.x, b1.y, 10);
            const farB2 = extendPoint(b1.x, b1.y, b2.x, b2.y, 10);
            addLine(farB1.x, farB1.y, farB2.x, farB2.y, d.color || "#F5B700");
          }
        } else if (d.type === "flattop") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          const p3 = toXY(d.points[2]);
          if (p1 && p2 && p3) {
            const flatY = Math.min(p1.y, p2.y); // "flat top" — higher of the two = smaller y
            addLine(p1.x, flatY, p2.x, flatY, d.color || "#FF9F40");
            addLine(p1.x, flatY, p3.x, p3.y, d.color || "#FF9F40");
            addLine(p2.x, flatY, p3.x, p3.y, d.color || "#FF9F40");
          }
        } else if (d.type === "anchoredvwap") {
          const pts = anchoredVwapPoints(candles, d.points[0].time)
            .map((p) => ({ x: ts.timeToCoordinate(p.time), y: series.priceToCoordinate(p.value) }))
            .filter((p) => p.x != null && p.y != null);
          addPolyline(pts, d.color || "#FF9F40");
        } else if (d.type === "circle") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) {
            const r = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            addEllipse(p1.x, p1.y, r, r, d.color || "#F5B700");
          }
        } else if (d.type === "ellipse") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) {
            addEllipse((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (p2.x - p1.x) / 2, (p2.y - p1.y) / 2, d.color || "#F5B700");
          }
        } else if (d.type === "triangle") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          const p3 = toXY(d.points[2]);
          if (p1 && p2 && p3) {
            const el = document.createElementNS(ns, "polygon");
            el.setAttribute("points", `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`);
            el.setAttribute("fill", d.color || "#F5B700");
            el.setAttribute("fill-opacity", "0.12");
            el.setAttribute("stroke", d.color || "#F5B700");
            el.setAttribute("stroke-width", "1");
            target.appendChild(el);
          }
        } else if (d.type === "curve") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          const p3 = toXY(d.points[2]); // control point — the curve bulges toward this
          if (p1 && p2 && p3) addPath(`M ${p1.x} ${p1.y} Q ${p3.x} ${p3.y} ${p2.x} ${p2.y}`, d.color || "#F5B700");
        } else if (d.type === "arc") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          const p3 = toXY(d.points[2]); // a point the arc passes through
          if (p1 && p2 && p3) {
            const circ = threePointCircle(p1, p2, p3);
            if (circ) {
              const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
              const sweepFlag = cross > 0 ? 1 : 0;
              addPath(`M ${p1.x} ${p1.y} A ${circ.r} ${circ.r} 0 0 ${sweepFlag} ${p2.x} ${p2.y}`, d.color || "#F5B700");
            } else {
              addLine(p1.x, p1.y, p2.x, p2.y, d.color || "#F5B700"); // 3 points in a line — no arc possible
            }
          }
        } else if (d.type === "polygon") {
          const pts = d.points.map(toXY).filter(Boolean);
          if (pts.length >= 2) {
            const el = document.createElementNS(ns, "polygon");
            el.setAttribute("points", pts.map((p) => `${p.x},${p.y}`).join(" "));
            el.setAttribute("fill", d.color || "#F5B700");
            el.setAttribute("fill-opacity", "0.1");
            el.setAttribute("stroke", d.color || "#F5B700");
            el.setAttribute("stroke-width", "1");
            target.appendChild(el);
          }
        } else if (d.type === "polyline" || d.type === "path") {
          const pts = d.points.map(toXY).filter(Boolean);
          addPolyline(pts, d.color || "#F5B700");
        } else if (d.type === "brush") {
          const pts = d.points.map(toXY).filter(Boolean);
          addPolyline(pts, d.color || "#F5B700");
        } else if (d.type === "highlighter") {
          const pts = d.points.map(toXY).filter(Boolean);
          if (pts.length >= 2) {
            const el = document.createElementNS(ns, "polyline");
            el.setAttribute("points", pts.map((p) => `${p.x},${p.y}`).join(" "));
            el.setAttribute("fill", "none");
            el.setAttribute("stroke", d.color || "#F5B70066");
            el.setAttribute("stroke-width", "8");
            el.setAttribute("stroke-linecap", "round");
            el.setAttribute("stroke-linejoin", "round");
            el.setAttribute("opacity", "0.4");
            target.appendChild(el);
          }
        } else if (d.type === "rectangle") {
          const p1 = toXY(d.points[0]);
          const p2 = toXY(d.points[1]);
          if (p1 && p2) addRect(p1.x, p1.y, p2.x, p2.y, d.color || "#F5B700");
        } else if (d.type === "text") {
          const p1 = toXY(d.points[0]);
          if (p1 && d.text) addText(p1.x + 4, p1.y - 4, d.text, d.color || "#E8EAED");
        }
      };

      drawings.forEach(renderOne);

      pendingPoints.forEach((pt) => {
        const p = toXY(pt);
        if (p) {
          const el = document.createElementNS(ns, "circle");
          el.setAttribute("cx", p.x);
          el.setAttribute("cy", p.y);
          el.setAttribute("r", "4");
          el.setAttribute("fill", "#F5B700");
          svg.appendChild(el);
        }
      });

      // Live preview of the freehand stroke currently being dragged.
      if (isPaintingRef.current && freehandPointsRef.current.length > 1) {
        const pts = freehandPointsRef.current.map(toXY).filter(Boolean);
        addPolyline(pts, "#F5B700");
      }

      // ---- live rubber-band preview while placing a drawing ----
      const hover = hoverPointRef.current;
      if (drawToolRef.current && hover) {
        const needed = clicksNeededRef.current;
        const previewPoints = [...pendingPoints, hover];
        const previewGroup = document.createElementNS(ns, "g");
        previewGroup.setAttribute("opacity", "0.6");
        svg.appendChild(previewGroup);
        target = previewGroup;

        if (previewPoints.length === needed) {
          // Enough points to show the exact final shape, live.
          renderOne({ type: drawToolRef.current, points: previewPoints, color: "#F5B700" });
        } else if (pendingPoints.length > 0) {
          // Not enough for the real shape yet — a simple guide line from
          // the last placed point to the cursor is still useful feedback.
          const last = pendingPoints[pendingPoints.length - 1];
          const p1 = toXY(last);
          const p2 = toXY(hover);
          if (p1 && p2) addLine(p1.x, p1.y, p2.x, p2.y, "#F5B700", "3,2");
        }
        target = svg;
      }
    };
    redrawDrawingsRef.current = draw;
    draw();
  }, [drawings, pendingPoints, candles]);

  return (
    <div style={{ position: "relative", width: "100%", height, cursor: drawTool ? "crosshair" : "default" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <svg ref={overlaySvgRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
    </div>
  );
}
