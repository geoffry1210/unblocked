import { useState } from "react";
import { Landing } from "./components/Landing.jsx";
import { AppShell } from "./components/AppShell.jsx";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Manrope:wght@400;500;600;700&display=swap');`;

export default function App() {
  const [view, setView] = useState("landing");
  return (
    <div style={{ width: "100%", height: "100vh", background: "var(--bg, #0B0E11)", fontFamily: "'Manrope', sans-serif" }}>
      <style>{`
        ${FONT_IMPORT}
        :root {
          --bg: #0B0E14;
          --surface: #191F2A;
          --surface2: #131720;
          --border: #1D232F;
          --border2: #232A38;
          --border3: #2A3140;
          --text: #E8EAED;
          --text-dim: #8B93A3;
          --text-faint: #4A5063;
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: var(--bg, #0B0E14); }
        @keyframes whalePulse {
          0% { box-shadow: 0 0 0 0 rgba(124,92,255,0.55); transform: scale(1); }
          70% { box-shadow: 0 0 0 16px rgba(124,92,255,0); transform: scale(1.15); }
          100% { box-shadow: 0 0 0 0 rgba(124,92,255,0); transform: scale(1); }
        }
        /* Mobile — the symbol sidebar is a fixed-width left column on
           desktop; below 700px that crowds out the chart itself, so it
           collapses into a horizontally-scrollable strip above the chart
           instead. Targets AppShell's .symbol-sidebar / .app-body classes. */
        @media (max-width: 700px) {
          .app-body { flex-direction: column; }
          .symbol-sidebar {
            width: 100% !important;
            border-right: none !important;
            border-bottom: 1px solid var(--border, #1D232F);
            display: flex !important;
            overflow-x: auto;
            overflow-y: hidden;
            white-space: nowrap;
            padding: 10px 12px !important;
          }
          .symbol-sidebar > div:first-child { display: none; }
          .symbol-sidebar > div { flex: 0 0 auto; margin-right: 6px; margin-bottom: 0 !important; }
        }
      `}</style>
      {view === "landing" ? (
        <Landing onLaunch={() => setView("app")} />
      ) : (
        <AppShell onBack={() => setView("landing")} />
      )}
    </div>
  );
}
