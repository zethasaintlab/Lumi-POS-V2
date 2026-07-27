Tombol aksi POS; `variant` menandai peran, `critical` menaikkan tinggi ke 56px untuk aksi yang menyangkut uang. Hanya satu `primary` (aksen) per layar.

```jsx
<Button variant="primary" critical fullWidth>Bayar · Rp 48.000</Button>
<Button variant="secondary">Open Bill</Button>
<Button variant="danger">Void</Button>
<Button variant="ghost">Batal</Button>
```

Varian: primary, secondary, ghost, danger. `critical` untuk Bayar / Tutup Kas / konfirmasi void. `disabled` meredupkan ke 40%.
