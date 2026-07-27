// Reservations — KPI ringkas + daftar booking (kosong). (dalam AppShell)
const { Card, Button, StatCard, Icon, EmptyState } = window.LumiPOSDesignSystem_dae7d1;

function ReservationsScreen() {
  return (
    <div>
      <div className="row between" style={{ marginBottom: 'var(--space-1)', gap: 'var(--space-4)' }}>
        <h1 className="t-heading" style={{ margin: 0 }}>Reservations</h1>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <Button variant="secondary"><Icon name="table" size={16} /> Monitoring</Button>
          <Button variant="primary"><Icon name="plus" size={16} /> New Booking</Button>
        </div>
      </div>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-4)' }}>Manage table bookings and guest arrivals.</p>

      <Card className="card-pad" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><div className="label">From date</div><input className="field" type="date" defaultValue="2026-05-08" style={{ width: 180 }} /></div>
          <div><div className="label">To date</div><input className="field" type="date" defaultValue="2026-05-08" style={{ width: 180 }} /></div>
          <Button variant="secondary"><Icon name="filter" size={16} /> Filter</Button>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <StatCard label="Today" value="0" tone="info" icon={<Icon name="calendar" size={16} />} hint="Bookings for today" />
        <StatCard label="Pending" value="0" tone="warning" icon={<Icon name="clock" size={16} />} hint="Needs confirmation" />
        <StatCard label="Seated" value="0" tone="success" icon={<Icon name="users" size={16} />} hint="Currently at tables" />
        <StatCard label="Completed" value="0" tone="violet" icon={<Icon name="check" size={16} />} hint="Sessions finished" />
        <StatCard label="Cancelled" value="0" tone="danger" icon={<Icon name="x" size={16} />} hint="Revoked bookings" />
        <StatCard label="Total Deposit" value="Rp 0" tone="accent" icon={<Icon name="receipt" size={16} />} hint="Collected for range" />
      </div>

      <Card pad={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr .6fr 1fr 1fr 1fr .8fr', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
          {['Guest', 'Time', 'Pax', 'Table', 'Deposit', 'Status', 'Actions'].map((h) => <span key={h} className="t-caption">{h}</span>)}
        </div>
        <EmptyState icon={<Icon name="calendar" size={32} />} title="No reservations found" />
      </Card>
    </div>
  );
}
window.ReservationsScreen = ReservationsScreen;
