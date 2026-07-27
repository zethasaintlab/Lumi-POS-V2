// Table Management — data master meja. (dalam AppShell)
const { Card, Button, Badge, Icon } = window.LumiPOSDesignSystem_dae7d1;

function TableManagementScreen() {
  const rows = window.REKANARA.tables;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 'var(--space-1)' }}>
        <h1 className="t-heading" style={{ margin: 0 }}>Tables</h1>
        <Button variant="primary"><Icon name="plus" size={16} /> Add Table</Button>
      </div>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-4)' }}>Manage your establishment's master table data.</p>

      <div className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Button variant="secondary"><Icon name="table" size={16} /> Monitoring</Button>
        <Button variant="secondary"><Icon name="layers" size={16} /> Manage Areas</Button>
        <Button variant="secondary"><Icon name="printer" size={16} /> Bulk Print QR</Button>
        <Button variant="secondary"><Icon name="download" size={16} /> Export QR</Button>
      </div>

      <Card pad={false}>
        <table className="table">
          <thead><tr>
            {['Code', 'Area', 'Capacity', 'Type', 'Group', 'Position', 'Status', 'Reservable', 'Actions'].map((h) => <th key={h}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.code}>
                <td className="t-body-md num">{t.code}</td>
                <td><span className="badge badge-neutral">{t.area}</span></td>
                <td className="num">{t.cap}</td>
                <td>{t.type}</td>
                <td>{t.group === '-' ? '-' : <span className="badge badge-neutral">{t.group}</span>}</td>
                <td className="num">{t.pos}</td>
                <td><Badge tone="success">Active</Badge></td>
                <td><Badge tone="success">{t.reservable ? 'Yes' : 'No'}</Badge></td>
                <td><button className="btn btn-ghost" style={{ minWidth: 36, padding: 0 }} aria-label="Aksi"><Icon name="more" size={18} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row between" style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <span className="t-caption">Showing <span className="num">1-4</span> of <span className="num">4</span></span>
          <span className="row t-caption" style={{ gap: 'var(--space-2)' }}><Icon name="filter" size={14} /> Per page: <select className="field" style={{ width: 64, minHeight: 32 }}><option>10</option><option>25</option></select></span>
        </div>
      </Card>
    </div>
  );
}
window.TableManagementScreen = TableManagementScreen;
