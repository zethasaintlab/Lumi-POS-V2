Kartu produk untuk grid katalog kasir; tinggi tetap 96px agar minimal 12 kartu muat tanpa scroll di 1024×768. Item habis diredupkan dan menampilkan badge "Habis".

```jsx
<ProductCard name="Americano" sku="KOP-01" price={8000} onAdd={add} />
<ProductCard name="Pain au Chocolat" sku="PST-02" price={26000} available={false} />
```

Harga diformat sebagai `Rp` + pemisah ribuan titik tanpa desimal. Nama panjang otomatis ellipsis.
