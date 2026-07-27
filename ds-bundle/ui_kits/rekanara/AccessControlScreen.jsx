// Access Control — profil karyawan + analisis kepatuhan. (dalam AppShell)
const { Card, Tabs, Button, Avatar, Icon, StatCard } = window.LumiPOSDesignSystem_dae7d1;

function AccessControlScreen() {
  const [tab, setTab] = React.useState('Users');
  const [sub, setSub] = React.useState('Analisis');
  return (
    <div>
      <h1 className="t-heading" style={{ margin: '0 0 var(--space-1)' }}>Access Control Management</h1>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-4)' }}>Manage users, define roles, and assign granular permissions across the system.</p>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Tabs variant="underline" value={tab} onChange={setTab} tabs={['Users', 'Roles', 'Permissions']} />
      </div>

      <div className="row between" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <Button variant="ghost" style={{ minHeight: 36, padding: '0 var(--space-2)' }}><Icon name="chevron-left" size={16} /></Button>
          <div><div className="t-title-lg">Profil Karyawan</div><div className="t-caption">Detail informasi, kehadiran, dan analisis kepatuhan.</div></div>
        </div>
        <Button variant="secondary"><Icon name="edit" size={16} /> Edit User</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 'var(--space-4)' }}>
        <Card className="card-pad">
          <div className="stack" style={{ alignItems: 'center', gap: 'var(--space-2)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}>
            <Avatar name="Super Admin User" size={88} />
            <div className="t-title" style={{ marginTop: 'var(--space-2)' }}>Super Admin User</div>
            <div className="t-caption num">1001</div>
            <span className="badge badge-neutral">Super Admin</span>
          </div>
          <div className="stack" style={{ gap: 'var(--space-3)', paddingTop: 'var(--space-4)' }}>
            {[['mail', 'superadmin@example.com'], ['phone', '081234567890'], ['calendar', 'Bergabung: -'], ['map-pin', '901 Sheila Island Lake, Ofeliafort, CT 82248-8267']].map(([ic, tx]) => (
              <div key={tx} className="row" style={{ gap: 'var(--space-2)', alignItems: 'flex-start' }}><span style={{ color: 'var(--ink-subtle)', flex: 'none' }}><Icon name={ic} size={16} /></span><span className="t-body">{tx}</span></div>
            ))}
          </div>
        </Card>

        <div>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Tabs variant="underline" value={sub} onChange={setSub} tabs={[
              { value: 'Analisis', label: <><Icon name="activity" size={14} /> Analisis</> },
              { value: 'Kehadiran', label: <><Icon name="clock" size={14} /> Kehadiran</> },
              { value: 'Jadwal', label: <><Icon name="calendar" size={14} /> Jadwal Shift</> },
              { value: 'Cuti', label: <><Icon name="file" size={14} /> Cuti & Izin</> },
              { value: 'Profil', label: <><Icon name="user" size={14} /> Detail Profil</> },
            ]} />
          </div>

          <Card className="card-pad" style={{ background: 'var(--success-soft)', borderColor: 'var(--success-border)', marginBottom: 'var(--space-4)' }}>
            <div className="row" style={{ gap: 'var(--space-2)' }}><span style={{ color: 'var(--success)', flex: 'none' }}><Icon name="check" size={20} /></span>
              <div><div className="t-body-md" style={{ color: 'var(--success)' }}>Status Kepatuhan: Good</div><div className="t-caption">Semua metrik kehadiran dan cuti dalam kondisi baik. ✓</div></div>
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)' }}>
            <StatCard label="Tingkat Kehadiran" value="100%" tone="success" icon={<Icon name="activity" size={16} />} hint="Dari 0 jadwal bulan ini" />
            <StatCard label="Keterlambatan" value="0x" tone="accent" icon={<Icon name="clock" size={16} />} hint="Bulan ini (Toleransi 15m)" />
            <StatCard label="Absen / Mangkir" value="0x" tone="warning" icon={<Icon name="alert" size={16} />} hint="Tanpa keterangan bulan ini" />
            <StatCard label="Sisa Cuti" value="12 / 12" tone="violet" icon={<Icon name="calendar" size={16} />} hint="Belum eligible cuti tahunan" />
          </div>
        </div>
      </div>
    </div>
  );
}
window.AccessControlScreen = AccessControlScreen;
