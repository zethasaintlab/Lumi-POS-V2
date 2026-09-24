A single payment card whose contents swap when the cashier taps a different method. Never multiple cards, never a page navigation.

```jsx
<PaymentCard total={50600} qrisState="ready" onQrisRegenerate={regenerate} />
```

Methods: Tunai (keypad-driven amount + presets + live change calculation), QRIS (QR code rendered inside the same card, four states), Kartu (card type + reference number), Transfer (destination bank + reference number). The total stays visible at the top no matter which method is active.
