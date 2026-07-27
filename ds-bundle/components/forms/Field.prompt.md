Input teks berlabel dengan state error dan prefix opsional. `size="lg"` memberi field 56px dengan angka besar rata kanan untuk nominal uang.

```jsx
<Field label="Cari produk" placeholder="Nama produk atau SKU…" />
<Field label="Uang diterima" size="lg" prefix="Rp" defaultValue="200.000" />
<Field label="PIN Owner" error="PIN salah" required />
```

`error` merahkan border, menampilkan pesan, dan set `aria-invalid`. Selalu sertakan `id` agar label & pesan error tertaut.
