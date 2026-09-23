import React from "react";

/**
 * image: a url string renders the photographed state. Omitted/undefined renders the unphotographed
 * state - intentionally nothing but name and price, never a gray placeholder box. The literal string
 * "failed" renders the named failed-to-load state (dashed frame, icon, word) so it reads as different
 * from "not photographed yet" - the two require different owner action.
 */
export function ProductCard({ name, price, image, onClick }) {
  const failed = image === "failed";
  const photographed = typeof image === "string" && !failed;
  return (
    <button onClick={onClick} style={{
      display: "block", textAlign: "left", width: "100%",
      minHeight: "var(--touch-primary)", overflow: "hidden",
      borderRadius: "var(--radius)", border: "1px solid var(--card-outline)",
      background: "var(--card)", cursor: "pointer", padding: 0, fontFamily: "'Nunito Sans', sans-serif",
    }}>
      {photographed && (
        <img src={image} alt={name} style={{ height: 72, width: "100%", objectFit: "cover", display: "block" }} />
      )}
      {failed && (
        <div style={{
          margin: 8, height: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          borderRadius: 8, border: "1px dashed var(--dashed-border)", background: "var(--dashed-bg)",
          fontSize: "var(--text-small)", color: "var(--muted-foreground)",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="21" x2="21" y2="3" />
          </svg>
          Gambar gagal
        </div>
      )}
      {/* unphotographed state: no third branch here, on purpose - that absence is the rule, not a gap */}
      <div style={{ padding: 10 }}>
        <p style={{ margin: 0, fontSize: "var(--text-body)", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</p>
        <p style={{ margin: "4px 0 0", fontSize: "var(--text-body)", color: "var(--primary)" }}>{price}</p>
      </div>
    </button>
  );
}
