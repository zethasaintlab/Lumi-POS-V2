import React from "react";

/**
 * The cashier app's single top nav row. All actions visible at once - never buried in a nested menu.
 * Scoped to one app: LumiPOS's three apps do not share navigation.
 */
export function CashierNav({ items, activeId, onSelect }) {
  return (
    <nav style={{
      display: "flex", alignItems: "stretch", gap: 4, height: 72, maxHeight: 72,
      overflowX: "auto", background: "var(--card)", borderBottom: "1px solid var(--border)",
      fontFamily: "'Nunito Sans', sans-serif", padding: "0 8px",
    }}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button key={item.id} onClick={() => onSelect && onSelect(item.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 4, minWidth: 72, padding: "0 10px", background: "transparent", border: "none",
            borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
            color: active ? "var(--primary)" : "var(--muted-foreground)",
            fontSize: "var(--text-small)", fontWeight: "var(--font-weight-semibold)", fontFamily: "inherit",
            cursor: "pointer", whiteSpace: "nowrap",
          }}>
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
