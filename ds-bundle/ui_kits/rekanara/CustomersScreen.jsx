// Customers — daftar + modal New Customer. (dalam AppShell)
const { Card, Button, Modal, Field, Icon, EmptyState, Avatar } = window.LumiPOSDesignSystem_dae7d1;

const SAMPLE = [
  { name: 'Rara Anjani', phone: '0812 3456 7890', visits: 8, spent: 'Rp 412.000', last: '24 Jul 2026', source: 'POS' },
  { name: 'Dimas Prawira', phone: '0857 1122 3344', visits: 3, spent: 'Rp 138.000', last: '21 Jul 2026', source: 'QR Order' },
];

function CustomersScreen() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const rows = SAMPLE.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));
  return (
    <div>
      <div className="row between" style={{ marginBottom: 'var(--space-1)' }}>
        <h1 className="t-heading" style={{ margin: 0 }}>Customers</h1>
        <Button variant="primary" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> Add Customer</Button>
      </div>
      <p className="t-body" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--space-4)' }}>Manage your customer database.</p>

      <div style={{ position: 'relative', marginBottom: 'var(--space-4)', maxWidth: 420 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-subtle)' }}><Icon name="search" size={18} /></span>
        <input className="field" style={{ paddingLeft: 40 }} placeholder="Search by name, phone, or email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card pad={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr .8fr 1fr 1fr .8fr', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
          {['Customer', 'Phone', 'Visits', 'Spent', 'Last Visit', 'Source'].map((h) => <span key={h} className="t-caption">{h}</span>)}
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Icon name="users" size={32} />} title={q ? 'Tidak ada yang cocok' : 'Belum ada customer'} body={q ? 'Coba kata kunci lain.' : 'Tambah customer pertama.'} />
        ) : rows.map((c) => (
          <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr .8fr 1fr 1fr .8fr', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <div className="row" style={{ gap: 'var(--space-2)' }}><Avatar name={c.name} size={32} /><span className="t-body-md truncate">{c.name}</span></div>
            <span className="t-body num">{c.phone}</span>
            <span className="t-body num">{c.visits}</span>
            <span className="t-body num">{c.spent}</span>
            <span className="t-body num">{c.last}</span>
            <span className="badge badge-neutral">{c.source}</span>
          </div>
        ))}
      </Card>

      <Modal open={open} title="New Customer" onClose={() => setOpen(false)}
        footer={<><Button variant="ghost" fullWidth onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" fullWidth onClick={() => setOpen(false)}>Create Customer</Button></>}>
        <Field label="Name" id="c-name" required placeholder="Customer name" />
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <Field label="Phone" id="c-phone" placeholder="08xxxxxxxx" inputMode="tel" />
          <Field label="Email" id="c-email" placeholder="email@example.com" type="email" />
        </div>
        <p className="t-caption" style={{ margin: 0 }}>At least one of phone or email is required. Existing customers with the same phone/email will be automatically matched.</p>
        <Field label="Address" id="c-addr" as="textarea" placeholder="Address (optional)" />
        <Field label="Notes" id="c-notes" as="textarea" placeholder="Internal notes (optional)" />
      </Modal>
    </div>
  );
}
window.CustomersScreen = CustomersScreen;
