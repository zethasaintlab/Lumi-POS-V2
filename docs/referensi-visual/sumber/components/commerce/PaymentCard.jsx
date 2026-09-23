import React, { useState } from "react";

const METHODS = ["Tunai", "QRIS", "Kartu", "Transfer"];

function formatRp(n) { return "Rp " + n.toLocaleString("id-ID"); }

function FieldStub({ label, value, hint }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", marginBottom: 6, fontSize: "var(--text-body)" }}>{label}</span>
      <input defaultValue={value} style={{ height: "var(--touch-min)", width: "100%", boxSizing: "border-box", borderRadius: "var(--radius-control)", border: "1px solid var(--input-border)", padding: "0 12px", fontSize: "var(--text-body)", fontFamily: "inherit" }} />
      {hint && <span style={{ display: "block", marginTop: 6, fontSize: "var(--text-small)", color: "var(--muted-foreground)" }}>{hint}</span>}
    </label>
  );
}

function QrisPanel({ state, onRegenerate }) {
  if (state === "loading") {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ margin: "0 auto", height: 192, width: 192, borderRadius: "var(--radius)", border: "1px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, padding: 16 }}>
          {Array.from({ length: 25 }).map((_, i) => <span key={i} style={{ borderRadius: 4, background: "var(--skeleton-bg)" }} />)}
        </div>
      </div>
    );
  }
  if (state === "confirmed") {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <span style={{ margin: "0 auto", display: "grid", placeItems: "center", height: 64, width: 64, borderRadius: "50%", background: "var(--status-success-bg)", color: "var(--status-success-text)", fontSize: 28 }}>&#10003;</span>
        <h3 style={{ margin: "16px 0 0", fontSize: "var(--text-title)", fontWeight: "var(--font-weight-semibold)" }}>Pembayaran terkonfirmasi</h3>
        <p style={{ margin: "4px 0 0", fontSize: "var(--text-small)", color: "var(--muted-foreground)" }}>Dana masuk melalui QRIS.</p>
      </div>
    );
  }
  if (state === "expired") {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <span style={{ margin: "0 auto", display: "grid", placeItems: "center", height: 64, width: 64, borderRadius: "50%", background: "var(--status-danger-bg)", color: "var(--status-danger-text)", fontSize: 24 }}>&#8635;</span>
        <h3 style={{ margin: "16px 0 0", fontSize: "var(--text-title)", fontWeight: "var(--font-weight-semibold)" }}>Kode QR kedaluwarsa</h3>
        <p style={{ margin: "4px 0 0", fontSize: "var(--text-small)", color: "var(--muted-foreground)" }}>Buat kode baru untuk melanjutkan.</p>
        <button onClick={onRegenerate} style={{ marginTop: 16, height: "var(--touch-min)", padding: "0 16px", borderRadius: "var(--radius-control)", border: "none", background: "var(--primary)", color: "var(--primary-foreground)", fontSize: "var(--text-body)", fontWeight: "var(--font-weight-semibold)", fontFamily: "inherit", cursor: "pointer" }}>Buat kode baru</button>
      </div>
    );
  }
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ margin: "0 auto", height: 192, width: 192, borderRadius: "var(--radius)", background: "var(--card)", boxShadow: "var(--shadow-raised)", display: "grid", gridTemplateColumns: "repeat(9,1fr)", gap: 2, padding: 16 }}>
        {Array.from({ length: 81 }).map((_, i) => <span key={i} style={{ background: (i * 7) % 11 < 5 ? "var(--foreground)" : "#fff" }} />)}
      </div>
      <p style={{ margin: "16px 0 0", fontSize: "var(--text-body)" }}>Pindai QRIS untuk membayar</p>
      <p style={{ margin: "4px 0 0", fontSize: "var(--text-small)", color: "var(--muted-foreground)" }}>Berlaku selama 04:56</p>
    </div>
  );
}

/**
 * One card, a method toggle. Switching methods swaps the card's contents in place - it never
 * navigates to another page. qrisState drives the QRIS method's four sub-states.
 */
export function PaymentCard({ total = 50600, presets = [20000, 50000, 100000], qrisState = "ready", onQrisRegenerate }) {
  const [method, setMethod] = useState("Tunai");
  const [cash, setCash] = useState(presets[1]);
  const change = Math.max(0, cash - total);

  return (
    <section style={{
      borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--card)",
      overflow: "hidden", fontFamily: "'Nunito Sans', sans-serif", maxWidth: 480,
    }}>
      <div style={{ padding: 20, background: "var(--panel-subtle-bg)", borderBottom: "1px solid var(--border)" }}>
        <p style={{ margin: 0, fontSize: "var(--text-small)", textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted-foreground)" }}>Total belanja</p>
        <p style={{ margin: "4px 0 0", fontSize: "var(--text-display)", fontWeight: "var(--font-weight-bold)", color: "var(--foreground)" }}>{formatRp(total)}</p>
      </div>

      <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${METHODS.length}, 1fr)`, gap: 4, background: "var(--secondary)", borderRadius: "var(--radius-control)", padding: 4 }}>
          {METHODS.map((m) => (
            <button key={m} onClick={() => setMethod(m)} style={{
              height: 40, borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: "var(--text-small)", fontWeight: "var(--font-weight-semibold)", fontFamily: "inherit",
              background: method === m ? "var(--card)" : "transparent",
              color: method === m ? "var(--primary)" : "var(--muted-foreground)",
              boxShadow: method === m ? "var(--shadow-card)" : "none",
            }}>{m}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 20, minHeight: 260 }}>
        {method === "Tunai" && (
          <div>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", marginBottom: 6, fontSize: "var(--text-body)" }}>Nominal diterima</span>
              <input type="number" value={cash} onChange={(e) => setCash(Number(e.target.value))} style={{ height: "var(--touch-min)", width: "100%", boxSizing: "border-box", borderRadius: "var(--radius-control)", border: "1px solid var(--input-border)", padding: "0 12px", fontSize: "var(--text-body)", fontFamily: "inherit" }} />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {presets.map((n) => (
                <button key={n} onClick={() => setCash(n)} style={{ height: 44, padding: "0 14px", borderRadius: "var(--radius-control)", border: "1px solid var(--input-border)", background: "var(--card)", fontSize: "var(--text-body)", fontWeight: "var(--font-weight-semibold)", fontFamily: "inherit", cursor: "pointer" }}>{formatRp(n)}</button>
              ))}
            </div>
            <div style={{ marginTop: 24, borderRadius: "var(--radius)", background: "var(--accent-subtle)", padding: 20 }}>
              <p style={{ margin: 0, fontSize: "var(--text-small)", color: "var(--muted-foreground-strong-alt)" }}>Kembalian</p>
              <p style={{ margin: "4px 0 0", fontSize: "var(--text-display)", fontWeight: "var(--font-weight-bold)", color: "var(--primary)" }}>{formatRp(change)}</p>
            </div>
          </div>
        )}
        {method === "QRIS" && <QrisPanel state={qrisState} onRegenerate={onQrisRegenerate} />}
        {method === "Kartu" && (
          <div style={{ display: "grid", gap: 16 }}>
            <FieldStub label="Jenis kartu" value="Kartu Debit" />
            <FieldStub label="Nomor referensi" hint="Tercetak pada mesin EDC." />
          </div>
        )}
        {method === "Transfer" && (
          <div style={{ display: "grid", gap: 16 }}>
            <FieldStub label="Bank tujuan" value="BCA 123 456 7890" />
            <FieldStub label="Nomor referensi" hint="Masukkan nomor dari bukti transfer." />
          </div>
        )}
      </div>
    </section>
  );
}
