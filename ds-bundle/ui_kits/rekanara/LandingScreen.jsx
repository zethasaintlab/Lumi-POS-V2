// Landing — halaman publik marketing (re-skin Lumi: aksen teal, Inter).
const { Button, Icon, Badge } = window.LumiPOSDesignSystem_dae7d1;

function LandingScreen() {
  return (
    <div style={{ minHeight: '100%', background: 'var(--surface)' }}>
      <header className="row between" style={{ padding: 'var(--space-4) var(--space-8)', maxWidth: 1200, margin: '0 auto' }}>
        <div className="row" style={{ gap: 'var(--space-2)' }}><span style={{ color: 'var(--accent)' }}><Icon name="coffee" size={22} /></span><span className="t-body-md">The Cafe by ORIGEN</span></div>
        <nav className="row" style={{ gap: 'var(--space-6)' }}>
          {['Menu', 'Tentang', 'Galeri', 'Testimoni', 'Meja'].map((n) => <a key={n} className="t-body" href="#" style={{ color: 'var(--ink-muted)' }}>{n}</a>)}
        </nav>
        <Button variant="primary">Dashboard</Button>
      </header>

      <section style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--space-8)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-12)', alignItems: 'center' }}>
        <div>
          <span className="badge badge-accent" style={{ marginBottom: 'var(--space-4)' }}><Icon name="coffee" size={14} /> Best coffee</span>
          <h1 className="t-hero" style={{ margin: '0 0 var(--space-4)' }}>Setiap Cangkir,<br /><span style={{ color: 'var(--accent)' }}>Sebuah Cerita</span></h1>
          <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-6)', maxWidth: '40ch' }}>The Cafe by ORIGEN is the best coffee shop in Purbalingga.</p>
          <div className="row" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-8)' }}>
            <button className="btn btn-primary btn-critical" style={{ background: 'var(--ink)' }}>Pesan Sekarang <Icon name="chevron-right" size={16} /></button>
            <Button variant="secondary" critical>Lihat Menu <Icon name="chevron-right" size={16} /></Button>
          </div>
          <div className="row" style={{ gap: 'var(--space-8)' }}>
            {[['100%', 'Arabica'], ['5.0', 'Rating'], ['Daily', 'Roasted']].map(([v, l]) => (
              <div key={l} className="row" style={{ gap: 'var(--space-2)' }}><span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name="star" size={14} /></span><div><div className="t-body-md num">{v}</div><div className="t-caption">{l}</div></div></div>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', aspectRatio: '4/5', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
          <image-slot id="rek-hero" shape="rounded" radius="16" placeholder="Foto barista / interior kafe" fit="cover"></image-slot>
        </div>
      </section>
    </div>
  );
}
window.LandingScreen = LandingScreen;
