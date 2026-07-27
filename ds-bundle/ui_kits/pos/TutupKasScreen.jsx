// Tutup Kas — hitung fisik DULU, angka sistem menyusul. Form bertahap.
// Panel selisih tiga keadaan (kurang/lebih/pas). Menutup butuh PIN owner.
const { Card, Field, Button, Badge, Icon, ConfirmDialog } = window.LumiPOSDesignSystem_dae7d1;

const StepBadge = ({ n, done }) => (
  <span style={{ width: 24, height: 24, borderRadius: '50%', background: done ? 'var(--success)' : 'var(--accent)', color: 'var(--on-accent)', display: 'grid', placeItems: 'center', fontSize: 'var(--text-caption)', fontWeight: 'var(--weight-medium)', flex: 'none' }}>{n}</span>
);
const KV = ({ k, sub, v, strong }) => (
  <div className="row between" style={{ gap: 'var(--space-4)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border)' }}>
    <span className={strong ? 't-body-md' : 't-body'}>{k}{sub && <span className="t-caption"> · {sub}</span>}</span>
    <span className={'num ' + (strong ? 't-body-md' : 't-body')}>{v}</span>
  </div>
);

function TutupKasScreen() {
  const [counted] = React.useState('1.847.000');
  const [note, setNote] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [pin, setPin] = React.useState('');
  const [reason, setReason] = React.useState('');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-4) var(--space-3) var(--space-12)' }}>
      <header style={{ marginBottom: 'var(--space-6)' }}>
        <button className="btn btn-ghost" style={{ padding: '0 var(--space-2)', minHeight: 32, marginBottom: 'var(--space-1)' }}><Icon name="chevron-left" size={16} /> Kembali</button>
        <h1 className="t-title" style={{ margin: '0 0 var(--space-1)' }}>Tutup Kas</h1>
        <p className="t-caption" style={{ margin: 0 }}>Sesi dibuka Andi · 07:02 · Register K1 · berjalan 14j 58m</p>
      </header>

      <Card className="card-pad" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <StepBadge n={1} />
          <div><div className="t-body-md">Hitung uang fisik di laci</div><div className="t-caption">Hitung dulu, baru sistem menampilkan angkanya.</div></div>
        </div>
        <Field label="Total uang tunai yang dihitung" id="counted" size="lg" prefix="Rp" inputMode="numeric" defaultValue={counted} />
        <p className="t-caption" style={{ margin: 'var(--space-3) 0 0', padding: 'var(--space-3)', background: 'var(--surface-sunk)', borderRadius: 'var(--radius-control)' }}>
          Angka ekspektasi sistem sengaja disembunyikan sampai kolom ini terisi. Kalau ditampilkan lebih dulu, hitungan fisik cenderung disesuaikan agar cocok — dan selisih yang seharusnya ketahuan jadi tidak pernah muncul.
        </p>
      </Card>

      <Card className="card-pad" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <StepBadge n={2} done /><div className="t-body-md">Perbandingan</div>
        </div>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <KV k="Modal awal" v="Rp 300.000" />
          <KV k="Penjualan tunai" sub="47 transaksi" v="Rp 1.588.000" />
          <KV k="Refund tunai" sub="2 transaksi" v="− Rp 33.000" />
          <KV k="Kas diharapkan" v="Rp 1.855.000" strong />
          <KV k="Uang dihitung" v="Rp 1.847.000" />
        </div>
        <div style={{ borderRadius: 'var(--radius-card)', padding: 'var(--space-4)', border: '1px solid var(--danger-border)', background: 'var(--danger-soft)' }}>
          <div className="row between" style={{ alignItems: 'baseline', gap: 'var(--space-4)' }}>
            <div>
              <div className="t-caption" style={{ color: 'var(--danger)' }}>Selisih — kas kurang</div>
              <div className="t-display num" style={{ color: 'var(--danger)' }}>− Rp 8.000</div>
            </div>
            <Badge tone="danger">Wajib diberi catatan</Badge>
          </div>
        </div>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Field as="textarea" label="Catatan selisih" id="note" required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: kembalian kurang hitung sore, sudah dicek CCTV jam 16.40" />
        </div>
      </Card>

      <Card className="card-pad" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="t-body-md" style={{ marginBottom: 'var(--space-2)' }}>Non-tunai <span className="t-caption">· tidak masuk hitungan selisih</span></div>
        <KV k="QRIS" sub="31 transaksi" v="Rp 1.242.000" />
        <KV k="Kartu" sub="8 transaksi" v="Rp 704.000" />
      </Card>

      <Card className="card-pad" style={{ marginBottom: 'var(--space-4)', borderColor: 'var(--warning)' }}>
        <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)', color: 'var(--warning)' }}>
          <Icon name="alert" size={20} /><span className="t-body-md" style={{ color: 'var(--ink)' }}>Perlu diselesaikan sebelum menutup</span>
        </div>
        <div className="row between" style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border)' }}>
          <span className="t-body">2 open bill belum dibayar <span className="t-caption">· Meja A02, A05</span></span>
          <Button variant="secondary" style={{ minHeight: 38 }}>Lihat</Button>
        </div>
        <div className="row between" style={{ padding: 'var(--space-3) 0' }}>
          <span className="t-body">3 order belum tersinkron <span className="t-caption">· menunggu koneksi</span></span>
          <Button variant="secondary" style={{ minHeight: 38 }}>Coba kirim</Button>
        </div>
      </Card>

      <Button variant="primary" critical fullWidth onClick={() => setConfirm(true)}>Tutup Sesi Kas</Button>
      <p className="t-caption" style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>Sesi yang sudah ditutup tidak dapat diedit. Koreksi memerlukan sesi penyesuaian baru.</p>

      <ConfirmDialog
        open={confirm}
        title="Tutup sesi kas dengan selisih − Rp 8.000?"
        description="Sesi terkunci setelah ditutup. Butuh PIN owner untuk mengesahkan selisih."
        detail={<div className="row between"><span className="t-body-md">Selisih kas</span><span className="t-body-md num" style={{ color: 'var(--danger)' }}>− Rp 8.000</span></div>}
        reason={reason} onReason={setReason}
        pin={pin} onPin={setPin}
        confirmLabel="Tutup Sesi"
        onCancel={() => setConfirm(false)}
        onConfirm={() => setConfirm(false)} />
    </div>
  );
}
window.TutupKasScreen = TutupKasScreen;
