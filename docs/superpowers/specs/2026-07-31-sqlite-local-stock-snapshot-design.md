# Skema SQLite lokal — lengkapi `stock_snapshot` + `ix_mv_hlc`

**Status:** Disetujui · **Tanggal:** 31 Juli 2026
**Bagian dari:** Gate F0 — item HANDOFF.md "Skema SQLite lokal berjalan"

## Konteks

`db/local/001-initial.sql` sudah divalidasi lewat `prototypes/01-sqlite-sizing/`
(19 tabel, 14 index, ≈3,0 KB/order) tapi belum menyertakan dua hal yang sama
prototipe itu sendiri buktikan wajib ada: tabel `stock_snapshot` dan index
`ix_mv_hlc`. Tanpa keduanya, pembacaan stok jatuh ke agregasi langsung
`SUM(delta)` yang terukur 116–582 ms di perangkat tablet — di atas anggaran
p95 100 ms untuk tambah item ke keranjang (`ARCH-lumi-pos-v1.md` §10).

Baik bentuk tabel maupun index ini **sudah diukur**, bukan didesain di sini:
- `prototypes/01-sqlite-sizing/FINDINGS.md` §5 — hasil pengukuran dan bentuk
  konkret yang direkomendasikan.
- `prototypes/01-sqlite-sizing/snapshot2.py` — kode yang benar-benar diuji.
- `product/ERD-lumi-pos-v1.md` §16 — versi PostgreSQL dari keputusan yang
  sama (sudah diterapkan di `db/migrations/0010_inventory.sql`).

Angka hasil pengukuran mengalahkan estimasi di dokumen lain (aturan proyek),
jadi spec ini mengikuti FINDINGS.md persis, bukan menuliskan ulang dari nol.

## Keputusan desain

1. **Edit `db/local/001-initial.sql` langsung**, bukan file migrasi baru
   (`002_*.sql`). Alasan: file ini sendiri menyatakan "belum dipakai
   produksi" — belum ada device di lapangan yang perlu dilindungi aturan
   migrasi lokal aditif-saja (`ARCH-lumi-pos-v1.md` §12). Begitu skema ini
   pernah dikirim ke device nyata, perubahan berikutnya wajib lewat migrasi
   aditif bernomor, bukan edit file initial.
2. **Bentuk tabel persis seperti yang diukur:**
   ```sql
   CREATE TABLE stock_snapshot (
     tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL, variation_id TEXT NOT NULL,
     balance INTEGER NOT NULL, checkpoint_hlc INTEGER NOT NULL,
     PRIMARY KEY (tenant_id, outlet_id, variation_id)
   ) WITHOUT ROWID;
   ```
   `balance` dan `checkpoint_hlc` tidak nullable — snapshot yang belum
   pernah di-build tidak direpresentasikan sebagai baris kosong, tapi
   sebagai baris yang belum ada (aplikasi jatuh ke agregasi langsung kalau
   tidak ada baris snapshot untuk kombinasi tenant/outlet/variation itu).
3. **Index wajib pada `stock_movement`:**
   ```sql
   CREATE INDEX ix_mv_hlc ON stock_movement(tenant_id, outlet_id, hlc);
   ```
   Ditempatkan di blok `-- INDEX (dari ERD §15)` yang sudah ada di file,
   bersebelahan dengan `ix_mv_stock`.
4. **Perbarui `db/README.md`** — coret dua item di daftar "masih perlu
   ditambahkan", karena sudah selesai.

## Di luar scope

- Logika rebuild snapshot saat tutup shift (kode aplikasi, bukan skema) —
  bagian dari modul `cash`/`inventory` di F3, bukan F0.
- Query pembacaan stok gabungan (`snapshot.balance + SUM(delta) sejak
  checkpoint`) — juga kode aplikasi, F3.
- Tabel `sync_checkpoint` yang disebut `db/README.md` sebagai item terpisah
  yang masih perlu ditambahkan — di luar scope perubahan ini, tidak disentuh.

## Verifikasi

- File SQL berhasil di-load ke SQLite in-memory tanpa error (`sqlite3 :memory: < db/local/001-initial.sql` atau setara Node `node:sqlite`/`better-sqlite3` kalau tersedia).
- `PRAGMA table_info(stock_snapshot)` menunjukkan 5 kolom sesuai spec, `WITHOUT ROWID` aktif.
- `PRAGMA index_list(stock_movement)` menyertakan `ix_mv_hlc`.
