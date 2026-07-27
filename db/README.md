# Database

## `migrations/` — PostgreSQL

Aturan wajib setiap migrasi (`product/ERD-lumi-pos-v1.md` § 17):

- `SET lock_timeout` di setiap migrasi — gagal cepat, jangan blokir seluruh merchant
- `CREATE INDEX CONCURRENTLY` untuk tabel produksi
- Kolom baru nullable atau default yang tidak memicu rewrite
- Pola **expand → backfill → switch → contract**; fase contract minimal satu rilis penuh setelah switch
- Idempoten dan berurutan — instalasi bisa tertinggal beberapa versi
- Setiap migrasi dalam transaksi

## `local/` — SQLite di perangkat

`001-initial.sql` diturunkan dari ERD dan **sudah divalidasi** lewat `prototypes/01-sqlite-sizing/`:
19 tabel, 14 index, terukur ≈3,0 KB per order.

**Migrasi lokal wajib aditif-saja** sampai beberapa versi berlalu. Rollback aplikasi relatif sederhana; rollback skema lokal setelah data ditulis hampir mustahil.

Yang masih perlu ditambahkan ke `001-initial.sql` sebelum dipakai produksi:
- Tabel `stock_snapshot` + index `ix_mv_hlc` (lihat ERD § 16 — hasil pengukuran)
- Tabel `sync_checkpoint`
