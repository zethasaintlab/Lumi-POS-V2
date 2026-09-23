import React from "react";

/** Follows the final layout it stands in for - never a generic circular spinner. */
export function SkeletonLoader({ shape = "card", count = 1 }) {
  const block = (key) => {
    if (shape === "qr") {
      return (
        <div key={key} style={{ height: 192, width: 192, borderRadius: "var(--radius)", border: "1px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, padding: 16 }}>
          {Array.from({ length: 25 }).map((_, i) => <span key={i} style={{ borderRadius: 4, background: "var(--skeleton-bg)" }} />)}
        </div>
      );
    }
    if (shape === "row") {
      return <div key={key} style={{ height: 20, borderRadius: 6, background: "var(--skeleton-bg)", marginBottom: 8 }} />;
    }
    if (shape === "text") {
      return <div key={key} style={{ height: 13, width: "60%", borderRadius: 4, background: "var(--skeleton-bg)", marginBottom: 6 }} />;
    }
    return <div key={key} style={{ height: 138, borderRadius: "var(--radius)", background: "var(--skeleton-bg)" }} />;
  };
  return <React.Fragment>{Array.from({ length: count }).map((_, i) => block(i))}</React.Fragment>;
}
