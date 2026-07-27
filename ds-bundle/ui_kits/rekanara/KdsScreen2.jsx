// Kitchen Display (varian ORIGEN) — Pending / Preparing / Ready to Serve.
// Layar penuh. Auto-refresh tiap 15s.
const { Button, Icon, Badge } = window.LumiPOSDesignSystem_dae7d1;

function KdsCol({ dot, title, count, children }) {
  return (
    <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row between" style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '2px solid var(--border)' }}>
        <span className="row t-body-md" style={{ gap: 'var(--space-2)' }}><span className="dot" style={{ background: dot, width: 10, height: 10 }} /> {title}</span>
        <span className="num t-body-md" style={{ color: 'var(--ink-muted)' }}>{count}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)' }}>{children}</div>
    </section>
  );
}

function KdsScreen2({ onExit }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface)' }}>
      <header className="row between" style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <Button variant="ghost" onClick={onExit} style={{ minWidth: 36, padding: 0 }}><Icon name="chevron-left" size={18} /></Button>
          <span style={{ color: 'var(--accent)' }}><Icon name="chef" size={20} /></span>
          <div><div className="t-title">Kitchen Display</div><div className="t-caption">Live order queue · Auto-refreshes every 15s</div></div>
        </div>
        <Button variant="secondary"><Icon name="refresh" size={16} /> Refresh Now</Button>
      </header>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <KdsCol dot="var(--danger)" title="Pending" count={1}>
          <article className="card" style={{ borderColor: 'var(--warning-border)', background: 'var(--warning-soft)', overflow: 'hidden' }}>
            <div className="row between" style={{ padding: 'var(--space-2) var(--space-3)' }}>
              <span className="t-caption num" style={{ fontWeight: 600 }}>ORD-20260430-JXAG5</span>
              <span className="t-caption num"><Icon name="clock" size={12} /> 09:11 (0m ago)</span>
            </div>
            <div className="row" style={{ gap: 'var(--space-2)', padding: '0 var(--space-3) var(--space-2)' }}>
              <Badge tone="warning">A04 — Dekat Pintu</Badge><span className="t-caption">by Super Admin User</span>
            </div>
            <div style={{ padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--warning-border)', background: 'var(--surface)' }}>
              <div className="row between">
                <label className="row" style={{ gap: 'var(--space-2)' }}><input type="checkbox" style={{ width: 18, height: 18 }} /><span className="t-body-md num">1× Americano</span></label>
                <button className="btn btn-danger" style={{ minHeight: 30, fontSize: 'var(--text-caption)' }}>Cancel</button>
              </div>
              <div className="t-caption" style={{ paddingLeft: 26 }}>+ Extra Sugar, Extra 2 Shot</div>
            </div>
            <div style={{ padding: 'var(--space-2) var(--space-3) var(--space-3)' }}>
              <Button variant="secondary" fullWidth>Start Preparing All <Icon name="chevron-right" size={16} /></Button>
            </div>
          </article>
        </KdsCol>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <KdsCol dot="var(--info)" title="Preparing" count={0}><div className="empty"><div className="t-caption">No orders</div></div></KdsCol>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <KdsCol dot="var(--success)" title="Ready to Serve" count={0}><div className="empty"><div className="t-caption">No orders</div></div></KdsCol>
      </div>
    </div>
  );
}
window.KdsScreen2 = KdsScreen2;
