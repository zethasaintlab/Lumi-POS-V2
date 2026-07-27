Label status pill. Selalu bawa teks; ikon wajib di KDS. Warna semantik hanya untuk status.

```jsx
<Badge tone="success" icon={<Icon name="check" size={14} />}>Siap diantar</Badge>
<Badge tone="warning" icon={<Icon name="alert" size={14} />}>Lewat 10 menit</Badge>
<Badge tone="danger">Habis</Badge>
<Badge tone="accent">Diproses</Badge>
<Badge>Mengantre</Badge>
```

Tone: neutral, accent, success, warning, danger. Jangan pakai warna tanpa teks.
