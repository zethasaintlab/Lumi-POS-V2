A dark, deliberately off-brand bar used only to jump between a mockup's own screens (e.g. jumping straight to an empty-cart or QRIS-expired state without simulating the flow). Never part of the shipped product, never used to cross between the Kasir, Back-office, and Lumi-Order apps.

```jsx
<MockupSwitcher
  appLabel="Kasir"
  screens={[{ id: "kasir", label: "3. Kasir utama" }, { id: "bayar", label: "8. Kartu pembayaran" }]}
  activeScreen={screen}
  onSelectScreen={setScreen}
  dark={dark}
  onToggleDark={toggleDark}
/>
```
