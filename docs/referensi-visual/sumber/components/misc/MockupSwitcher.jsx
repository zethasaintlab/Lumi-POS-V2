import React from "react";

/**
 * Mockup-only helper bar - never ships in the product. Deliberately styled unlike any real LumiPOS
 * surface so it can never be mistaken for a feature. Scope its screen list to ONE app; never use this
 * to link between Kasir, Back-office, and Lumi-Order.
 */
export function MockupSwitcher({ appLabel, screens, activeScreen, onSelectScreen, dark, onToggleDark }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 50, height: 44, maxHeight: 44,
      display: "flex", alignItems: "center", gap: 12, padding: "0 14px",
      background: "var(--switcher-bg)", color: "#c7d4d5",
      fontFamily: "'Nunito Sans', sans-serif", fontSize: 13, fontWeight: 600,
    }}>
      <span style={{ opacity: .6, textTransform: "uppercase", letterSpacing: ".08em", fontSize: 11 }}>{appLabel}</span>
      <select value={activeScreen} onChange={(e) => onSelectScreen && onSelectScreen(e.target.value)} style={{
        background: "#2a3739", color: "#e7eeee", border: "none", borderRadius: 6, height: 28, padding: "0 8px", fontSize: 13, fontFamily: "inherit",
      }}>
        {screens.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <button onClick={onToggleDark} style={{ marginLeft: "auto", background: "#2a3739", color: "#e7eeee", border: "none", borderRadius: 6, height: 28, padding: "0 10px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>{dark ? "Terang" : "Gelap"}</button>
      <span style={{ opacity: .5, fontSize: 11 }}>Mockup preview</span>
    </div>
  );
}
