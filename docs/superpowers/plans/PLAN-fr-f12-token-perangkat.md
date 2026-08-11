# PLAN — FR-F12: token perangkat, ditarik ke F2

**Status:** SELESAI 8 Agustus 2026 — diputuskan dan dieksekusi atas instruksi "evaluasi, putuskan, langsung eksekusi". 904 test hijau
**Spec:** `product/specs/spec-f-rbac-audit.md` FR-F12 (baris 240–263)

---

## 1. Masalahnya

Tiga hal di F2 berhenti di tempat yang sama:

| Terblokir | Butuh |
|---|---|
| Tombol "Coba kirim sekarang" di K-14 | `baseUrl`, `tenantId`, aktor |
| Penjadwal relay menyala | idem |
| Jalur turun PowerSync tersambung | token yang **dicetak server**, bukan klien |

Yang ketiga bukan sekadar belum dikerjakan — ia ⛔. Prototipe 04/05 mencetak JWT **simetris di dalam browser**, dan pada jalur turun sync rules adalah satu-satunya batas tenant. Kunci simetris di klien berarti perangkat mana pun dapat mencetak token untuk tenant mana pun.

---

## 2. Opsi yang dipertimbangkan

**A — Tarik Modul F utuh.** F.1 peran & hak akses, F.2 login PIN + offline + rate limit, F.3 step-up, F.4 audit trail, F.5 akses support. Menutup semuanya termasuk FR-H4.
*Ditolak:* ia memindahkan sebagian besar F3 ke F2. Step-up (F.3) dan audit (F.4) menunggu Modul B FR-B8/B9 yang juga belum ada; menariknya sekarang berarti mengerjakan tiga fase sekaligus dan kehilangan gate F2 sebagai batas yang berarti.

**B — Tarik F.2 (login PIN) saja.** Memberi aktor sungguhan, dan FR-H4 ikut terbuka karena ada sesi untuk di-logout.
*Ditolak sebagai langkah pertama:* login PIN menuntut hash PIN direplikasi turun, rate limiting lokal (FR-F4), dan kebijakan kredensial offline 30 hari (OQ-08). Ia besar, dan ia **tidak** menutup token PowerSync — jadi ⛔ tetap terbuka setelah semua itu selesai.

**C — Tarik FR-F12 (token perangkat) saja.** ⬅ **DIPILIH**

Alasan teknisnya, berurutan:

1. **Ia satu-satunya yang menutup ⛔.** Token PowerSync adalah kredensial *perangkat*, bukan kredensial orang. Login kasir tidak menghasilkannya.
2. **Skemanya sudah ada sejak F0.** `device` punya `token_hash`, `credentials_expire_at`, `last_seen_at`, `revoked_at` (`0003_identity.sql`). Tidak ada migrasi yang perlu ditulis — sinyal kuat bahwa ini memang potongan yang dirancang untuk berdiri sendiri.
3. **Setengah jalannya sudah ada.** `POST /devices` dan `POST /devices/{id}/revoke` sudah hidup, beserta `assertDeviceVisible`. Yang hilang hanya penerbitan dan verifikasi kredensial.
4. **Kontraknya sudah ditulis lebih dulu.** `apps/kasir/src/sync/token.ts` (pondasi kasir) sudah meminta `POST /devices/{id}/sync-token → { endpoint, token }` dan gagal dengan pesan yang menyebut Modul F. Klien tidak perlu diubah untuk menerima ini.
5. **Ia tidak menyentuh orang.** Nol keputusan produk tentang peran, PIN, atau otorisasi — jadi ia tidak mendahului apa pun yang belum kamu putuskan.

**Yang TETAP tertutup setelah ini, dan itu disengaja:** FR-H4 (blokir logout) menunggu sesi orang; `X-Actor-Id` pada jalur relay masih memakai placeholder.

---

## 3. Yang dibangun

### 3.1 Penerbitan kredensial perangkat

`POST /devices/{deviceId}/credentials` — menerbitkan **secret buram** (32 byte acak), menyimpan **SHA-256**-nya di `device.token_hash` beserta `credentials_expire_at`, dan mengembalikan secret-nya **sekali**.

`[KEPUTUSAN]` SHA-256, bukan Argon2id. `CLAUDE.md` menetapkan Argon2id untuk **password dan PIN** — rahasia berentropi rendah yang dipilih manusia. Secret ini 256 bit dari CSPRNG; KDF lambat tidak menambah apa pun terhadap brute force pada ruang sebesar itu, dan ia diverifikasi pada setiap permintaan token. Menambah dependensi Argon2 untuk ini akan membeli nol keamanan.

### 3.2 Penukaran menjadi token PowerSync

`POST /devices/{deviceId}/sync-token` — perangkat mengirim secret-nya di `Authorization: Bearer`, menerima JWT **RS256** berumur pendek plus endpoint PowerSync.

