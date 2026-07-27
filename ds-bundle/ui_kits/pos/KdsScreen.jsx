// Kitchen Display — monitor dapur 1920×1080, tanpa login, dibaca dari 2 m.
// Seluruh layar dalam .kds-scale (--scale 1.6). Fulfillment per item.
const { Ticket, Badge, Icon, EmptyState } = window.LumiPOSDesignSystem_dae7d1;

function Clock() {
  const [t, setT] = React.useState(() => new Date().toLocaleTimeString('id-ID', { hour12: false }));
  React.useEffect(() => {
    const id = setInterval(() => setT(new Date().toLocaleTimeString('id-ID', { hour12: false })), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="t-body num">{t}</span>;
}

function Col({ title, count, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-1) var(--space-3)', flex: 'none' }}>
        <span className="t-body-md">{title}</span>
        <span className="num" style={{ minWidth: 32, height: 32, display: 'grid', placeItems: 'center', padding: '0 8px', borderRadius: 999, background: 'var(--surface-alt)', fontSize: 'var(--text-caption)', fontWeight: 'var(--weight-medium)', color: 'var(--ink-muted)' }}>{count}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>{children}</div>
    </section>
  );
}

function KdsScreen() {
  return (
    <div className="kds-scale" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-sunk)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <span className="t-title">Kitchen Display</span>
        <Badge tone="success" icon={<span className="dot" />}>Tersambung</Badge>
        <span style={{ flex: 1 }} />
        <Clock />
      </header>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', padding: 'var(--space-3)', minHeight: 0 }}>
        <Col title="Mengantre" count={2}>
          <Ticket code="A04" orderNo="ORD-0231" orderType="Dine In" waited="12m 04s" late
            items={[{ qty: 2, name: 'Americano', note: 'Extra shot · Less ice' }, { qty: 1, name: 'Butter Croissant', note: 'Dipanaskan' }]}
            status="queued" primaryLabel="Mulai Proses" />
          <Ticket code="TA-7" orderNo="ORD-0232" orderType="Takeaway" waited="1m 46s"
            items={[{ qty: 1, name: 'Kopi Susu Gula Aren' }]}
            status="queued" primaryLabel="Mulai Proses" />
        </Col>

        <Col title="Diproses" count={1}>
          <Ticket code="A01" orderNo="ORD-0230" orderType="Dine In" waited="3m 12s"
            items={[{ qty: 1, name: 'Latte', done: true }, { qty: 1, name: 'Nasi Goreng Kampung', note: 'Tidak pedas' }]}
            doneCount={1} status="processing" primaryLabel="Tandai Semua Siap" />
        </Col>

        <Col title="Siap" count={1}>
          <Ticket code="A02" orderNo="ORD-0229" orderType="Dine In" waited="0m 18s"
            items={[{ qty: 2, name: 'Cappuccino' }]}
            status="ready" primaryLabel="Sudah Diserahkan" />
        </Col>
      </div>
    </div>
  );
}
window.KdsScreen = KdsScreen;
