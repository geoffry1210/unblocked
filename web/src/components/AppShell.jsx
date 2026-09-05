import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSymbols } from "../lib/api.js";
import { useMarketData } from "../lib/useMarketData.js";
import { sma, ema, bollinger, rsi, macd, vwap, stochRsi } from "../lib/indicators.js";
import { TradingChart } from "./Chart.jsx";
import { AdSlot } from "./AdSlot.jsx";

// Each indicator now carries its own config (period, color, etc.), not just
// an on/off flag — this is what makes the settings popover possible.
const INDICATOR_DEFS = {
  ma20: { label: "MA", type: "overlay", defaults: { enabled: true, period: 20, color: "#F5B700" } },
  ema9: { label: "EMA", type: "overlay", defaults: { enabled: false, period: 9, color: "#2ED9A0" } },
  bb: { label: "Bollinger", type: "overlay", defaults: { enabled: false, period: 20, mult: 2, color: "#7C5CFF" } },
  vwap: { label: "VWAP", type: "overlay", defaults: { enabled: false, color: "#FF9F40" } },
  rsi: { label: "RSI", type: "pane", defaults: { enabled: true, period: 14, color: "#7C5CFF" } },
  macd: { label: "MACD", type: "pane", defaults: { enabled: false, fast: 12, slow: 26, signal: 9, color: "#F5B700" } },
  stochrsi: { label: "Stoch RSI", type: "pane", defaults: { enabled: false, period: 14, smoothD: 3, color: "#2ED9A0" } },
};

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
    cfg[key] = { ...def.defaults };
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
function IndicatorSettings({ indKey, def, cfg, onChange, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  const numberField = (label, field, min = 1, max = 200) => (
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11, color: "#8B93A3", fontFamily: "'JetBrains Mono', monospace" }}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={cfg[field]}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange({ ...cfg, [field]: v });
        }}
        style={{ width: 56, background: "#0B0E14", border: "1px solid #2A3140", borderRadius: 4, color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: "3px 6px" }}
      />
    </label>
  );

  return (
    <div
      ref={ref}
      style={{ position: "absolute", top: "110%", left: 0, zIndex: 30, background: "#191F2A", border: "1px solid #2A3140", borderRadius: 8, padding: 12, width: 190, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace" }}>{def.label} settings</div>

      {"period" in cfg && numberField("Period", "period", 2, 200)}
      {"mult" in cfg && numberField("Std Dev ×", "mult", 1, 5)}
      {"fast" in cfg && numberField("Fast", "fast", 2, 100)}
      {"slow" in cfg && numberField("Slow", "slow", 2, 200)}
      {"signal" in cfg && numberField("Signal", "signal", 2, 50)}
      {"smoothD" in cfg && numberField("Smooth D", "smoothD", 1, 20)}

      <div>
        <div style={{ fontSize: 11, color: "#8B93A3", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>Color</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => onChange({ ...cfg, color: c })}
              style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: cfg.color === c ? "2px solid #E8EAED" : "2px solid transparent", cursor: "pointer" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function IndicatorChip({ indKey, def, cfg, onToggle, onChange }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasSettings = "period" in cfg || "fast" in cfg;

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
        {hasSettings && (
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candles, cfg.ma20.period, cfg.ema9.period, cfg.bb.period, cfg.bb.mult, cfg.rsi.period, cfg.macd.fast, cfg.macd.slow, cfg.macd.signal, cfg.stochrsi.period, cfg.stochrsi.smoothD]
  );

  const overlays = [];
  if (cfg.ma20.enabled) overlays.push({ values: indicators.smaVals, color: cfg.ma20.color });
  if (cfg.ema9.enabled) overlays.push({ values: indicators.emaVals, color: cfg.ema9.color });
  if (cfg.bb.enabled) {
    overlays.push({ values: indicators.bbVals.upper, color: cfg.bb.color, dash: true });
    overlays.push({ values: indicators.bbVals.lower, color: cfg.bb.color, dash: true });
  }
  if (cfg.vwap.enabled) overlays.push({ values: indicators.vwapVals, color: cfg.vwap.color });

  const indicatorPanes = [];
  if (cfg.rsi.enabled) {
    indicatorPanes.push({
      key: "rsi",
      lines: [{ values: indicators.rsiVals, color: cfg.rsi.color }],
      bounds: [0, 100],
      refLines: [{ value: 30, color: "#2A3140" }, { value: 70, color: "#2A3140" }],
      stretchFactor: 1.4,
    });
  }
  if (cfg.macd.enabled) {
    indicatorPanes.push({
      key: "macd",
      lines: [
        { values: indicators.macdVals.macdLine, color: cfg.macd.color },
        { values: indicators.macdVals.signalLine, color: "#7C5CFF" },
      ],
      histogram: { values: indicators.macdVals.histogram, upColor: "#2ED9A055", downColor: "#FF5C7755" },
      stretchFactor: 1.4,
    });
  }
  if (cfg.stochrsi.enabled) {
    indicatorPanes.push({
      key: "stochrsi",
      lines: [
        { values: indicators.stochRsiVals.k, color: cfg.stochrsi.color },
        { values: indicators.stochRsiVals.d, color: "#F5B700" },
      ],
      bounds: [0, 100],
      refLines: [{ value: 20, color: "#2A3140" }, { value: 80, color: "#2A3140" }],
      stretchFactor: 1.4,
    });
  }

  const toggleIndicator = (key) => setIndicatorConfig((c) => ({ ...c, [key]: { ...c[key], enabled: !c[key].enabled } }));
  const updateIndicator = (key, next) => setIndicatorConfig((c) => ({ ...c, [key]: next }));

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
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(INDICATOR_DEFS).map(([key, def]) => (
              <IndicatorChip key={key} indKey={key} def={def} cfg={indicatorConfig[key]} onToggle={toggleIndicator} onChange={updateIndicator} />
            ))}
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
    </div>
  );
}
