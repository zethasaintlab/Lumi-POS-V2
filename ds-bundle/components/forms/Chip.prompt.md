Chip filter pilihan-tunggal dalam grup horizontal (kategori katalog, rentang laporan). Chip terpilih memakai aksen penuh.

```jsx
<div className="row" style={{gap:'var(--space-2)'}}>
  <Chip selected>Semua</Chip>
  <Chip>Kopi</Chip>
  <Chip>Makanan</Chip>
</div>
```

Karena chip terpilih memakai aksen, gunakan hanya untuk state terpilih — bukan sebagai tombol aksi.
