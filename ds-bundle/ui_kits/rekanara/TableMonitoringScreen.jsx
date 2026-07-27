// Table Monitoring — status lantai real-time. (dalam AppShell)
const { Card, Chip, Badge, Icon } = window.LumiPOSDesignSystem_dae7d1;

const LEGEND = [['Available', 'success'], ['Occupied', 'danger'], ['Reserved', 'violet'], ['Cleaning', 'warning']];

function TableMonitoringScreen() {
  const [area, setArea] = React.useState('Indoor Area');
  const tables = [
    { code: 'A01', seats: 4 }, { code: 'A02', seats: 4 }, { code: 'A03', seats: 4 }, { code: 'A04', seats: 4 },
  ];
  return (
    <div>
      <div className="row between" style={{ marginBottom: 'var(--space-1)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <button className="btn btn-ghost" style={{ padding: '0 var(--space-2)', minHeight: 30, marginBottom: 4 }}><Icon name="chevron-left" size={14} /> Back to Management</button>
          <div className="t-title-lg">Table Monitoring</div>
          <div className="t-caption">Real-time status of your floor plan.</div>
        </div>
        <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {LEGEND.map(([l, tone]) => <span key={l} className="row t-caption" style={{ gap: 6 }}><span className="dot" style={{ background: `var(--${tone})` }} /> {l}</span>)}
        </div>
      </div>

      <div className="row" style={{ gap: 'var(--space-2)', margin: 'var(--space-4) 0' }}>
        <Chip selected={area === 'Indoor Area'} onClick={() => setArea('Indoor Area')}>Indoor Area <span className="num" style={{ marginLeft: 6, opacity: .7 }}>4</span></Chip>
        <Chip selected={area === 'Outdoor Area'} onClick={() => setArea('Outdoor Area')}>Outdoor Area <span className="num" style={{ marginLeft: 6, opacity: .7 }}>0</span></Chip>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
        {tables.map((t) => (
          <Card key={t.code} className="card-pad" style={{ minHeight: 140, display: 'flex', flexDirection: 'column', borderTop: '3px solid var(--success)' }}>
            <div className="row between"><span className="t-title-lg num">{t.code}</span><span style={{ color: 'var(--success)' }}><Icon name="check" size={18} /></span></div>
            <div className="t-caption num">{t.seats} Seats</div>
            <div className="grow" style={{ display: 'grid', placeItems: 'center' }}><span className="t-caption" style={{ letterSpacing: '.1em' }}>READY</span></div>
          </Card>
        ))}
        <Card className="card-pad" style={{ minHeight: 140, borderStyle: 'dashed' }}>
          <div className="row between" style={{ marginBottom: 'var(--space-2)' }}><span className="row t-body-md" style={{ gap: 6 }}><Icon name="clock" size={16} /> Pending Arrivals</span><Badge>0</Badge></div>
          <div className="empty" style={{ padding: 'var(--space-4) 0' }}><div className="t-caption">No pending bookings for today.</div></div>
          <button className="btn btn-ghost" style={{ width: '100%', color: 'var(--accent)' }}>View All Bookings</button>
        </Card>
      </div>
    </div>
  );
}
window.TableMonitoringScreen = TableMonitoringScreen;
