import React, { useState } from "react";

const VARIANT_STYLES = {
  primary: { base: "var(--primary)", hover: "var(--accent-hover)", text: "var(--primary-foreground)", border: "none" },
  secondary: { base: "var(--card)", hover: "var(--secondary-hover)", text: "var(--foreground)", border: "1px solid var(--input-border)" },
  ghost: { base: "transparent", hover: "var(--ghost-hover-bg)", text: "var(--ghost-foreground)", border: "none" },
  danger: { base: "var(--destructive)", hover: "var(--destructive-hover)", text: "#ffffff", border: "none" },
};

export function Button({ children, variant = "primary", size = "default", disabled = false, loading = false, onClick }) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const v = VARIANT_STYLES[variant];
  const isDisabled = disabled || loading;
  return (
    <button
      disabled={isDisabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        height: size === "primaryAction" ? "var(--touch-primary)" : "var(--touch-min)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        borderRadius: "var(--radius-control)",
        padding: "0 var(--space-4)",
        fontSize: "var(--text-body)",
        fontWeight: "var(--font-weight-semibold)",
        fontFamily: "'Nunito Sans', sans-serif",
        whiteSpace: "nowrap",
        cursor: isDisabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : loading ? 0.7 : 1,
        transform: active && !isDisabled ? "translateY(1px)" : "none",
        transition: "background-color .15s ease, transform .1s ease",
        background: hover && !isDisabled ? v.hover : v.base,
        color: v.text,
        border: v.border,
      }}
    >
      {loading ? "Memuat..." : children}
    </button>
  );
}
