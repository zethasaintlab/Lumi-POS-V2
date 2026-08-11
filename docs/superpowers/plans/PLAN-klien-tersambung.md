# PLAN — klien tersambung ke server

**Status:** SELESAI 8 Agustus 2026 — dikerjakan atas instruksi "lanjutkan". 923 test hijau
**Prasyarat:** FR-F12 (`PLAN-fr-f12-token-perangkat.md`)

---

## 1. Yang dibangun

Identitas perangkat di sisi klien (`packages/sync-client/src/perangkat.ts`), layar
K-15 untuk mengisinya, dan satu tempat yang menyalakan kedua jalur sekaligus
(`apps/kasir/src/sync/jalankan.ts`): `ps.connect()` untuk jalur turun, penjadwal
relay untuk jalur naik. Tombol "Coba kirim sekarang" di K-14 hidup.

Sekalian: **aktor per-baris di outbox**, cacat yang sudah tercatat sebelum ini.

---

## 2. Keputusan

**Aktor dibekukan saat item DIBUAT, bukan dibaca saat dikirim.** `outbox_local`
mendapat kolom `actor_id`; `buatPengirimHttp` memakainya dan hanya jatuh ke
aktor konfigurasi bila kosong. Antrean dapat terkuras berjam-jam kemudian,
mungkin setelah pergantian shift — memakai "siapa yang sedang masuk" akan
mencatat penjualan Sari atas nama Budi, dan audit server percaya begitu saja.

**Aktor cadangan berbentuk `device:<kode>`**, bukan nama orang karangan. Kalau
ia muncul di audit, ia harus terbaca sebagai "tidak ada orang yang tercatat",
bukan sebagai orang.

**Sinkronisasi dinyalakan sekali per proses, di luar React.** `StrictMode`
memasang dan melepas efek dua kali, dan `ps.connect()` dua kali dalam satu
proses belum pernah kami uji.

**Kegagalan menyalakan sinkronisasi tidak menjatuhkan aplikasi.** Penjualan
offline harus tetap bisa dilakukan (I6); kegagalannya masuk konsol dan terlihat
di K-14 sebagai antrean yang tidak bergerak.

---

## 3. Empat hal yang hanya terlihat dengan menjalankannya

Keempatnya lolos seluruh test sebelum ditemukan.

### 3.1 ⛔ CORS memblokir klien mencapai server

*"Response to preflight request doesn't pass access control check"*. Aplikasi
kasir adalah SPA di origin berbeda dari API, jadi ini bukan kenyamanan
pengembangan melainkan prasyarat agar ia berfungsi sama sekali.

Ditulis tangan (sembilan baris hook), bukan `@fastify/cors`: aturannya sempit,
dan daftar origin datang dari `CORS_ORIGINS` — bukan dari kode (invariant #5).
Kosong = tidak ada yang diizinkan, dan `*` tidak pernah dijawab.

### 3.2 ⛔ Perubahan bentuk tabel LOKAL-SAJA tidak terlihat sidik jari

Sidik jari hanya menghitung raw table — itu memang keputusan sebelumnya, dan
alasannya masih benar. Akibatnya `device_config` dan `outbox_local` yang
mendapat kolom baru menolak database yang sudah ada: *"table device_config has
no column named id"*.

Perbaikannya migrasi **aditif** (`ALTER TABLE ADD COLUMN`) yang berjalan di
setiap boot, bukan bangun ulang: `outbox_local` memegang penjualan yang belum
terkirim, dan `device_config` memegang `receipt_sequence` — meresetnya melanggar
I4.

Batasnya jujur: ALTER tidak dapat mengubah primary key. `device_config` memang
berganti PK di sub-project ini, dan database pengembangan yang sudah ada harus
dibuang. Tidak ada perangkat terpasang, jadi harganya nol — tapi pola ini tidak
akan menolong bila hal yang sama terjadi setelah rilis.

### 3.3 `ON CONFLICT(id)` berjalan di `node:sqlite`, DITOLAK wa-sqlite

*"ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"* —
`id INTEGER PRIMARY KEY` adalah alias rowid, dan kedua versi SQLite tidak
sepakat apakah ia sah sebagai sasaran upsert. Seluruh test hijau; hanya
aplikasi yang gagal. Diganti `INSERT OR IGNORE` + `UPDATE`, yang berlaku di
keduanya — dan yang juga tidak menyentuh kolom counter sama sekali.

**Ini kelas cacat yang akan berulang:** test klien berjalan di atas SQLite yang
BERBEDA dari yang dipakai aplikasi.

### 3.4 `Content-Type: application/json` pada POST tanpa body → 400

Fastify mencoba mem-parse body kosong. Di browser ia terlihat sebagai "Gagal
mengambil token sinkronisasi (HTTP 400)" berulang-ulang, sementara `curl` tanpa
header itu berhasil.

---

## 4. Bukti — dijalankan sungguhan, bukan disimulasikan

Server Fastify + PostgreSQL hidup, kunci RSA dev, satu tenant/outlet/device
sungguhan.

```
POST /devices                      -> 201
POST /devices/{id}/credentials     -> secret 43 karakter, hanya hash-nya di DB
POST /devices/{id}/sync-token      -> RS256, klaim:
   {"sub":"…","aud":"powersync","tenant_id":"…","outlet_id":"…","iat":…,"exp":…}
GET  /.well-known/jwks.json        -> {"keys":[{"kty":"RSA","n":"63TU7du…
```

Lalu di browser, setelah perangkat diisi lewat K-15:

```
[PowerSync]: calling the last port client provider for credentials   ← token DITERIMA
K-14: "Coba kirim sekarang" AKTIF, pesan "belum dihubungkan" hilang  ← relay hidup
```

Yang tersisa `Failed to fetch` ke `localhost:8080` — layanan PowerSync memang
tidak dijalankan; itu stack Docker prototipe 05, dan menyalakannya langkah
terpisah.

### Suite

```
domain 107 · dst 14 · sync-client 95 · kasir 52 · sqlite-local 8 · oxlint 10
isolation 189 · schema 14 · server 26 · identity 14 · catalog 147 · ordering 117
dst-server 10 · payment 120
= 923 test, 0 gagal · typecheck bersih · lint:ds bersih · vite build hijau
```

---

## 5. Yang masih terbuka

- **Jalur turun belum pernah dilihat membawa data lewat aplikasi.** Ia butuh
  layanan PowerSync menyala dengan JWKS kami di `client_auth.jwks_uri`.
- **FR-H4** tetap menunggu sesi orang.
- **`X-Actor-Id` masih placeholder di jalur yang belum punya kasir**; kolomnya
  sudah ada dan dihormati pengirim.
- **Enkripsi at-rest** (AC ketiga FR-F12): kredensial perangkat tersimpan apa
  adanya di SQLite lokal sampai keystore OS lewat Tauri (F4).
