Indikator status sinkronisasi untuk aplikasi offline-first. Tiga keadaan wajib bisa dibedakan sekilas; jangan tampilkan hanya "tersinkron".

```jsx
<SyncIndicator state="ok" />
<SyncIndicator state="queued" count={3} />
<SyncIndicator state="failed" count={2} onRetry={retry} />
<SyncIndicator state="offline-only" reason="Butuh koneksi untuk data realtime" />
```

`queued` selalu tampilkan jumlah; `failed` selalu sertakan `onRetry`. Fungsi yang tidak bisa offline pakai `offline-only` dengan alasan, bukan spinner tanpa akhir.
