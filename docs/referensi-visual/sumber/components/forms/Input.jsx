import React from "react";

export function Input({ label, value, onChange, hint, error, type = "text", placeholder }) {
  return (
    <label style={{ display: "block", fontFamily: "'Nunito Sans', sans-serif" }}>
      <span style={{ display: "block", marginBottom: 6, fontSize: "var(--text-body)", fontWeight: "var(--font-weight-regular)", color: "var(--foreground)" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          height: "var(--touch-min)", width: "100%", boxSizing: "border-box",
          borderRadius: "var(--radius-control)",
          border: error ? "1px solid var(--destructive)" : "1px solid var(--input-border)",
          background: "var(--card)", padding: "0 12px",
          fontSize: "var(--text-body)", fontFamily: "inherit", color: "var(--foreground)",
          outline: "none",
        }}
      />
      {(hint || error) && (
        <span style={{ display: "block", marginTop: 6, fontSize: "var(--text-small)", color: error ? "var(--destructive)" : "var(--muted-foreground)" }}>
          {error || hint}
        </span>
      )}
    </label>
  );
}
