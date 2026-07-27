// Kasir — layar terpadat. Target utama tablet counter 1024×768.
// Keranjang = kolom kanan tetap di ≥900px; jadi bottom sheet di HP.
const { ProductCard, CartRow, SegmentedControl, Chip, Button, SyncIndicator, Icon } = window.LumiPOSDesignSystem_dae7d1;

const PRODUK = [
  ['Americano','KOP-01',8000,1,'Kopi'],['Cappuccino','KOP-02',22000,1,'Kopi'],['Latte','KOP-03',24000,1,'Kopi'],
  ['Espresso','KOP-04',15000,1,'Kopi'],['Kopi Susu Gula Aren','KOP-05',25000,1,'Kopi'],['V60 Single Origin','KOP-06',32000,1,'Kopi'],
  ['Matcha Latte','NKP-01',28000,1,'Non-Kopi'],['Chocolate','NKP-02',24000,1,'Non-Kopi'],['Lemon Tea','NKP-03',18000,1,'Non-Kopi'],
  ['Butter Croissant','PST-01',22000,1,'Pastry'],['Pain au Chocolat','PST-02',26000,0,'Pastry'],['Cinnamon Roll','PST-03',24000,1,'Pastry'],
  ['Nasi Goreng Kampung','MKN-01',35000,1,'Makanan'],['Chicken Sandwich','MKN-02',38000,1,'Makanan'],['French Fries','MKN-03',20000,1,'Makanan'],
  ['Banana Bread','PST-04',19000,1,'Pastry'],
];
const CATS = ['Semua','Kopi','Non-Kopi','Makanan','Pastry'];
const rupiah = (n) => 'Rp ' + n.toLocaleString('id-ID');

function KasirScreen() {
  const [cat, setCat] = React.useState('Semua');
  const [mode, setMode] = React.useState('Dine In');
  const [q, setQ] = React.useState('');
  const [cart, setCart] = React.useState([
    { name: 'Americano', mod: 'Extra shot · Less ice', price: 13000, qty: 2 },
    { name: 'Butter Croissant', mod: 'Dipanaskan', price: 22000, qty: 1 },
  ]);

  const add = (name, price) => setCart((c) => {
    const i = c.findIndex((x) => x.name === name && !x.mod);
    if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; }
    return [...c, { name, price, qty: 1 }];
  });
  const setQty = (idx, qty) => setCart((c) => c.map((x, i) => i === idx ? { ...x, qty } : x));
  const remove = (idx) => setCart((c) => c.filter((_, i) => i !== idx));

  const items = PRODUK.filter(([n, sku, , , c]) =>
    (cat === 'Semua' || c === cat) &&
    (!q || n.toLowerCase().includes(q.toLowerCase()) || sku.toLowerCase().includes(q.toLowerCase())));
  const count = cart.reduce((s, x) => s + x.qty, 0);
  const subtotal = cart.reduce((s, x) => s + x.price * x.qty, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-sunk)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-subtle)' }}><Icon name="search" size={18} /></span>
          <input className="field" style={{ paddingLeft: 40 }} type="search" placeholder="Cari nama produk atau SKU…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari produk" />
        </div>
        <SyncIndicator state="queued" count={3} />
        <button className="btn btn-secondary">Sesi: Andi · 07:02</button>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <section style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }} aria-label="Katalog produk">
          <div style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3)', overflowX: 'auto', flex: 'none' }}>
            {CATS.map((c) => <Chip key={c} selected={cat === c} onClick={() => setCat(c)}>{c}</Chip>)}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-3) var(--space-3)', display: 'grid', gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', alignContent: 'start' }}>
            {items.map(([n, sku, h, ada]) => (
              <ProductCard key={sku} name={n} sku={sku} price={h} available={!!ada} onAdd={() => add(n, h)} />
            ))}
          </div>
        </section>

        <aside style={{ width: 380, flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderLeft: '1px solid var(--border)' }} aria-label="Keranjang">
          <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border)', flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <span className="t-title">Keranjang</span>
            <SegmentedControl options={['Dine In', 'Takeaway']} value={mode} onChange={setMode} ariaLabel="Tipe pesanan" />
            <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'space-between' }}>
              <span>Meja A04 — Dekat Pintu</span><Icon name="chevron-down" size={16} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-3)' }}>
            {cart.length === 0 ? (
              <div className="empty"><Icon name="receipt" size={32} /><div className="t-body-md" style={{ color: 'var(--ink-muted)' }}>Keranjang kosong</div><div className="t-caption">Pilih produk dari katalog</div></div>
            ) : cart.map((x, i) => (
              <CartRow key={i} name={x.name} modifiers={x.mod} unitPrice={x.price} qty={x.qty} onQty={(qt) => setQty(i, qt)} onRemove={() => remove(i)} />
            ))}
          </div>

          <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border)', flex: 'none' }}>
            <div className="num" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <div className="row between" style={{ color: 'var(--ink-muted)' }}><span>Subtotal ({count} item)</span><span>{rupiah(subtotal)}</span></div>
              <div className="row between" style={{ color: 'var(--ink-muted)' }}><span>Diskon</span><span>− Rp 0</span></div>
              <div className="row between t-title"><span>Total</span><span>{rupiah(subtotal)}</span></div>
            </div>
            <div className="row" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <Button variant="secondary" fullWidth>Open Bill</Button>
              <Button variant="secondary" fullWidth>Diskon</Button>
            </div>
            <Button variant="primary" critical fullWidth disabled={cart.length === 0} style={{ justifyContent: 'space-between' }}>
              <span>Bayar</span><span className="num">{rupiah(subtotal)}</span>
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
window.KasirScreen = KasirScreen;
