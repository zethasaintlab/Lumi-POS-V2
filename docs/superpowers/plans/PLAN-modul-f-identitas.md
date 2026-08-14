# PLAN — Modul F: Sesi & Identitas Pengguna

**Dibuat:** 11 Agustus 2026 · **Fase:** F2 (ditarik dari F3 atas keputusan user)
**Spec:** `product/specs/spec-f-rbac-audit.md` · **Terkait:** `spec-b` §B.4 (FR-B8/B9), `spec-h` (FR-H4)

---

## 0. Kenapa sekarang

Keputusan user 11 Agustus 2026:

> Membangun UI Buka Shift dan Refund (F2) tanpa identitas nyata hanya akan
> menghasilkan mock data dan memaksa rework di kemudian hari. Selain itu,
> Modul F akan membuka blokir FR-H4.

`ARCH:§14` menempatkan identity/audit di F3. Ini override yang disengaja, dan
alasannya berdiri sendiri: setiap layar kasir yang tersisa di F2 (K-02 buka
shift, K-10 void/refund, K-12 tutup kas) menuntut jawaban atas "siapa yang
melakukan" dan "siapa yang menyetujui". Membangunnya di atas `X-Actor-Id`
karangan berarti membangunnya dua kali.

---

## 1. Temuan discovery yang mengubah rencana

### T1 — Argon2id ada di `node:crypto`. Nol dependency baru di server.

Node 24.18.0 menyediakan `crypto.argon2Sync(algorithm, options)`. Diukur:

```
argon2id, m=19456 KiB, t=2, p=1, tagLength=32  →  23 ms per hash
```

Parameter mengikuti rekomendasi OWASP untuk Argon2id (19 MiB / 2 pass / p=1).
`spec-f:146` menuntut "Hash Argon2id, bukan bcrypt/SHA/MD5" — terpenuhi tanpa
menyentuh `package.json`.

### T2 — ⛔ `UNIQUE(outlet_id, pin_hash)` di ERD §3 MUSTAHIL. Constraint itu tidak menangkap apa pun.

`ERD:143` menulis constraint itu; `db/migrations/0003_identity.sql:26` mencatat
TODO untuknya. Keduanya salah, dan bukan karena tabel jembatannya belum ada:

```
PIN '482913' + salt A  →  hash X
PIN '482913' + salt B  →  hash Y     X ≠ Y   (diukur)
```

Salt per pengguna adalah syarat Argon2id yang benar; ia membuat dua PIN
**identik** menghasilkan hash **berbeda**. Unique index atas `pin_hash` karena
itu akan hijau selamanya sambil membiarkan dua kasir seoutlet memakai PIN yang
sama — tepat keadaan yang `spec-f:126` larang, dan tepat keadaan yang
menghancurkan atribusi.

**Penegakan pindah ke aplikasi:** saat PIN diset, PIN baru diverifikasi
terhadap `pin_hash` setiap pengguna lain di outlet yang sama. Biayanya
n × 23 ms dengan n = jumlah staf outlet (< 20), hanya pada operasi yang jarang.

**Ini menuntut perubahan `ERD-lumi-pos-v1.md`. Dokumen `/product/` milik user
— saya laporkan, tidak saya sunting.**

### T3 — Verifikasi PIN di KLIEN butuh Argon2 yang tidak ada di browser.

`spec-f:124-125`: hash direplikasi ke perangkat, verifikasi **lokal**.
`node:crypto` tidak ada di webview; WebCrypto tidak punya Argon2. Ini
satu-satunya bagian Modul F yang menuntut keputusan dependency.

**Dinetralkan, bukan diputuskan sekarang:** hash disimpan dalam **format PHC**
(`$argon2id$v=19$m=19456,t=2,p=1$<salt-b64>$<tag-b64>`) — format standar yang
dapat diverifikasi implementasi mana pun. Hashing disembunyikan di balik port
`PengunciPin`; server mengimplementasikannya dengan `node:crypto`, klien
dengan apa pun yang dipilih kelak. Seluruh §3–§5 di bawah dapat selesai tanpa
jawabannya.

Pertanyaan diangkat saat §6 dimulai, dengan opsi terukur.

### T4 — Temuan sampingan: `cost` turun ke setiap perangkat.

