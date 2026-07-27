// Settings — Shop Settings dengan sub-navigasi & tab modul. (dalam AppShell)
const { Card, Tabs, Switch, Icon, Field } = window.LumiPOSDesignSystem_dae7d1;

function SettingRow({ title, desc, warn, checked, onChange, children }) {
  return (
    <div style={{ padding: 'var(--space-4)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', marginBottom: 'var(--space-3)' }}>
      <div className="row between" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div style={{ maxWidth: '46ch' }}>
          <div className="t-body-md">{title}</div>
          <div className="t-caption" style={{ marginTop: 2 }}>{desc}</div>
          {warn && <div className="t-caption" style={{ marginTop: 'var(--space-1)', color: 'var(--danger)' }}>{warn}</div>}
        </div>
        {onChange && <Switch checked={checked} onChange={onChange} ariaLabel={title} />}
      </div>
      {children}
    </div>
  );
}

function SettingsScreen() {
  const [side, setSide] = React.useState('Shop');
  const [tab, setTab] = React.useState('Inventory & Catalog');
  const [variant, setVariant] = React.useState(false);
  const [enterprise, setEnterprise] = React.useState(true);
  const [reservation, setReservation] = React.useState(true);
  const [deposit, setDeposit] = React.useState(true);
  const [tableTrack, setTableTrack] = React.useState(true);

  return (
    <div>
      <h1 className="t-heading" style={{ margin: '0 0 var(--space-1)' }}>Settings</h1>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-6)' }}>Manage your business and operational settings</p>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 'var(--space-6)' }}>
        <div className="stack" style={{ gap: 2 }}>
          {['Shop', 'Systems', 'Shift & Attendance'].map((s) => (
            <button key={s} className="shell-link" aria-current={side === s ? 'page' : undefined} onClick={() => setSide(s)} style={{ minHeight: 40 }}>{s}</button>
          ))}
        </div>

        <div>
          <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}><Icon name="settings" size={22} style={{ color: 'var(--accent)' }} /><span className="t-title-lg">Shop Settings</span></div>
          <p className="t-caption" style={{ margin: '0 0 var(--space-4)' }}>Adjust application behavior according to your business type.</p>

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Tabs value={tab} onChange={setTab} tabs={['Inventory & Catalog', 'POS & Checkout', 'Modules & Features', 'Auto-Journal']} />
          </div>

          {tab === 'Inventory & Catalog' && (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <Card className="card-pad">
                <div className="t-body-md" style={{ marginBottom: 'var(--space-3)' }}>Inventory &amp; Product Variant Methods</div>
                <SettingRow title="Use Variant Matrix Table"
                  desc={<>Enable this if you sell <strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Physical Goods / Retail</strong> where Size and Color variations have different stock in the warehouse.</>}
                  warn={<><strong style={{ fontWeight: 500 }}>DISABLE this option</strong> if you run an F&amp;B business. The matrix system will be replaced by the Linear Modifiers mechanism.</>}
                  checked={variant} onChange={setVariant} />
              </Card>
              <Card className="card-pad">
                <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}><Icon name="package" size={16} style={{ color: 'var(--warning)' }} /><span className="t-body-md">Advanced Inventory Management</span></div>
                <SettingRow title="Enable Enterprise Inventory Mode"
                  desc={<>Locks the stock column on the Products page to <strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Read-Only</strong>. All stock changes must be made through Stock Adjustment or Stock Opname modules.</>}
                  checked={enterprise} onChange={setEnterprise} />
              </Card>
            </div>
          )}

          {tab === 'Modules & Features' && (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <Card className="card-pad">
                <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}><Icon name="calendar" size={16} style={{ color: 'var(--violet)' }} /><span className="t-body-md">Reservation System</span></div>
                <SettingRow title="Enable Reservation Module"
                  desc={<>Allow customers to book tables in advance. When enabled, the <strong style={{ fontWeight: 500, color: 'var(--ink)' }}>Reservations</strong> menu appears in the sidebar.</>}
                  checked={reservation} onChange={setReservation} />
                <div style={{ borderLeft: '3px solid var(--violet-border)', paddingLeft: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
                  <SettingRow title="Buffer Time (minutes)" desc="Time window before and after a booking to block the table from double-booking.">
                    <div style={{ maxWidth: 200, marginTop: 'var(--space-2)' }}><Field defaultValue="30" inputMode="numeric" /></div>
                  </SettingRow>
                  <SettingRow title="Require Deposit" desc="If enabled, a deposit amount must be entered before confirming." checked={deposit} onChange={setDeposit} />
                </div>
              </Card>
              <Card className="card-pad">
                <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}><Icon name="table" size={16} style={{ color: 'var(--success)' }} /><span className="t-body-md">Table &amp; Dining</span></div>
                <SettingRow title="Table Tracking" desc="Show table number inputs on the POS sidebar so cashiers can assign orders to tables." checked={tableTrack} onChange={setTableTrack} />
              </Card>
            </div>
          )}

          {(tab === 'POS & Checkout' || tab === 'Auto-Journal') && (
            <Card className="card-pad"><div className="empty"><Icon name="settings" size={28} /><div className="t-body-md" style={{ color: 'var(--ink-muted)' }}>{tab}</div><div className="t-caption">Panel setelan ini di luar cakupan kit contoh.</div></div></Card>
          )}
        </div>
      </div>
    </div>
  );
}
window.SettingsScreen = SettingsScreen;
