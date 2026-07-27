# Spec Modul D — Kas & Shift

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 7 Modul D · **Riset:** `/research/02` § 7, `/research/04` (KEP-18), `/research/08` § 3

---

## D.0 Ringkasan modul

Modul ini menjawab satu pertanyaan yang ditanyakan setiap merchant setiap malam: **"uang di laci cocok atau tidak, dan kalau tidak, kenapa."**

**Invariant:**

1. Saldo laci terhitung = `saldo_awal + SUM(cash_movement.delta)`.
2. Kasir memasukkan hitungan fisik **sebelum** melihat angka sistem.
3. Angka kasir dan angka sistem disimpan sebagai **dua field terpisah**.
4. Buka dan tutup shift berfungsi penuh saat offline.
5. Shift yang sudah `CLOSED` tidak dapat dibuka ulang.

---

## D.1 Siklus hidup shift

### FR-D1 [P0] — Buka shift berfungsi offline

**Deskripsi.** Ini **pembeda utama produk**. Odoo tidak dapat membuka sesi POS baru tanpa internet; Toast tidak dapat login saat offline. Skenario nyatanya: listrik dan internet mati semalam, pagi hari kasir tidak dapat mulai berjualan.

**Prasyarat teknis** (detail di Modul F dan H):
- Kredensial dan hash PIN direplikasi ke perangkat.
- Katalog dan konfigurasi outlet tersedia lokal.
- Shift dibuat lokal dengan ULID client-generated, masuk antrean upload.

**Behavior.**

```
GIVEN perangkat offline sejak semalam
  AND kasir Sari terdaftar di outlet ini dan kredensialnya ter-cache
WHEN Sari membuka aplikasi dan memasukkan PIN
THEN login berhasil tanpa koneksi
 AND Sari dapat membuka shift baru
 AND sistem meminta saldo awal laci
 AND setelah dikonfirmasi, layar kasir aktif dan penjualan dapat dimulai
```

**Acceptance criteria.**

- [ ] Buka shift berhasil dengan koneksi dimatikan sepenuhnya
- [ ] Shift lokal memiliki ULID dan masuk antrean upload
- [ ] Test: matikan jaringan → restart perangkat → login → buka shift → jual → tutup kas, seluruhnya offline
- [ ] Server menerima shift yang dibuat offline tanpa konflik saat sinkronisasi

---

### FR-D8 [P0] — Tutup kas berfungsi offline

**Acceptance criteria.**

- [ ] Tutup kas berhasil tanpa koneksi
- [ ] Laporan shift dapat dilihat dan dicetak dari data lokal
- [ ] Shift yang ditutup offline tersinkron tanpa konflik

---

### State machine shift

```
        ┌────────┐
        │  OPEN  │  penjualan berjalan
        └───┬────┘
            │ kasir menekan "Tutup Kas"
            ▼
        ┌──────────┐
        │ COUNTING │  kasir menghitung fisik; sistem BELUM menampilkan angka
        └───┬──────┘
            │ hitungan fisik dimasukkan
            ▼
        ┌──────────┐
        │ REVIEW   │  sistem menampilkan angka terhitung + selisih
        └───┬──────┘
            │ selisih di bawah ambang → langsung tutup
            │ selisih di atas ambang → PIN manajer + catatan
            ▼
        ┌────────┐
        │ CLOSED │  tidak dapat dibuka ulang
        └────────┘
```

**Aturan.** Satu device memiliki **maksimal satu shift `OPEN`** pada satu waktu. Membuka shift baru saat masih ada yang `OPEN` ditolak.

---

## D.2 Alur tutup kas — kontrol anti-fraud

### FR-D2 [P0] — Urutan input wajib

**Deskripsi.** Kasir memasukkan hitungan fisik **sebelum** sistem menampilkan angka terhitung. Ini kontrol, bukan preferensi UX — kasir yang melihat angka target akan menghitung mundur ke angka itu.

Design system sudah menetapkan copy-nya: *"Hitung dulu, baru sistem menampilkan angkanya."*

**Behavior.**

