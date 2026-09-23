The cashier catalog's product tile. Three visually distinct states, tap target sized for the main cashier grid.

```jsx
<ProductCard name="Es Kopi Susu" price="Rp 18.000" image="https://…" onClick={add} />
<ProductCard name="Teh Tarik" price="Rp 12.000" onClick={add} />
<ProductCard name="Kentang Goreng" price="Rp 17.000" image="failed" onClick={add} />
```

Non-negotiable: the not-yet-photographed state renders zero placeholder box - the missing image is simply absent, not filled with gray. The failed-to-load state is a named, dashed-frame state with an icon and the word "Gagal" so a business owner can tell "never photographed" apart from "photo is broken" at a glance - they need different fixes. The cashier catalog grid must fit at least 12 of these without scrolling on a landscape tablet.
