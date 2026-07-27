Toggle mode berkotak untuk pilihan yang mengubah cara pesanan diproses (Dine In / Takeaway). Netral secara warna — ini bukan aksi utama layar, jadi tidak memakai aksen.

```jsx
<SegmentedControl
  ariaLabel="Tipe pesanan"
  options={['Dine In', 'Takeaway']}
  value={mode}
  onChange={setMode}
/>
```