```
GIVEN shift OPEN dengan 47 transaksi
WHEN kasir menekan "Tutup Kas"
THEN layar menampilkan: jumlah transaksi, rincian per metode pembayaran
 AND TIDAK menampilkan saldo kas terhitung
 AND field input hitungan fisik kosong dan wajib diisi

WHEN kasir memasukkan hitungan fisik Rp 2.450.000
THEN sistem menampilkan:
     Saldo awal          Rp   500.000
     Penjualan tunai     Rp 2.010.000
     Refund tunai       −Rp    25.000
     Setoran            −Rp         0
     Saldo seharusnya    Rp 2.485.000
     Hitungan fisik      Rp 2.450.000
     SELISIH            −Rp    35.000
```

**Yang harus dicegah teknis, bukan hanya UI:**

- Angka terhitung **tidak dikirim ke klien** sebelum hitungan fisik dimasukkan. Bila dikirim di awal dan hanya disembunyikan CSS, kasir teknis dapat melihatnya. Endpoint terpisah, dipanggil setelah input.
- Kasir tidak dapat mengubah hitungan fisik setelah melihat selisih. Untuk mengoreksi, kasir memasukkan hitungan ulang yang **tercatat sebagai percobaan kedua** di audit trail.

**Acceptance criteria.**

- [ ] Payload respons awal tidak memuat saldo terhitung — diverifikasi dengan inspeksi network
- [ ] Field hitungan fisik wajib; tidak dapat dilewati
- [ ] Perubahan hitungan setelah melihat selisih tercatat sebagai percobaan terpisah di audit
- [ ] Copy mengikuti design system, dengan angka uang memakai `tabular-nums`

---

### FR-D3 [P0] — Dua field terpisah

**Deskripsi.** `counted_amount` (dimasukkan kasir) dan `expected_amount` (dihitung sistem) disimpan terpisah. `difference` adalah nilai turunan yang juga disimpan agar laporan tidak menghitung ulang.

**Acceptance criteria.**

- [ ] Ketiga field tersimpan; `difference` = `counted` − `expected`
- [ ] Riwayat percobaan hitungan tersimpan bila ada lebih dari satu
- [ ] Laporan selisih kas dapat difilter per kasir dan per periode

---

### FR-D4 [P0] — Otorisasi selisih

**Behavior.**

```
GIVEN ambang selisih = Rp 20.000
  AND selisih = −Rp 35.000
WHEN kasir mengonfirmasi tutup kas
THEN sistem meminta PIN manajer + alasan dari daftar tertutup
 AND alasan "Lainnya" wajib catatan ≥10 karakter
 AND AuditEvent: actor=kasir, approver=manajer, reason_code, before/after

GIVEN selisih = −Rp 5.000 (di bawah ambang)
WHEN kasir mengonfirmasi
THEN shift ditutup tanpa otorisasi
 AND selisih tetap tercatat dan masuk laporan
```

**Ambang bersifat inklusif:** selisih tepat Rp 20.000 **memicu** otorisasi (`>=`). Dinyatakan eksplisit agar tidak ambigu.

**Daftar alasan selisih kas:** Kelebihan kembalian · Kekurangan kembalian · Uang palsu · Kesalahan hitung · Belum teridentifikasi · Lainnya.

**Acceptance criteria.**

- [ ] Ambang inklusif — diverifikasi test pada nilai tepat di ambang
- [ ] Selisih di bawah ambang tetap tercatat, tidak diabaikan
- [ ] Otorisasi berfungsi offline
- [ ] Selisih positif (kelebihan) juga memicu otorisasi — kelebihan kas sama mencurigakannya dengan kekurangan

---

## D.3 Cash movement

### FR-D5 [P0] — Ledger pergerakan kas

**Deskripsi.** Setiap pergerakan uang tunai adalah entry bertanda. Invariant: saldo laci = `saldo_awal + SUM(delta)`.

**Struktur `CashMovement`:**

