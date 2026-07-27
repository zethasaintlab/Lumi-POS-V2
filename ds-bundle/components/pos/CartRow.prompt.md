Satu baris item di panel keranjang kasir: nama + modifier + harga satuan di kiri, stepper qty + subtotal di kanan.

```jsx
<CartRow name="Americano" modifiers="Extra shot · Less ice" unitPrice={13000} qty={qty} onQty={setQty} onRemove={remove} />
```

Menurunkan qty ke 0 memanggil `onRemove`. Semua angka tabular.