`sync-config.yaml` memakai `SELECT * FROM item_variation`, dan kolom `cost`
ikut. `spec-f:72` menuntut `cost` **tidak ada di payload** untuk peran Kasir,
"bukan sekadar disembunyikan di UI".

Perangkat kasir dipakai kasir **dan** manajer outlet bergantian, jadi satu
stream tidak dapat memfilter kolom per peran. Dicatat sebagai temuan; FR-F5
diselesaikan di §7 dengan batas yang dinyatakan, bukan diklaim tertutup.

---

## 2. Batas scope — apa yang "penuh" berarti, dan apa yang tidak

**Masuk:**

| # | Isi | FR |
|---|---|---|
| §3 | Skema + domain murni: peran, PIN, PHC, matriks hak akses | F1, F2 |
| §4 | REST identitas: pengguna, peran, PIN, penguncian | F2, F4, F6 |
| §5 | Penegakan RBAC di endpoint yang sudah ada | F1, F5, F7 |
| §6 | Sesi kasir di klien: K-01, login offline, penguncian persisten | F3, F4 |
| §7 | Otorisasi step-up K-11, disambungkan ke refund | F3 (§F.3), B8/B9 |
| §8 | FR-H4 — logout diblokir saat antrean tidak kosong | H4, F3 |
| §9 | Login back-office email+password (server saja) | F2b |

**Ditunda, dengan alasan:**

| Isi | Alasan |
|---|---|
| **F.5 akses support** | Menuntut dashboard owner untuk menyetujui (`spec-f:399`). Back-office belum ada — F5 per `ARCH:§14`. Membangun endpoint tanpa jalan persetujuan berarti membangun akses support **tanpa** kontrolnya |
| **MFA (TOTP)** | `spec-f:175` menyatakannya opsional v1 / wajib v1.1, dan OQ "MFA wajib Owner v1 atau v1.1?" masih terbuka di `CLAUDE.md` |
| **Reset password lewat email** | Menuntut infrastruktur email yang tidak ada di tabel stack |
| **Rotasi PIN manajer 90 hari** | `pin_rotated_at` diisi, peringatan 7 hari menunggu UI back-office; periodenya sendiri belum divalidasi ke merchant (`spec-f:465`) |
| **Laporan exception & filter per penyetuju** | Modul G |

**Dinyatakan, bukan didiamkan:** §9 tidak punya konsumen UI. Ia dibangun karena
FR-F2b adalah P0 dan endpoint-nya dapat diuji penuh lewat API; layar B-01
menunggu F5.

---

## 3. Skema & domain murni

### 3.1 Migrasi `0019_identity_session.sql`

```sql
-- Tabel jembatan yang ERD §3 sebut tapi tidak pernah definisikan.
CREATE TABLE user_outlet (
  id, tenant_id, user_id, outlet_id,
  UNIQUE (user_id, outlet_id)
);
-- Kolom baru di "user":
--   pin_must_change  boolean  -- reset oleh manajer (spec-f:420)
--   pin_algo         text     -- 'argon2id'; menyiapkan rotasi parameter
-- Kolom baru di device: (tidak ada)
```

`pin_locked_until` dan `pin_failed_attempts` sudah ada sejak `0003`.

⛔ **`UNIQUE(outlet_id, pin_hash)` TIDAK dibuat.** Alasannya T2. Baris TODO di
`0003_identity.sql` diganti komentar yang menjelaskan kenapa ia tidak dapat
dipenuhi.

### 3.2 `packages/domain/src/pin.ts` — murni, dibagi server & klien

- `validasiBentukPin(pin)` → tepat 6 digit
- `deteksiPinLemah(pin, { tanggalLahir })` → `null | { pola, pesan }`
  Kelima pola `spec-f:131-137` + daftar 20 PIN terumum yang di-bundle
- `formatPhc(...)` / `parsePhc(...)` — encode/decode murni
- `PARAMETER_ARGON2` — satu konstanta, dibagi kedua sisi

### 3.3 `packages/domain/src/rbac.ts` — murni