| Field | Tipe | Catatan |
|---|---|---|
| `id` | ulid | Client-generated |
| `shift_id` | ulid | |
| `type` | enum | `opening_float` · `sale` · `refund` · `paid_in` · `paid_out` · `bank_deposit` · `adjustment` |
| `delta` | bigint | Bertanda: positif menambah laci, negatif mengurangi |
| `order_id` | ulid nullable | Untuk `sale` dan `refund` |
| `counterpart_type` | enum | `sales_revenue` · `refund` · `owner_draw` · `expense` · `bank` · `unidentified` (FR-D6) |
| `reason_code` | text nullable | Untuk `paid_in`/`paid_out` |
| `note` | text nullable | |
| `created_by` | ulid | |
| `occurred_at` / `recorded_at` / `hlc` | | |

**Aturan.**

- `sale` dibuat **hanya** untuk payment dengan `method = cash`, dalam transaksi yang sama dengan penjualan.
- Kembalian **tidak** menghasilkan movement terpisah — `delta` = `amount` (nilai transaksi), bukan `tendered_amount`.
- `paid_in` dan `paid_out` selalu memerlukan alasan.

**Acceptance criteria.**

- [ ] Invariant saldo laci diverifikasi property test untuk urutan operasi apa pun
- [ ] Pembayaran non-tunai tidak menghasilkan `CashMovement`
- [ ] Pembayaran campuran menghasilkan movement hanya untuk porsi tunai
- [ ] `delta` memakai nilai transaksi, bukan uang yang diserahkan

---

### FR-D6 [P0] — `counterpart_type` sejak v1

**Deskripsi.** Field ini tidak dipakai v1 tetapi wajib diisi. Ia menjaga jalur ke double-entry penuh tanpa harus menebak dari data historis nanti.

**Alasan.** ESB mencantumkan "Automatic Sales Journal, Inventory Journal" bahkan di tier Basic — merchant yang tumbuh **akan** meminta jurnal akuntansi. Ketika itu terjadi, informasi untuk menghasilkan sisi lawan sudah ada.

**Acceptance criteria.**

- [ ] `counterpart_type` `NOT NULL` dengan default yang benar per tipe movement
- [ ] Tidak ada UI yang mengeksposnya di v1
- [ ] Nilainya konsisten — diverifikasi test per tipe movement

---

### FR-D7 [P0] — No-sale

**Deskripsi.** Membuka laci tanpa transaksi adalah pola fraud kasir paling dasar.

**Batasan teknis yang harus diketahui merchant:** sinyal ke laci bersifat **satu arah**. Sistem tidak dapat mengetahui apakah laci benar-benar terbuka, dan **tidak dapat mendeteksi laci yang dibuka manual dengan kunci**. Ini harus dinyatakan di dokumentasi merchant, bukan disembunyikan.

**Behavior.**

```
GIVEN kasir menekan "Buka Laci"
WHEN tidak ada transaksi berjalan
THEN sistem meminta alasan dari daftar tertutup
 AND bila ini pembukaan ke-4 dalam shift, PIN manajer diminta
 AND AuditEvent type='cash_drawer_opened' dibuat dengan alasan dan aktor
 AND perintah buka laci dikirim ke printer
```

**Acceptance criteria.**

- [ ] No-sale selalu memerlukan alasan
- [ ] Ambang frekuensi PIN dapat dikonfigurasi (default 3× per shift)
- [ ] Setiap pembukaan laci yang diperintahkan sistem tercatat di audit trail
- [ ] Frekuensi no-sale per kasir muncul di laporan exception (Modul G)
- [ ] Dokumentasi merchant menyatakan batasan deteksi pembukaan manual

---

## D.4 Laporan shift

**Isi laporan tutup shift** (dapat dicetak, tersedia offline):

```
        TUTUP KAS
        Outlet: Cabang Dago
        Kasir: Sari
        Shift: 26 Jul 2026  07:00 – 15:04
        ────────────────────────────────
        Transaksi              47
        Void                    2
        Refund                  1
        ────────────────────────────────
        Tunai           Rp 2.010.000
        QRIS            Rp 1.245.000
        Kartu (EDC)     Rp   380.000
        ────────────────────────────────
        Saldo awal      Rp   500.000
        Penjualan tunai Rp 2.010.000
        Refund tunai   −Rp    25.000
        Setoran        −Rp         0
        Saldo sistem    Rp 2.485.000
        Hitungan fisik  Rp 2.450.000
        SELISIH        −Rp    35.000
        Alasan: Kekurangan kembalian
        Disetujui: Budi
        ────────────────────────────────
```

