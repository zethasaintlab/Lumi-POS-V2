// Select a Table — alur pesan publik (QR). Re-skin Lumi.
const { Button, Icon, Badge } = window.LumiPOSDesignSystem_dae7d1;

const TABLES = [
  { name: 'Dekat Kolam Ikan', code: 'A01', seats: 2 },
  { name: 'Dekat Kolam kiri', code: 'A02', seats: 5 },
  { name: 'Dekat kolam kanan', code: 'A03', seats: 2 },
  { name: 'Dekat Pintu', code: 'A04', seats: 6 },
];

function SelectTableScreen() {
  return (
    <div style={{ minHeight: '100%', background: 'var(--surface)' }}>
      <header className="row between" style={{ padding: 'var(--space-4) var(--space-8)', borderBottom: '1px solid var(--border)' }}>
        <div className="row" style={{ gap: 'var(--space-2)' }}><span style={{ color: 'var(--accent)' }}><Icon name="coffee" size={22} /></span><span className="t-body-md">The Cafe by ORIGEN</span></div>
        <Button variant="primary">Dashboard</Button>
      </header>

      <section style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--space-8)' }}>
        <span className="badge badge-accent" style={{ marginBottom: 'var(--space-3)' }}><Icon name="table" size={14} /> Pilih Meja</span>
        <h1 className="t-heading" style={{ margin: '0 0 var(--space-1)' }}>Select a Table</h1>
        <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-2)' }}>Pilih meja dan masukkan kode akses untuk melanjutkan.</p>
        <div className="row t-caption" style={{ gap: 6, marginBottom: 'var(--space-4)' }}><span className="dot" style={{ background: 'var(--accent)' }} /> <span className="num">4</span> tersedia</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-3)' }}>
          {TABLES.map((t) => (
            <button key={t.code} className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer' }}>
              <div className="row between" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="row" style={{ gap: 'var(--space-2)' }}><span style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="table" size={18} /></span>
                  <div><div className="t-body-md">{t.name}</div><div className="t-caption">Main Hall</div></div></div>
                <Badge tone="accent">Available</Badge>
              </div>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span className="badge badge-neutral num"># {t.code}</span>
                <span className="badge badge-neutral num"><Icon name="users" size={12} /> {t.seats} kursi</span>
                <span className="badge badge-accent">Reservable</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
window.SelectTableScreen = SelectTableScreen;
