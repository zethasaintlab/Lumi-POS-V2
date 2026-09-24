import React from "react";

const TONES = {
  accent: { bg: "var(--accent-subtle)", text: "var(--primary)" },
  success: { bg: "var(--status-success-bg)", text: "var(--status-success-text)" },
  info: { bg: "var(--status-info-bg)", text: "var(--status-info-text)" },
  pending: { bg: "var(--status-pending-bg)", text: "var(--status-pending-text)" },
  warning: { bg: "var(--status-warning-bg)", text: "var(--status-warning-text)" },
  danger: { bg: "var(--status-danger-bg)", text: "var(--status-danger-text)" },
};

export function Badge({ children, tone = "pending" }) {
  const t = TONES[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      borderRadius: "var(--radius-pill)", padding: "4px 10px",
      fontSize: "var(--text-small)", fontWeight: "var(--font-weight-regular)",
      fontFamily: "'Nunito Sans', sans-serif",
      background: t.bg, color: t.text,
    }}>{children}</span>
  );
}
