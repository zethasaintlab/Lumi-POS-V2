# Test

## `isolation/` — gate F0, belum tertutup

Test isolasi lintas-tenant untuk **setiap tabel**. Ini gate yang harus hijau sebelum apa pun dibangun di atasnya.

Yang harus dibuktikan:
1. Buat dua tenant; akses data tenant A dengan konteks tenant B → hasil kosong untuk `SELECT`, ditolak untuk `INSERT`/`UPDATE`/`DELETE`
2. User aplikasi **tidak** punya `BYPASSRLS` dan **bukan** owner tabel
3. `FORCE ROW LEVEL SECURITY` aktif di setiap tabel
4. `app.tenant_id` di-`SET LOCAL` per transaksi — bocor antar request bila per koneksi

Tiga cara RLS jadi ilusi keamanan ada di `product/ERD-lumi-pos-v1.md` § 14. Ketiganya gagal **diam-diam** — karena itu test ini wajib, bukan opsional.

## `sqlite-local/` — SQLite local schema validation

Test skema SQLite lokal (`db/local/001-initial.sql`): memastikan file memuat tanpa kesalahan dan bahwa tabel `stock_snapshot` + index `ix_mv_hlc` memiliki bentuk tepatnya sesuai hasil pengukuran di `prototypes/01-sqlite-sizing/FINDINGS.md` §5.

Jalankan dengan: `npm run test:sqlite-local`.

## `dst/` — Deterministic Simulation Testing

Harness referensi: `prototypes/02-dst-sinkronisasi/sim.py`.

Delapan invariant yang wajib diuji ada di `product/specs/spec-h-sinkronisasi.md` § H.5.

⚠️ I1–I5 saja **tidak cukup** — pengukuran menunjukkan lima invariant pertama hanya menangkap 1 dari 5 cacat. I6 (kemampuan jual offline), I7 (immutabilitas), dan I8 (higienis idempotency) wajib ada.

Prasyarat desain: waktu, keacakan, dan I/O jaringan **di-inject sebagai dependensi**. Retrofitnya mahal — putuskan sebelum menulis kode sync.

Target sebelum rilis F2: 10.000 iterasi lolos. Baseline prototipe: 2.000 lolos.