`[KEPUTUSAN]` Endpoint ini **tetap menuntut `X-Tenant-Id`**, tidak seperti webhook Midtrans. Perangkat tahu tenant-nya sendiri, dan menyertakannya membuat pencarian tetap **tunduk RLS** (invariant #8). Berbohong tentang tenant tidak memberi apa pun: device id-nya tidak akan ditemukan di sana. Alternatifnya — mencari device di seluruh tenant lalu menetapkan tenant dari hasilnya — akan menjadi satu-satunya query di repo ini yang berjalan di luar RLS, dan itu harga yang tidak perlu dibayar.

`[KEPUTUSAN]` RS256, bukan EdDSA. Dukungan JWKS untuk RSA universal; OKP tidak. Kuncinya dari env (`POWERSYNC_JWT_PRIVATE_KEY`, PEM). Ditandatangani `node:crypto` — **nol dependensi baru**.

### 3.3 JWKS

`GET /.well-known/jwks.json` — kunci publik, supaya layanan PowerSync dapat memverifikasi tanpa berbagi rahasia dengan siapa pun.

`[KEPUTUSAN]` Kunci kosong → **503**, mengikuti preseden webhook Midtrans, bukan gagal-saat-boot seperti adapter pembayaran. Gagal saat boot akan membuat setiap test dan setiap lingkungan pengembangan menuntut kunci RSA hanya untuk menjalankan endpoint yang tidak dipakainya.

---

## 4. Yang tidak dikerjakan

- Login PIN, peran, step-up, audit trail, akses support — seluruh sisa Modul F.
- FR-H4.
- Enkripsi SQLite lokal (AC ketiga FR-F12) — ia butuh keystore OS lewat Tauri, dan itu F4.
- Refresh token. Token sync berumur pendek dan diminta ulang memakai secret perangkat; lapisan refresh terpisah tidak menambah apa pun sebelum ada sesi orang.

---

## 5. Task

| # | Isi | Diuji di |
|---|---|---|
| F12-1 | JWT RS256 + JWKS dari PEM, fungsi murni | node |
| F12-2 | `POST /devices/{id}/credentials` — hash tersimpan, secret dikembalikan sekali | PostgreSQL |
| F12-3 | `POST /devices/{id}/sync-token` — verifikasi secret, tolak yang salah/dicabut/kedaluwarsa | PostgreSQL |
| F12-4 | Token memuat tenant + outlet perangkat, dan **tidak dapat dipakai perangkat lain** (AC pertama FR-F12) | PostgreSQL |
| F12-5 | `GET /.well-known/jwks.json`; kunci kosong → 503 | PostgreSQL |
| F12-6 | Pencabutan berlaku pada permintaan token berikutnya (AC kedua FR-F12) | PostgreSQL |

---

## 6. Bukti

```
test:server    21 (7 di antaranya F12-1: JWT RS256 + JWKS)
test:identity  14  ← suite baru
Seluruh suite: 904 test, 0 gagal · typecheck bersih · lint:ds bersih
```

### Sabotase

| Yang dimatikan | Akibat |
|---|---|
| Verifikasi hash secret dilepas | 3 test merah, termasuk AC pertama FR-F12 ("token tidak dapat dipakai di perangkat lain") |
| `revoked_at` diabaikan saat menukar token | F12-6 merah — AC kedua FR-F12 |

Jangkar diperiksa lebih dulu pada keduanya.

---

## 7. Dua hal yang berbeda dari rencana

**Header `Authorization` sengaja TIDAK `required` di OpenAPI.** Ditandai `required: true` lebih dulu, dan validator menjawab **400** untuk header yang hilang. Itu salah untuk endpoint otentikasi: 400 berarti "permintaan cacat", sementara kredensial yang hilang berarti "buktikan siapa kamu". Handler yang menegakkannya, dengan 401 — pesan yang sama persis dengan secret yang salah, supaya beda respons tidak dapat dipakai menebak id perangkat.

**Test verifikasi sempat buta RLS.** Tiga test gagal karena query pemeriksaannya berjalan lewat `appSetup` tanpa `app.tenant_id` — koneksi itu tunduk RLS (invariant #8), jadi ia melihat nol baris dan test menyalahkan kode aplikasi alih-alih dirinya sendiri. Pola `kueriTenant` mengikuti `tests/ordering/devices.test.js`.

---

## 8. Yang masih terbuka setelah ini

- **Klien belum memakainya.** `apps/kasir/src/sync/token.ts` sudah meminta endpoint ini dengan bentuk yang tepat, tapi belum ada yang menyimpan kredensial perangkat di sisi klien maupun memanggil `ps.connect()`.
- **`X-Actor-Id` pada jalur relay masih placeholder.** Ia menunggu sesi orang, bukan sesi perangkat — dan ada catatan desain yang belum dikerjakan: antrean yang terkuras berjam-jam kemudian harus menisbatkan tiap item ke kasir yang membuatnya, bukan ke siapa pun yang sedang masuk saat itu.
- **FR-H4** tetap menunggu Modul F yang sebenarnya.