Matriks `spec-f:38-53` sebagai data, bukan `if`. `bolehkah(peran[], operasi)`.
Menutup AC `spec-f:83` ("penambahan peran baru tidak memerlukan perubahan di
layar kasir") — layar membaca fungsi, bukan daftar peran.

### 3.4 Port `PengunciPin`

```ts
interface PengunciPin {
  hash(pin: string): Promise<string>;         // → PHC
  verifikasi(pin: string, phc: string): Promise<boolean>;
}
```

Server: `node:crypto`. Klien: §6. Perbandingan tag **timing-safe**.

---

## 4. REST identitas

| Operasi | Endpoint |
|---|---|
| Buat pengguna | `POST /users` |
| Ubah pengguna / nonaktifkan | `PATCH /users/{id}` |
| Tetapkan peran | `PUT /users/{id}/roles` |
| Tetapkan outlet | `PUT /users/{id}/outlets` |
| Set / reset PIN | `PUT /users/{id}/pin` |
| Laporkan kegagalan & penguncian PIN | `POST /users/{id}/pin-attempts` |

**Aturan yang ditegakkan:**

- PIN unik per outlet — verifikasi terhadap rekan seoutlet (T2)
- PIN lemah ditolak dengan **pola mana** yang cocok (`spec-f:144`)
- Reset oleh manajer menyalakan `pin_must_change` (`spec-f:420`)
- Owner terakhir tidak dapat dihapus/dinonaktifkan (`spec-f:425`)
- `audit_event`: `user_created` · `user_role_changed` · `user_deactivated` ·
  `pin_changed` · `pin_failed` · `pin_lockout`
- PIN plaintext tidak pernah masuk log — didaftarkan ke `registerSecretValues`?
  **Tidak**: nilainya dinamis. Sebagai gantinya `log-redaction.ts` menyaring
  field bernama `pin`/`newPin`, dan ada test yang mengirim PIN lalu memindai
  seluruh stream log (`spec-f:443`)

---

## 5. Penegakan RBAC di endpoint yang sudah ada

**Batas yang harus dinyatakan, bukan diklaim lebih dari adanya.**

Perangkat kasir mengautentikasi diri sebagai **perangkat** (secret bearer,
FR-F12). `X-Actor-Id` adalah atribusi yang **dijamin perangkat**, bukan
identitas yang diverifikasi server — dan itu konsekuensi langsung dari
offline-first: order yang antre 6 jam tidak dapat membawa sesi hidup.

Yang tetap bernilai, dan yang dibangun di sini: server memeriksa bahwa aktor
yang disebut **memang punya hak** untuk operasi itu. Id kasir tidak dapat
muncul sebagai `X-Approver-Id` pada refund, apa pun yang dikirim perangkat.
Ini menutup `spec-f:80` dan `spec-f:96`, dan tidak menutup perangkat yang
di-root — yang dijaga pencabutan token, bukan RBAC.

- `assertBoleh(client, userId, operasi)` di `identity/index.ts`
- Refund: penyetuju wajib punya `approve_refund`
- FR-F5: `cost`/`cost_at_sale`/margin dibuang dari respons bila peminta Kasir

---

## 6. Sesi kasir di klien — di sini T3 diputuskan

- Raw table baru: `user`, `user_role`, `user_outlet` (kolom **eksplisit**,
  tanpa `password_hash`, `mfa_secret`, `email`) — sidik jari skema berubah,
  `disconnectAndClear()` berjalan, itu memang jalur yang benar
- Sync rules disaring `user_outlet.outlet_id = auth.parameter('outlet_id')`
- Tabel lokal `sesi_lokal` (siapa yang masuk) dan `pin_lockout_lokal`
  (penguncian **bertahan restart**, `spec-f:226`)
- K-01: keypad 6 digit, pesan netral "PIN salah" (`spec-f:161`)
- FR-F4: 5 gagal → kunci 60 detik, **per pengguna**, dengan hitung mundur;
  3 penguncian dalam 1 jam → 15 menit
- `audit_event` login/logout/pin_failed/pin_lockout masuk `outbox_local`

---

## 7. Otorisasi step-up K-11

- Dialog di atas layar kasir; **sesi tidak berubah** — diuji dengan
  membandingkan `sesi_lokal` sebelum dan sesudah (`spec-f:279`)
- Penyetuju diverifikasi lokal; wajib punya hak `approve`
- Rate limiting berlaku pada PIN penyetuju (`spec-f:280`)
- Disambungkan ke jalur refund yang sudah ada: `X-Approver-Id` diisi dari
  hasil dialog, bukan dari konfigurasi

---

## 8. FR-H4 — logout diblokir saat antrean tidak kosong

`spec-f:207` menyebut alasannya: di Toast, logout offline mengunci pengguna.
Memakai `ringkasanAntrean` yang sudah ada; pesan menyebut **jumlah** item dan
apa yang hilang bila dipaksa.

---

## 9. Login back-office (server saja)

`POST /auth/login` · `POST /auth/logout` · sesi 12 jam idle
(`spec-f:176`). Password Argon2id, minimal 10 karakter, daftar bocor
di-bundle. Kasir tanpa email tidak dapat masuk — itu benar (`spec-f:184`).

---

## 10. Checklist

### §3 Skema & domain — **selesai**
- [x] T3.1 Migrasi `0019` — `user_outlet`, `pin_must_change`, `pin_algo`,
      `pin_lockout_count`, `pin_lockout_window_start`. **`UNIQUE(outlet_id,
      pin_hash)` sengaja TIDAK dibuat** (T2), dengan alasannya tertulis di
      migrasi
- [x] T3.2 `packages/domain/src/pin.ts` + test — sabotase pada daftar PIN umum
      tertangkap
- [x] T3.3 `packages/domain/src/rbac.ts` + test — setiap sel `spec-f:38-53`
      punya assertion; fail-closed untuk operasi tak dikenal
- [x] T3.4 Port `PinHasher` + implementasi server (`node:crypto`, **nol
      dependency**) + test — sabotase "parameter dari konstanta" tertangkap
- [x] T3.5 Test isolasi tenant untuk `user_outlet` — 194/194 (dari 189)

### §4 REST identitas
- [x] T4.1 `POST /users`, `PATCH /users/{id}` — pengguna + peran + outlet dalam
      SATU transaksi; owner terakhir dilindungi (`spec-f:425`)
- [ ] T4.2 `PUT /users/{id}/roles`, `PUT /users/{id}/outlets` — perubahan peran
      setelah pembuatan. **Belum**; `createUser` sudah menetapkan keduanya
- [x] T4.3 `PUT /users/{id}/pin` — unik per outlet (verifikasi, bukan index),
      PIN lemah ditolak dengan pola yang disebut. Sabotase tertangkap
- [x] T4.4 `POST /users/{id}/pin-attempts` — penguncian 60 s, eskalasi 900 s
      pada penguncian ketiga dalam satu jam, per-pengguna
- [x] T4.5 Audit event identitas — `user_created`, `user_deactivated`,
      `pin_changed`, `pin_failed`, `pin_lockout`. Hash PIN TIDAK masuk
      `before`/`after`
- [x] T4.6 Test: PIN plaintext tidak muncul di log — **versi pertamanya lolos
      secara semu** (endpoint 404, PIN tidak pernah diproses); diperkuat dengan
      memeriksa status kedua jalur

### §5 RBAC
- [x] T5.1 `assertBoleh` — fail-closed dua kali (tanpa peran, dan operasi tak
      dikenal). SELECT tunduk RLS, jadi id lintas-tenant jatuh ke daftar kosong
- [x] T5.2 Refund menuntut penyetuju ber-hak `approve_authorization`. Guard di
      jalur refund, BUKAN di awal handler — void mengabaikan `X-Approver-Id`
      sepenuhnya. Ditolak = tidak ada baris refund/stok/audit sama sekali
- [ ] T5.3 FR-F5 — `cost` dibuang untuk peran Kasir. **DITUNDA, dengan alasan
      di §12.** Dua penghalang nyata, keduanya bukan soal usaha

### §6 Klien
- [x] T6.0 **Keputusan T3 diambil user 11 Agu 2026: WASM.** `hash-wasm@4.12.0`
      — satu-satunya dependency baru di sub-project ini. WASM disisipkan
      base64 di bundel, jadi tidak ada aset terpisah; `vite build` hijau
- [x] T6.1 Raw table `user`/`user_role`/`user_outlet` + sync rules **berkolom
      eksplisit** (`password_hash`/`mfa_secret`/`email` tidak pernah turun)
      dan **disaring per outlet** (`spec-f:250`)
- [x] T6.2 `sesi_lokal` + `pin_lockout_lokal`, keduanya lokal-saja
- [x] T6.3 K-01 login PIN — keypad 6 digit, titik (bukan angka), hitung mundur.
      **Diverifikasi di browser sungguhan**: PIN diketik lewat keypad, hash
      dicetak `node:crypto`, diverifikasi Argon2 WASM — 33 ms, sesi terbentuk,
      topbar menampilkan nama kasir
- [x] T6.4 FR-F4 penguncian, persisten, per-pengguna, eskalasi 60 s → 900 s
- [ ] T6.5 Audit event sesi ke outbox — **belum**. `login`/`logout`/`pin_failed`
      belum masuk `outbox_local`; jalur itu menunggu penulisan order di klien

### §7–§9
- [x] T7.1 Dialog K-11 + **sesi tidak berubah** — `otorisasi.ts` berdiri
      sendiri dan tidak pernah menyentuh `sesi_lokal`; sabotase tertangkap.
      Menolak persetujuan-diri-sendiri, penyetuju tanpa hak, dan menerapkan
      rate limiting pada PIN penyetuju
- [ ] T7.2 Disambungkan ke refund — **menunggu K-10**, layar void/refund yang
      belum ada. Dialognya siap dan menerima `onSetuju({ approverId, … })`
- [x] T8.1 FR-H4 — `bolehLogout` + `keluar()`; menghitung `menunggu + gagal`,
      bukan `menunggu` saja
- [x] T9.1 `POST /auth/login` + `/auth/logout` + `PUT /users/{id}/password`,
      migrasi `0020_user_session`. Satu respons 401 untuk semua sebab, dan
      verifikasi dijalankan meski pengguna tidak ada (timing oracle)

### Penutup
- [ ] Suite penuh, typecheck, lint:ds, build — output ditempel
- [ ] `CLAUDE.md` + `HANDOFF.md` diperbarui
- [ ] Laporan ke user: perubahan ERD §3 yang dituntut T2

---

## 11. Yang saya laporkan, tidak saya sunting

`ERD-lumi-pos-v1.md:143` menulis constraint yang mustahil (T2).
`product/` milik user. Perubahannya diusulkan di laporan akhir.

---

## 12. T5.3 (FR-F5) ditunda — dua penghalang nyata

`spec-f:66` menuntut `cost` dan `cost_at_sale` **tidak ada di payload** untuk
peran Kasir, "bukan sekadar disembunyikan di UI". Itu tidak dapat dipenuhi
sekarang, dan menyetengahinya lebih buruk daripada menundanya.

**Penghalang 1 — endpoint katalog tidak menuntut `X-Actor-Id`.**
Menambahkannya sebagai opsional berarti kontrolnya dapat dilewati dengan
menghapus satu header. Kontrol yang terlihat ada tapi dapat dilewati lebih
berbahaya daripada tidak ada: ia membuat orang berhenti mencari.
Menjadikannya wajib adalah perubahan kontrak untuk 147 test katalog dan
setiap pemanggil yang ada — keputusan scope, bukan detail implementasi.

**Penghalang 2 — ⛔ `cost` sudah turun ke SETIAP perangkat.**
`sync-config.yaml` memakai `SELECT * FROM item_variation`, dan `cost` ikut.
Ini paparan yang lebih besar daripada respons REST mana pun: ia data diam di
tablet yang `spec-f:242` asumsikan suatu saat hilang.

Membuangnya dari jalur turun **belum dapat diputuskan**, karena
`order_line.cost_at_sale` untuk order yang dibuat OFFLINE harus datang dari
suatu tempat. Hari ini ia dihitung server (`getVariationSnapshot`), dan
`apps/kasir` belum menulis order sama sekali — jadi pertanyaannya belum
pernah dijawab. Ada tiga jalan (perangkat tidak menyimpan `cost` dan
`cost_at_sale` diisi server saat order naik · `cost` turun hanya ke perangkat
yang penggunanya berhak · `cost_at_sale` dihitung dari harga, bukan HPP), dan
memilih salah satunya diam-diam akan mengikat FR-B/FR-G.

**Diangkat ke user, tidak ditebak.**
