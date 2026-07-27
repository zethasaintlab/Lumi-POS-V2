// Dashboard — sambutan + absensi hari ini + ringkasan shift. (dalam AppShell)
const { Card, Button, StatCard, Icon, Badge } = window.LumiPOSDesignSystem_dae7d1;

function DashboardScreen() {
  const [clockedIn, setClockedIn] = React.useState(false);
  const days = Array.from({ length: 30 }, (_, i) => i + 1);
  return (
    <div style={{ maxWidth: 1080 }}>
      <h1 className="t-heading" style={{ margin: '0 0 var(--space-1)' }}>Dashboard</h1>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-6)' }}>
        Welcome, <strong style={{ fontWeight: 'var(--weight-medium)', color: 'var(--ink)' }}>Super Admin User</strong>! Here is a summary of your schedules &amp; activities.
      </p>

      <Card className="card-pad" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-border)', marginBottom: 'var(--space-4)' }}>
        <div className="row between" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 'var(--space-3)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="clock" size={20} /></span>
            <div>
              <div className="t-body-md">Today's Attendance</div>
              <div className="t-caption">{clockedIn ? 'Sesi kerja berjalan sejak 07:02.' : 'Please click Clock In to start or continue your work session.'}</div>
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <Button variant={clockedIn ? 'secondary' : 'primary'} onClick={() => setClockedIn(true)} disabled={clockedIn}><Icon name="chevron-right" size={16} /> Clock In</Button>
            <Button variant={clockedIn ? 'primary' : 'ghost'} onClick={() => setClockedIn(false)} disabled={!clockedIn}>Clock Out</Button>
          </div>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <StatCard label="Shifts This Month" value="0" tone="success" icon={<Icon name="calendar" size={16} />} hint="April 2026" />
        <StatCard label="Incoming Requests" value="0" tone="warning" icon={<Icon name="bell" size={16} />} hint="Waiting for your approval" />
        <Card className="card-pad">
          <div className="t-body-md" style={{ marginBottom: 'var(--space-2)' }}>Quick Actions</div>
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <Button variant="primary" fullWidth style={{ justifyContent: 'flex-start' }}><Icon name="swap" size={16} /> Swap Shift</Button>
            <Button variant="secondary" fullWidth style={{ justifyContent: 'flex-start', color: 'var(--warning)', borderColor: 'var(--warning-border)' }}><Icon name="calendar" size={16} /> Swap Day Off</Button>
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 'var(--space-4)' }}>
        <Card className="card-pad">
          <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}><Icon name="calendar" size={16} style={{ color: 'var(--accent)' }} /><span className="t-body-md">Shift Schedule — April 2026</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="t-caption" style={{ textAlign: 'center', padding: 'var(--space-2) 0', background: 'var(--surface-alt)', fontWeight: 'var(--weight-medium)' }}>{d}</div>)}
            {Array.from({ length: 3 }).map((_, i) => <div key={'e' + i} />)}
            {days.map((d) => <div key={d} className="t-caption num" style={{ minHeight: 36, padding: 'var(--space-1)', border: '1px solid var(--border)', color: 'var(--ink-muted)' }}>{d}</div>)}
          </div>
        </Card>
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          <Card className="card-pad" style={{ background: 'var(--warning-soft)', borderColor: 'var(--warning-border)' }}>
            <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}><span className="dot" style={{ background: 'var(--warning)' }} /><span className="t-body-md">Incoming Requests</span></div>
            <div className="t-caption" style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>No incoming requests.</div>
          </Card>
          <Card className="card-pad">
            <div className="row between" style={{ marginBottom: 'var(--space-3)' }}><span className="t-body-md">My Requests</span><Badge>0</Badge></div>
            <div className="t-caption" style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>No swap requests yet.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
window.DashboardScreen = DashboardScreen;
