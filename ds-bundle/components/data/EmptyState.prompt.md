Keadaan kosong / first-run. Setiap layar wajib punya ini; tawarkan jalan keluar, bukan grid kosong.

```jsx
<EmptyState title="Belum ada produk" body="Mulai dengan menambah menu pertama." action={<Button variant="primary">Tambah produk pertama</Button>} />
<EmptyState title="Belum ada pesanan" clock="14:32:07" />
```

Untuk KDS tanpa order, sertakan `clock` (jam berjalan) agar terbukti layar hidup. Untuk hasil filter kosong, bedakan bahasanya dari "belum ada data".
