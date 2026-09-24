Renders LumiPOS's single button component, in the four variants used across all three apps.

```jsx
<Button variant="primary" onClick={handlePay}>Bayar</Button>
<Button variant="secondary" onClick={handleCancel}>Batal</Button>
<Button variant="ghost">Lainnya</Button>
<Button variant="danger" size="primaryAction">Hapus item</Button>
```

Notable rules:
- `size="primaryAction"` (56px) is reserved for the cashier screen's primary actions: product cards, the pay button, keypad digits, quantity stepper. Every other button uses the 44px default.
- Labels max three words, never wrap to a second line.
- Only `variant="primary"` uses the accent color - it is the one accent in the whole product, never swapped per screen.
