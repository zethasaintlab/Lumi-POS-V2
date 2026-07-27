// QR Sticker — pratinjau stiker meja untuk dicetak. Layar penuh.
const { Button, Icon } = window.LumiPOSDesignSystem_dae7d1;

function QrStickerScreen({ onExit }) {
  return (
    <div style={{ minHeight: '100%', background: 'var(--surface-sunk)' }}>
      <div className="row between" style={{ padding: 'var(--space-4) var(--space-8)', maxWidth: 1000, margin: '0 auto' }}>
        <Button variant="ghost" onClick={onExit}><Icon name="chevron-left" size={16} /> Back</Button>
        <button className="btn btn-primary" style={{ background: 'var(--ink)' }}><Icon name="download" size={16} /> Download Sticker PDF</button>
      </div>

      <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-8)' }}>
        <div style={{ width: 360, background: 'var(--surface)', border: '2px solid var(--ink)', borderRadius: 24, padding: 'var(--space-8) var(--space-6)', textAlign: 'center' }}>
          <div className="t-title" style={{ fontStyle: 'italic', letterSpacing: '.02em' }}>THE CAFE BY ORIGEN</div>
          <div style={{ width: 40, height: 2, background: 'var(--ink)', margin: 'var(--space-3) auto' }} />
          <div style={{ fontSize: 'calc(72px * var(--scale))', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.03em' }} className="num">A01</div>
          <div className="t-caption" style={{ letterSpacing: '.2em', marginTop: 'var(--space-2)' }}>MAIN HALL</div>
          <div style={{ margin: 'var(--space-6) auto', width: 200, height: 200, border: '1px solid var(--border)', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--surface-sunk)', color: 'var(--ink-subtle)' }}>
            <div className="stack" style={{ alignItems: 'center', gap: 6 }}><Icon name="qr" size={64} /><span className="t-caption">QR code meja</span></div>
          </div>
          <div className="t-body-md" style={{ letterSpacing: '.1em' }}>SCAN TO ORDER</div>
          <div className="t-caption num" style={{ marginTop: 4, wordBreak: 'break-all' }}>localhost:8000/orders?t=X0dkNuRuJ50BsUosL025c11DR1TFozzT</div>
        </div>
      </div>
    </div>
  );
}
window.QrStickerScreen = QrStickerScreen;
