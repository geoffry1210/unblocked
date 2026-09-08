import { useEffect, useMemo, useState } from "react";
import { INDICATOR_CATALOG } from "../lib/indicatorCatalog.js";

const FAVORITES_KEY = "unblocked.indicatorFavorites.v1";

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Category order/labels for the left sidebar — derived from the catalog's
// own `category` field (already there for every entry), just given a
// TradingView-like order instead of alphabetical.
const CATEGORY_ORDER = [
  "Moving Averages", "Oscillators", "Momentum", "Trend", "Volatility",
  "Volume", "Price", "Statistics", "Market breadth",
];

function highlightMatch(label, query) {
  if (!query) return label;
  const idx = label.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return label;
  return (
    <>
      {label.slice(0, idx)}
      <b style={{ color: "#F5B700" }}>{label.slice(idx, idx + query.length)}</b>
      {label.slice(idx + query.length)}
    </>
  );
}

// Standalone, self-contained — does not read or write any AppShell state.
// Integration point: onSelect(catalogEntry) fires when the user picks an
// `implemented: true` entry.
export function IndicatorPicker({ open, onClose, onSelect }) {
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(loadFavorites);
  const [activeSection, setActiveSection] = useState("favorites"); // "favorites" | a category name

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {
      // non-fatal — favorites just won't persist this session
    }
  }, [favorites]);

  useEffect(() => {
    if (open) { setQuery(""); setActiveSection("favorites"); }
  }, [open]);

  const toggleFavorite = (id, e) => {
    e.stopPropagation();
    setFavorites((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  };

  const categories = useMemo(() => {
    const present = new Set(INDICATOR_CATALOG.map((i) => i.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, []);

  // When searching, ignore the sidebar entirely and show every match,
  // grouped by category with headers — matches how typing "Atr" in the
  // real TradingView picker surfaces Technicals + Community sections at
  // once rather than confining you to whichever tab was open.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const matches = INDICATOR_CATALOG.filter((i) => i.label.toLowerCase().includes(q));
    const grouped = {};
    matches.forEach((m) => {
      grouped[m.category] = grouped[m.category] || [];
      grouped[m.category].push(m);
    });
    return grouped;
  }, [query]);

  const sectionEntries = useMemo(() => {
    if (activeSection === "favorites") {
      return INDICATOR_CATALOG.filter((i) => favorites.includes(i.id)).sort((a, b) => a.label.localeCompare(b.label));
    }
    return INDICATOR_CATALOG.filter((i) => i.category === activeSection).sort((a, b) => a.label.localeCompare(b.label));
  }, [activeSection, favorites]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "6vh" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#131720", border: "1px solid #2A3140", borderRadius: 10, width: "min(720px, 94vw)", maxHeight: "82vh", display: "flex", flexDirection: "column", fontFamily: "'Manrope', sans-serif" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #1D232F" }}>
          <span style={{ fontSize: 14, color: "#E8EAED", fontWeight: 600 }}>Indicators</span>
          <span onClick={onClose} style={{ cursor: "pointer", color: "#4A5063", fontSize: 16, padding: 4 }}>✕</span>
        </div>

        <div style={{ padding: "10px 16px", borderBottom: "1px solid #1D232F" }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search indicators..."
            style={{ width: "100%", background: "#0B0E14", border: "1px solid #2A3140", borderRadius: 6, padding: "9px 12px", color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, outline: "none" }}
          />
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Left sidebar — hidden while searching, matching the reference */}
          {!query && (
            <div style={{ width: 160, flexShrink: 0, borderRight: "1px solid #1D232F", padding: "10px 0", overflowY: "auto" }}>
              <div style={{ padding: "4px 14px 6px", fontSize: 10, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>PERSONAL</div>
              <SidebarRow label="★ Favorites" active={activeSection === "favorites"} onClick={() => setActiveSection("favorites")} />
              <div style={{ padding: "10px 14px 6px", fontSize: 10, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>CATEGORIES</div>
              {categories.map((c) => (
                <SidebarRow key={c} label={c} active={activeSection === c} onClick={() => setActiveSection(c)} />
              ))}
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
            {query ? (
              searchResults && Object.keys(searchResults).length > 0 ? (
                Object.entries(searchResults).map(([category, entries]) => (
                  <div key={category}>
                    <div style={{ padding: "8px 16px 4px", fontSize: 11, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>{category.toUpperCase()}</div>
                    {entries.map((entry) => (
                      <IndicatorRow key={entry.id} entry={entry} query={query} isFavorite={favorites.includes(entry.id)} onToggleFavorite={toggleFavorite} onSelect={onSelect} onClose={onClose} />
                    ))}
                  </div>
                ))
              ) : (
                <div style={{ padding: "20px 16px", color: "#4A5063", fontSize: 13 }}>No indicators match "{query}"</div>
              )
            ) : sectionEntries.length === 0 ? (
              <div style={{ padding: "20px 16px", color: "#4A5063", fontSize: 13 }}>
                {activeSection === "favorites" ? "Star an indicator to add it here." : "Nothing in this category yet."}
              </div>
            ) : (
              sectionEntries.map((entry) => (
                <IndicatorRow key={entry.id} entry={entry} query="" isFavorite={favorites.includes(entry.id)} onToggleFavorite={toggleFavorite} onSelect={onSelect} onClose={onClose} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarRow({ label, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: "7px 14px", fontSize: 13, cursor: "pointer", color: active ? "#F5B700" : "#8B93A3", background: active ? "#F5B70014" : "transparent" }}
    >
      {label}
    </div>
  );
}

function IndicatorRow({ entry, query, isFavorite, onToggleFavorite, onSelect, onClose }) {
  return (
    <div
      onClick={() => {
        if (!entry.implemented) return;
        onSelect(entry);
        onClose();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 16px",
        cursor: entry.implemented ? "pointer" : "default",
        opacity: entry.implemented ? 1 : 0.45,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 13, color: "#E8EAED" }}>{highlightMatch(entry.label, query)}</span>
        <span style={{ fontSize: 10, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace" }}>
          {entry.category}
          {!entry.implemented && " · coming soon"}
        </span>
      </div>
      <span
        onClick={(e) => onToggleFavorite(entry.id, e)}
        style={{ color: isFavorite ? "#F5B700" : "#2A3140", cursor: "pointer", fontSize: 15, padding: 4 }}
      >
        ★
      </span>
    </div>
  );
}
