A pill badge that names a real state. Never a decorative dot in front of a nav item or list row.

```jsx
<Badge tone="success">Selesai</Badge>
<Badge tone="danger">Batal</Badge>
<Badge tone="warning">Stok menipis</Badge>
```

Tone maps directly to meaning: success (done, cash-drawer overage), info (in progress, up next), pending (waiting, neutral), warning (needs attention), danger (error, cancelled, cash-drawer shortage). `accent` is the only non-status tone, for neutral highlight chips like counts.
