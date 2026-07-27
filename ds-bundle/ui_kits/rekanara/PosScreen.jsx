// POS — Open Register. Layar penuh (tanpa sidebar admin).
const { SegmentedControl, Button, Icon, Badge } = window.LumiPOSDesignSystem_dae7d1;

function PosScreen({ onExit }) {
  const [mode, setMode] = React.useState('Dine In');
  const [cat, setCat] = React.useState('All');
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--surface)' }}>
      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border)' }}>
        <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border)', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-subtle)' }}><Icon name="search" size={18} /></span>
          <input className="field" style={{ paddingLeft: 40 }} placeholder="Search product name or SKU…" />
        </div>
        <div className="row" style={{ gap: 'var(--space-2)', padding: 'var(--space-3)' }}>
          {['All', 'Kopi'].map((c) => (
            <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)} style={cat === c ? { background: 'var(--ink)', borderColor: 'var(--ink)', color: 'var(--on-accent)' } : undefined}>{c}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-3) var(--space-3)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-3)', alignContent: 'start' }}>
          <button className="card" style={{ padding: 0, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{ position: 'relative', aspectRatio: '1/1', background: 'var(--surface-alt)', display: 'grid', placeItems: 'center', color: 'var(--ink-subtle)' }}>
              <Icon name="coffee" size={32} />
              <span className="badge badge-warning" style={{ position: 'absolute', top: 8, left: 8 }}><Icon name="star" size={12} /></span>
              <span className="badge badge-neutral num" style={{ position: 'absolute', top: 8, right: 8 }}>153</span>
            </div>
            <div style={{ padding: 'var(--space-3)' }}>
              <div className="t-body-md">Americano</div>
              <div className="t-caption" style={{ textDecoration: 'line-through' }}>Rp 10.000</div>
              <div className="t-body-md num" style={{ color: 'var(--success)' }}>Rp 8.000</div>
            </div>
          </button>
        </div>
      </section>

      <aside style={{ width: 340, flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <div className="row between" style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border)' }}>
          <div className="row" style={{ gap: 'var(--space-2)' }}><span className="avatar" style={{ width: 32, height: 32 }}>S</span><div><div className="t-body-md">Super Admin User</div><div className="t-caption">Register #1</div></div></div>
          <Button variant="ghost" onClick={onExit}><Icon name="chevron-left" size={16} /> Exit</Button>
        </div>
        <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderBottom: '1px solid var(--border)' }}>
          <SegmentedControl options={['Direct', 'Dine In', 'Takeaway']} value={mode} onChange={setMode} ariaLabel="Order type" />
          <button className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}><Icon name="qr" size={16} /> Select Table</button>
          <button className="btn btn-secondary" style={{ justifyContent: 'space-between' }}><span className="row" style={{ gap: 8 }}><Icon name="user" size={16} /> Customer (Optional)</span><Icon name="chevron-down" size={16} /></button>
        </div>
        <div className="grow" style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-subtle)' }}>
          <div className="stack" style={{ alignItems: 'center', gap: 'var(--space-1)' }}><Icon name="receipt" size={40} /><div className="t-body-md" style={{ color: 'var(--ink-muted)' }}>Cart is Empty</div><div className="t-caption">Add items from the catalog</div></div>
        </div>
        <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border)' }}>
          <div className="num" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--space-3)' }}>
            <div className="row between" style={{ color: 'var(--ink-muted)' }}><span>Subtotal (0 items)</span><span>Rp 0</span></div>
            <div className="row between" style={{ color: 'var(--ink-muted)' }}><span>Tax (11%)</span><span>Rp 0</span></div>
            <div className="row between t-title"><span>Total</span><span style={{ color: 'var(--success)' }}>Rp 0</span></div>
          </div>
          <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <Button variant="secondary" fullWidth disabled>Save / Draft</Button>
            <Button variant="secondary" fullWidth disabled><Icon name="tag" size={16} /> Add Discount</Button>
          </div>
          <Button variant="primary" critical fullWidth disabled style={{ justifyContent: 'space-between' }}><span>Charge Total</span><span className="num">Rp 0 ›</span></Button>
        </div>
      </aside>
    </div>
  );
}
window.PosScreen = PosScreen;
