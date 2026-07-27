Dialog khusus aksi merusak — beda dari dialog biasa. Void, refund, dan tutup sesi kas wajib PIN owner dan alasan dari daftar tertutup; "Lainnya" mewajibkan catatan. Tombol konfirmasi danger 56px, nonaktif sampai PIN & alasan lengkap.

```jsx
<ConfirmDialog
  title="Void item ini?"
  description="Aksi ini dicatat dan tidak bisa dibatalkan diam-diam."
  detail={<div className="row between"><span>2× Americano</span><span className="num">Rp 26.000</span></div>}
  reason={reason} onReason={setReason}
  note={note} onNote={setNote}
  pin={pin} onPin={setPin}
  confirmLabel="Void" onConfirm={doVoid} onCancel={close}
/>
```

Alasan default: Salah input · Tamu batal · Item habis · Kualitas · Lainnya. Set `pinError` untuk PIN salah.
