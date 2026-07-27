// Shift & Schedule — Roster Board + Swap Requests. (dalam AppShell)
const { Card, Button, Tabs, Icon, Chip } = window.LumiPOSDesignSystem_dae7d1;

const DAYS = [['Sun', 11], ['Mon', 12], ['Tue', 13], ['Wed', 14], ['Thu', 15], ['Fri', 16], ['Sat', 17]];
const ROWS = [
  { shift: 'Pagi', time: '08:00–15:00', min: 'Min 1', cells: ['Warehouse…', 'Cashier User', 'Warehouse…', null, 'Warehouse…', 'Warehouse…', 'Warehouse…'] },
  { shift: 'Malam', time: '15:00–22:00', min: 'Min 1', cells: ['Cashier User', 'Warehouse…', 'Cashier User', null, 'Cashier User', 'Cashier User', 'Cashier User'] },
];

function ShiftScheduleScreen() {
  const [tab, setTab] = React.useState('roster');
  return (
    <div>
      <div className="row between" style={{ marginBottom: 'var(--space-1)', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <h1 className="t-heading" style={{ margin: 0 }}>Shift &amp; Schedule</h1>
        <Button variant="primary"><Icon name="refresh" size={16} /> Generate Auto-Roster</Button>
      </div>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-4)' }}>Auto-Rostering Management &amp; POS Employee Schedule.</p>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'roster', label: <><Icon name="table" size={14} /> Roster Board</> },
          { value: 'swap', label: <><Icon name="swap" size={14} /> Swap Requests</> },
          { value: 'user', label: <><Icon name="user" size={14} /> User Shift</>, badge: 0 },
        ]} />
      </div>

      {tab === 'roster' ? (
        <Card pad={false} style={{ overflow: 'hidden' }}>
          <div className="row between" style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
            <Button variant="secondary" style={{ minHeight: 38 }}><Icon name="chevron-left" size={16} /> Prev</Button>
            <span className="t-body-md num">11 May – 17 May 2026</span>
            <Button variant="secondary" style={{ minHeight: 38 }}>Next <Icon name="chevron-right" size={16} /></Button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr>
                <th style={{ textAlign: 'left', padding: 'var(--space-3)', borderBottom: '1px solid var(--border)', width: 120 }}><span className="t-caption">Shift</span></th>
                {DAYS.map(([d, n], i) => <th key={d} style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--border)', background: i === 2 ? 'var(--accent-soft)' : undefined }}><div className="t-caption">{d}</div><div className="t-body-md num">{n}</div></th>)}
              </tr></thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.shift}>
                    <td style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                      <div className="t-body-md">{r.shift}</div><div className="t-caption num">{r.time}</div><div className="t-caption">{r.min}</div>
                    </td>
                    {r.cells.map((c, i) => (
                      <td key={i} style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', background: i === 2 ? 'var(--accent-soft)' : undefined, verticalAlign: 'top' }}>
                        {c ? <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', background: 'var(--surface)', marginBottom: 4 }}><span className="t-caption truncate" style={{ display: 'block' }}>{c}</span></div> : null}
                        <button className="btn btn-ghost" style={{ minHeight: 30, width: '100%', fontSize: 'var(--text-caption)', color: 'var(--accent)' }}><Icon name="plus" size={12} /> Assign</button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          <div className="row" style={{ gap: 'var(--space-3)' }}>
            <Button variant="primary" fullWidth><Icon name="swap" size={16} /> Create Shift Swap</Button>
            <Button variant="secondary" fullWidth style={{ color: 'var(--warning)', borderColor: 'var(--warning-border)' }}><Icon name="calendar" size={16} /> Create Day Off Swap</Button>
          </div>
          <Card pad={false}>
            <div className="row between" style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--warning-soft)', borderBottom: '1px solid var(--border)' }}>
              <span className="t-body-md" style={{ color: 'var(--warning)' }}>● Pending Approval</span><span className="t-caption">0 request</span>
            </div>
            <div className="t-caption" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>No pending requests.</div>
          </Card>
          <Card pad={false}>
            <div className="row between" style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
              <span className="t-body-md">Shift Swap History</span><span className="t-caption">0 entries</span>
            </div>
            <div className="t-caption" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>No history yet.</div>
          </Card>
        </div>
      )}
    </div>
  );
}
window.ShiftScheduleScreen = ShiftScheduleScreen;
