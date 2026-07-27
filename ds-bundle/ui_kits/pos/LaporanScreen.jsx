// Laporan — owner buka HP jam 23:00. Mobile-first; anomali di ATAS, grafik di bawah.
const { Card, Chip, Badge } = window.LumiPOSDesignSystem_dae7d1;

const KPI = ({ label, value, delta, dir }) => (
  <Card className="kpi">
    <div className="t-caption">{label}</div>
    <div className="v t-display num" style={{ margin: 'var(--space-1) 0 2px' }}>{value}</div>
    <div className="delta" style={{ fontSize: 'var(--text-caption)', fontWeight: 'var(--weight-medium)', color: dir === 'up' ? 'var(--success)' : 'var(--danger)' }}>{dir === 'up' ? '↑' : '↓'} {delta}</div>
  </Card>
);
const Rank = ({ badge, tone, title, sub }) => (
  <div className="row" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
    <Badge tone={tone}>{badge}</Badge>
    <div className="grow"><div className="t-body">{title}</div><div className="t-caption">{sub}</div></div>
  </div>
);
const BARS = [['08', 22], ['10', 38], ['12', 55], ['14', 42], ['15', 100], ['17', 71], ['19', 48], ['21', 26]];
const TOP = [['Kopi Susu Gula Aren', '31 terjual · Rp 775.000'], ['Americano', '24 terjual · Rp 192.000'], ['Butter Croissant', '19 terjual · Rp 418.000'], ['Matcha Latte', '15 terjual · Rp 420.000'], ['Nasi Goreng Kampung', '12 terjual · Rp 420.000']];

function LaporanScreen() {
  const [range, setRange] = React.useState('Hari ini');
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-4) var(--space-3) var(--space-12)' }}>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <h1 className="t-title" style={{ margin: '0 0 var(--space-1)' }}>Laporan</h1>
        <p className="t-caption" style={{ margin: 0 }}>The Cafe by ORIGEN · hari bisnis 26 Juli 2026 (04:00–04:00)</p>
      </header>

      <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', marginBottom: 'var(--space-4)' }}>
        {['Hari ini', '7 hari', '30 hari', 'Pilih tanggal'].map((r) => <Chip key={r} selected={range === r} onClick={() => setRange(r)}>{r}</Chip>)}
      </div>

      <div className="lap-kpis">
        <KPI label="Penjualan neto" value="Rp 3.501.000" delta="12% vs kemarin" dir="up" />
        <KPI label="Transaksi" value="86" delta="7% vs kemarin" dir="up" />
        <KPI label="Rata-rata / transaksi" value="Rp 40.709" delta="4%" dir="up" />
        <KPI label="Profit kasar" value="Rp 1.918.000" delta="3% vs kemarin" dir="down" />
      </div>

      <Card className="card-pad" style={{ margin: 'var(--space-4) 0', borderColor: 'var(--warning)' }}>
        <div className="row between" style={{ marginBottom: 'var(--space-3)' }}>
          <span className="t-body-md">Perlu perhatian</span><Badge tone="warning">3 hal</Badge>
        </div>
        <Rank badge="Oversell" tone="danger" title={<>Butter Croissant — stok jadi <span className="num">−1</span></>} sub="14:12 · dua kasir menjual item terakhir saat offline (K1 & K2)" />
        <Rank badge="Selisih kas" tone="danger" title={<>Kas kurang <span className="num">Rp 8.000</span></>} sub={'22:04 · sesi Andi · "kembalian kurang hitung sore"'} />
        <Rank badge="Refund" tone="warning" title={<>2 refund tunai · <span className="num">Rp 33.000</span></>} sub="Alasan: salah input (1), kualitas (1) · diotorisasi Dimas" />
      </Card>

      <div className="lap-grid2">
        <Card className="card-pad">
          <div className="t-body-md" style={{ marginBottom: 'var(--space-1)' }}>Penjualan per jam</div>
          <div className="t-caption" style={{ marginBottom: 'var(--space-2)' }}>Puncak 15:00–16:00</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)', height: 140, paddingTop: 'var(--space-2)' }} role="img" aria-label="Grafik penjualan per jam, puncak pukul 15.00">
            {BARS.map(([h, pct]) => (
              <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div style={{ width: '100%', height: pct + '%', background: 'var(--accent-soft)', borderRadius: '4px 4px 0 0', borderTop: '3px solid var(--accent)' }} />
                <span className="t-caption num">{h}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="card-pad">
          <div className="t-body-md" style={{ marginBottom: 'var(--space-2)' }}>Produk terlaris</div>
          {TOP.map(([n, s], i) => (
            <div key={n} className="row" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: i < TOP.length - 1 ? '1px solid var(--border)' : 0 }}>
              <span className="num" style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-alt)', display: 'grid', placeItems: 'center', fontSize: 'var(--text-caption)', fontWeight: 'var(--weight-medium)', color: 'var(--ink-muted)', flex: 'none' }}>{i + 1}</span>
              <div className="grow"><div className="t-body">{n}</div><div className="t-caption num">{s}</div></div>
            </div>
          ))}
        </Card>
      </div>

      <Card className="card-pad" style={{ marginTop: 'var(--space-4)' }}>
        <div className="t-body-md" style={{ marginBottom: 'var(--space-2)' }}>Metode pembayaran</div>
        <div className="row between" style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border)' }}><span className="t-body">Tunai</span><span className="t-body num">Rp 1.555.000</span></div>
        <div className="row between" style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border)' }}><span className="t-body">QRIS</span><span className="t-body num">Rp 1.242.000</span></div>
        <div className="row between" style={{ padding: 'var(--space-3) 0' }}><span className="t-body">Kartu</span><span className="t-body num">Rp 704.000</span></div>
      </Card>
    </div>
  );
}
window.LaporanScreen = LaporanScreen;