**Acceptance criteria.**

- [ ] Laporan dapat dicetak ke printer struk dengan lebar 58mm dan 80mm
- [ ] Tersedia penuh saat offline
- [ ] Selisih dan penyetujunya tercetak bila ada

---

## D.5 Edge cases modul

| Situasi | Perilaku |
|---|---|
| Kasir lupa menutup shift, pulang | Shift tetap `OPEN`. Kasir berikutnya melihat peringatan dan dapat menutupnya dengan otorisasi manajer; `closed_by` berbeda dari `opened_by` dan tercatat |
| Shift melewati tengah malam | Tetap satu shift; tanggal bisnis mengikuti waktu buka shift |
| Shift berjalan > 24 jam | Peringatan di layar kasir setiap 4 jam; tidak diblokir |
| Dua kasir bergantian di satu device | Diizinkan dalam satu shift; setiap transaksi mencatat `created_by`; laporan shift menampilkan rincian per kasir |
| Perangkat mati saat shift `OPEN` | Shift dipulihkan setelah restart dengan seluruh transaksinya |
| Hitungan fisik Rp 0 | Diizinkan (semua uang sudah disetor); selisih dihitung normal |
| Hitungan fisik jauh di atas wajar (mis. Rp 999.999.999) | Konfirmasi tambahan di atas ambang yang dapat dikonfigurasi |
| Tidak ada transaksi sama sekali dalam shift | Tutup kas tetap berjalan; laporan menampilkan nol dengan empty state yang membedakan "belum ada transaksi" dari "tidak ada yang cocok filter" |
| Saldo awal tidak dimasukkan | Wajib; default dapat diisi dari saldo akhir shift sebelumnya, tetapi kasir tetap harus mengonfirmasi |
| Manajer tidak ada saat selisih di atas ambang | Shift tidak dapat ditutup. Mitigasi: kasir dapat memilih "Tunda penutupan" — shift tetap `COUNTING` dan hitungan tersimpan |
| Refund tunai melebihi kas di laci | Diizinkan (laci dapat kekurangan); selisih akan terlihat saat tutup kas |
| Sinkronisasi membawa transaksi dari device lain ke shift ini | **Tidak mungkin** — shift terikat device. Setiap device punya shift sendiri |

---

## D.6 Test yang wajib ada

**Property test:**

- [ ] Untuk urutan operasi apa pun: `expected_amount` = `opening_float` + `SUM(cash_movement.delta)`
- [ ] Untuk shift apa pun: `difference` = `counted_amount` − `expected_amount`
- [ ] Pembayaran non-tunai tidak pernah mengubah saldo laci terhitung

**Test contoh:**

- [ ] Alur penuh offline: login → buka shift → 10 transaksi → tutup kas
- [ ] Pembayaran campuran (tunai Rp 30.000 + QRIS Rp 50.000) → movement hanya Rp 30.000
- [ ] Selisih tepat di ambang memicu otorisasi

**Test kegagalan:**

- [ ] Respons awal tutup kas tidak memuat saldo terhitung
- [ ] Shift `CLOSED` tidak dapat dibuka ulang lewat API
- [ ] Membuka shift kedua di device yang sama ditolak

---

## D.7 Open questions modul ini

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| — | Ambang selisih default Rp 20.000 — validasi dengan 3 merchant | Implementasi FR-D4 |
| — | Apakah saldo awal shift otomatis diisi dari saldo akhir shift sebelumnya, atau selalu manual? | Implementasi FR-D1 |
| — | Apakah fitur "setoran ke brankas" (`bank_deposit`) dibutuhkan di v1 atau v1.1? | Implementasi FR-D5 |
| — | Berapa lama shift boleh `OPEN` sebelum sistem memaksa penutupan? | Implementasi edge case |

---

*Spec Modul D · Lumi POS v1 · Draft 0.1*
