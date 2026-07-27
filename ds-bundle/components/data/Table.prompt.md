Tabel data zebra; kolom uang rata-kanan tabular. Bawa keadaan kosong bawaan — selalu isi `empty` untuk membedakan "tidak ada data" dari "tidak cocok filter".

```jsx
<Table
  columns={[
    { key: 'waktu', header: 'Waktu' },
    { key: 'struk', header: 'No. Struk' },
    { key: 'total', header: 'Total', align: 'right', render: r => <span className="num">{r.total}</span> },
  ]}
  rows={transaksi}
  keyField="struk"
  empty={<EmptyState title="Tidak ada transaksi cocok" body="Coba ubah filter tanggal." />}
/>
```
