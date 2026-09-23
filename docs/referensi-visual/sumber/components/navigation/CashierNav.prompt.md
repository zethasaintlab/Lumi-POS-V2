The cashier app's own top nav - one row, every destination visible, no overflow menu. Mirrors the layout mainstream Indonesian POS cashiers already know.

```jsx
<CashierNav
  items={[{ id: "kasir", label: "Kasir" }, { id: "riwayat", label: "Riwayat" }]}
  activeId="kasir"
  onSelect={setScreen}
/>
```

This is the Kasir app's nav only. The Back-office sidebar and the Lumi-Order header are separate, app-specific patterns (see the Kasir/Back-office/Lumi-Order UI kits) - none of the three link to another app.
