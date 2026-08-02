# PLAN — F1 Modul B (Kasir & Order), sub-project 1: fondasi order

Status: **disetujui, dalam pengerjaan.** Keputusan user 2 Agustus 2026 — lihat §8.0.

---

## 1. Ringkasan audit

1. `main` di `91bd2a2` — PR #4 merged, 365 test hijau, CI hijau.
2. Modul A selesai untuk backend: 32 operasi REST, FR-A1/A2/A4/A6/A9 tertutup, FR-A7 sebagian.
3. `resolvePrice` sudah diekspor lewat `catalog/index.ts` — prasyarat `order_line.unit_price` sudah siap dipakai.
4. **Seluruh tabel Modul B sudah ada** sejak F0 (`0007_ordering.sql`, `0008_payment.sql`, `0013_server_only.sql`). Tidak ada tabel baru yang perlu dibuat.
5. Modul B punya **11 FR dan 58 acceptance criteria** — lebih besar dari seluruh Modul A. Tidak muat dalam satu sub-project.
6. **Skema memaksa tiga dependensi lintas fase.** `order.shift_id`, `order.device_id`, dan `order.hlc` semuanya `NOT NULL`, sementara shift ada di F3, HLC di F2. Rinciannya §8.
7. `ux_device_outlet_code` sudah ada (`0003_identity.sql:61`) — AC FR-B6 "constraint unik di level database" **sudah terpenuhi F0**.
8. `packages/domain/` masih hanya berisi `README.md`. State machine FR-B1 harus hidup di sana, bukan di handler.
9. **Ada drift spec-vs-skema pada `quantity`** yang saya tidak berwenang putuskan sendiri. §8 Q4.

---

## 2. Milestone yang dipilih

**F1 · Modul B sub-project 1 — fondasi order: state machine, snapshot, penomoran struk, idempotency.**

Dari roadmap:

> `product/ARCH-lumi-pos-v1.md:395` — **F1** 4–6 mgg | Modul catalog, **ordering**, payment · idempotency · append-only | Satu penjualan tersimpan atomik **dengan pajak benar**; property test invariant uang hijau

Katalog sudah selesai; `ordering` adalah yang berikutnya dalam baris yang sama.

**Kenapa dipecah.** Modul B punya 58 acceptance criteria dan bergantung pada pembayaran (Modul C) untuk separuh state machine-nya (`OPEN → PAID` disyaratkan `SUM(payment.confirmed) ≥ amount_due`). Membangun semuanya sekaligus berarti satu perubahan raksasa tanpa titik verifikasi di tengah.

Usul pemecahan:

| Sub-project | Isi | FR |
|---|---|---|
| **B-1 (plan ini)** | Order + check + line + modifier, state `DRAFT`→`OPEN`, snapshot, quantity, nomor struk, idempotency | B1 (sebagian) · B2 · B3 · B4 · B5 · B10 · B12 |
| **B-2** | Pembayaran + pajak, `OPEN`→`PAID`→`CLOSED` | Modul C + sisa B1 |
| **B-3** | Void & refund, otorisasi step-up | B7 · B8 · B9 |

---

## 3. Scope

### 3.1 Lapisan domain — `packages/domain/`

Pertama kalinya paket ini diisi. **State machine FR-B1 ditulis di sini, bukan di handler**, karena AC-nya berbunyi:

> `spec-b-kasir-order.md:73` — Transisi ilegal ditolak di lapisan domain, bukan hanya UI

dan klien (Tauri/SQLite) harus menegakkan aturan yang sama tanpa server. `ARCH §7` menyebut lapisan bersama ini sebagai nilai terbesar berbagi TypeScript.

Isi: tabel transisi legal, fungsi `assertTransition(from, to)`, dan perhitungan total baris/order — **fungsi murni, tanpa I/O, tanpa akses database.**

### 3.2 Penulisan penjualan — satu transaksi

`POST /orders` menulis `order` + `check` + `order_line` + `order_line_modifier` + `outbox` + `idempotency_key` **dalam satu `withTenantTransaction`**. Invariant #1 dan FR-B2.

`stock_movement` dan `audit_event` **tidak** ditulis di sub-project ini — lihat non-scope.

### 3.3 Snapshot (FR-B3)

Setiap `order_line` menyimpan `item_name`, `variation_name`, `unit_price`, `modifier_snapshot`, `cost_at_sale`, `line_total` sebagai **salinan nilai**. `unit_price` berasal dari `resolvePrice` (sudah ada), `cost_at_sale` dari `item_variation.cost`.

Keduanya dibaca lewat `catalog/index.ts`, bukan query langsung — invariant #4.

### 3.4 Nomor struk (FR-B5)

Format `K1-20260726-0007`. **Server tidak pernah mengalokasikan nomor** — klien mengirimnya. Server hanya menegakkan `UNIQUE (device_id, business_date, sequence)` yang sudah ada di skema, dan menolak bentrok dengan error yang bisa ditindaklanjuti klien.

### 3.5 Idempotency (FR-B10)

Tabel `idempotency_key` sudah ada. Tiga aturan dari `spec-b:333-348`:

| Kondisi | Hasil |
|---|---|
| Key sama + `request_hash` sama | Kembalikan `response_body` tersimpan, jangan proses ulang |
| Key sama + `request_hash` **berbeda** | `422` — bug klien, bukan cache hit |
| Dua request bersamaan dengan key sama | Tepat satu berhasil, satu `409` |

**Key dan penjualan ditulis dalam satu transaksi.** Terpisah = jendela duplikat.

### 3.6 Kontrak

`packages/contracts/openapi.yaml` — operasi baru untuk membuat order, membacanya, dan menambah baris.

---

## 4. Non-scope — ditulis eksplisit

| Hal | Alasan |
|---|---|
| **Pembayaran** (`payment`), `OPEN`→`PAID`→`CLOSED` | Sub-project B-2, bersama Modul C |
| **Pajak** — `tax_rate`, `tax_amount`, `is_tax_inclusive` | Invariant #7: hanya `TaxCalculator` yang boleh menghasilkan angka pajak, dan itu Modul C. Di sub-project ini kolom pajak ditulis **nol**, dan itu **bukan** "pajak benar" yang diminta exit criteria F1 — lihat §8 Q5 |
| **Void & refund** (FR-B7) | Sub-project B-3 |
| **Otorisasi step-up** (FR-B8/B9) | Butuh PIN dan hash lokal — Modul F |
| **`stock_movement`** | Modul E (inventori). Invariant #1 menuntutnya ikut dalam transaksi yang sama, jadi ia masuk saat Modul E dibangun, bukan disisipkan setengah jadi sekarang |
| **`audit_event`** | Modul F |
| **Worker pengirim `outbox`** | Barisnya ditulis; pengirimnya F2 |
| **Cetak ulang struk** (FR-B11) | P1, dan butuh printer (F4) |
| **UI apa pun** | Tidak ada UI di proyek ini |
| **`ABANDONED` saat tutup shift** | Butuh Modul D |

---

## 5. Task breakdown — urutan TDD

Setiap task: test merah dulu → konfirmasi merah karena alasan yang benar → implementasi minimum → suite penuh hijau.

Prasyarat — tiga hal harus ada sebelum satu baris order pun bisa ditulis (keputusan Q1–Q3):

- [x] **T0a** — `packages/domain`: generator HLC dengan **clock di-inject**, fungsi murni. Test: monotonik walau clock mundur; dua panggilan pada milidetik sama menghasilkan nilai berbeda dan naik; clock palsu mengendalikan hasil sepenuhnya (tanpa itu, harness DST F2 mustahil).
- [x] **T0b** — Modul `identity`: `POST /devices` (FR-B6). Test: kode duplikat di outlet yang sama ditolak dan **pesannya menyebut device yang memakainya**; kode dapat dipakai ulang setelah `revoked_at` terisi; kode sama di outlet berbeda diterima; device lintas tenant tidak terlihat.
- [x] **T0c** — Modul `cash`: `POST /shifts` (buka shift saja). Test: shift terbuka menghasilkan `shift_id` sah; `device_id` dan `outlet_id` divalidasi lewat SELECT tunduk RLS; dua shift terbuka bersamaan untuk satu device ditolak.

Inti:

- [x] **T1** — `packages/domain`: tabel transisi + `assertTransition`. **Property test**: untuk setiap pasangan (from, to) dari seluruh status, hasil sesuai tabel FR-B1. Termasuk yang ditolak eksplisit: `CLOSED`→`OPEN`, `VOIDED`→apa pun, `REFUNDED`→`PAID`.
- [x] **T2** — `packages/domain`: perhitungan `line_total` dan total order. **Property test**: uang selalu `bigint`, pembulatan half-up, tidak pernah float.
- [x] **T3** — `POST /orders` jalur bahagia: order + check + line + modifier tersimpan, status `open`, `201`.
- [ ] **T4** — Atomisitas (FR-B2): injeksi kegagalan di tiap tahap penulisan → **nol baris tersisa di semua tabel**. Bukan hanya order yang hilang — check dan line juga.
- [x] **T5** — Snapshot (FR-B3): skenario `spec-b:132-139` sebagai test — ubah harga, rename item, arsipkan, lalu baca order lama; harus menampilkan nilai saat transaksi.
- [x] **T6** — Snapshot tidak menyentuh katalog: baca order tidak menghasilkan query ke tabel katalog (grep guard + test perilaku).
- [x] **T7** — Guard FK klien-suplai lintas tenant untuk `variation_id`, `outlet_id`, `device_id`, `shift_id` → `404`, **dan buktikan tidak ada baris tersimpan**. Pola yang sama dengan FR-A7; ini empat FK baru sekaligus.
- [ ] **T8** — Quantity (FR-B4): `0.5` dapat disimpan dan dibaca kembali utuh. Bentuk tergantung Q4.
- [x] **T9** — Nomor struk (FR-B5): bentrok `(device_id, business_date, sequence)` ditolak dengan error yang bisa ditindaklanjuti, bukan `500`. Dua device berbeda dengan sequence sama diterima.
- [ ] **T10** — Idempotency: ketiga aturan §3.5, masing-masing satu test.
- [ ] **T11** — Idempotency konkuren: dua request bersamaan dengan key sama → tepat satu `201`, satu `409`, **tepat satu order tersimpan**.
- [ ] **T12** — Idempotency stress: kirim request sama 100× → tepat satu penjualan (AC `spec-b:360`).
- [ ] **T13** — `outbox` ditulis dalam transaksi yang sama; rollback menghapusnya juga.
- [x] **T14** — `check` dikunci 1:1 (FR-B12): order kedua tidak bisa memakai `check` yang sama.
- [ ] **T15** — Kontrak OpenAPI.
- [ ] **T16** — Perbarui `CLAUDE.md`, `README.md`, `HANDOFF.md`, `modules/README.md`. **Tidak menyentuh `product/`, `research/`, `docs/superpowers/specs/`.**

---

## 6. Rencana test

| Suite | Perkiraan |
|---|---|
| `npm run test:domain` (baru) | T1–T2, property test murni tanpa database — cepat |
| `npm run test:ordering` (baru) | T3–T14, target +50 test |
| `npm run test:isolation` | tetap 189 |
| `npm run test:catalog` | tetap 139 |
| CI | dua script baru ditambahkan ke `.github/workflows/test.yml` |

Test lintas tenant (T7) wajib membuktikan **tidak ada baris tersimpan**, bukan sekadar status code. Tiga kali berturut-turut di proyek ini status code saja terbukti tidak cukup.

T11 (konkurensi) harus dibuktikan **tidak vacuous** — nonaktifkan mekanismenya dan pastikan test benar-benar merah. Pelajaran dari Modul A: satu test konkurensi lolos meski kuncinya dihapus.

---

## 7. Definition of done

- [ ] State machine diuji sebagai **property** atas seluruh pasangan status
- [ ] Perhitungan uang diuji sebagai **property** — `bigint`, half-up, tidak pernah float
- [ ] Atomisitas dibuktikan lewat injeksi kegagalan di setiap tahap
- [ ] Idempotensi diuji dengan retry berulang **dan respons yang hilang**
- [ ] Isolasi tenant diuji untuk keempat FK klien-suplai baru
- [ ] Tidak ada `UPDATE` pada order yang sudah selesai; append-only terbukti
- [ ] Empty state dan error state ada di setiap endpoint
- [ ] Seluruh suite hijau, output ditempel apa adanya

Yang **tidak** bisa dicentang dan alasannya di §4: pajak benar (Modul C), perilaku offline penuh (F2), `kill -9` di tengah commit dengan SQLite lokal (butuh jalur SQLite yang belum ada — **memblokir AC FR-B2 keempat**), audit event (Modul F), stok kembali (Modul E).

---

## 8.0 Keputusan user (2 Agustus 2026)

| # | Keputusan | Konsekuensi |
|---|---|---|
| **Q1** | **Bangun irisan minimal Modul D** — hanya buka shift | Modul `cash` lahir dengan satu operasi (`POST /shifts`). Tutup shift, hitung kas, selisih tetap F3. `order.shift_id` menunjuk baris sungguhan sejak penjualan pertama |
| **Q2** | **Bangun `POST /devices` sekarang** | **FR-B6 tertutup penuh** di sub-project ini — constraint `ux_device_outlet_code` sudah ada sejak F0, tinggal jalur aplikasinya. Termasuk pesan penolakan yang menyebut device pemakai kode, dan pakai-ulang kode setelah pencabutan |
| **Q3** | **Generator HLC dengan clock di-inject** | Lahir di `packages/domain` sebagai fungsi murni + port waktu. Prasyarat harness DST F2, dan `CLAUDE.md` menyebut retrofitnya mahal — jadi tidak ditunda |
| **Q5** | **Pajak nol dulu, ditandai eksplisit** | Kolom pajak ditulis `0`. **F1 belum tertutup sampai Modul C selesai**, dan dokumen harus mengatakannya, bukan menyiratkan sebaliknya |

Q1 dan Q2 memperbesar scope: dua modul baru (`cash`, dan `identity` naik dari satu guard jadi punya endpoint) lahir sebelum `ordering` bisa menulis satu baris pun. T0 dipecah jadi T0a–T0c.

### Q4 — drift `quantity`: tidak diputuskan, dilanjutkan sebagai asumsi bertanda

`spec-b:151,159` menulis `quantity` harus `numeric`; skema `0007` dan `CLAUDE.md` memakai `bigint ×1000` dengan alasan hasil pengukuran (`REAL` membuat `WHERE stok = 0` gagal diam-diam).

**[ASUMSI] Skema yang benar, AC FR-B4 yang perlu diperbarui.** Dasarnya `CLAUDE.md`: "Angka hasil pengukuran mengalahkan estimasi." Maksud sebenarnya tetap terpenuhi — `0.5 kg` disimpan sebagai `500`, dan itu diuji di T8.

Yang **tidak** bisa dicentang apa adanya: AC "Kolom `quantity` bertipe numerik di PostgreSQL dan SQLite". Aku tidak mengubah `spec-b`; keputusan itu milikmu.

## 8. Keputusan yang kubutuhkan — semuanya memblokir

Empat pertama lahir dari satu temuan yang sama: **skema F0 memaksa Modul B bergantung pada modul yang roadmap taruh di fase berikutnya.** Ini bukan sesuatu yang boleh kuputuskan sendiri.

### Q1 — `order.shift_id` `NOT NULL` menunjuk `cash_drawer_shift`. Shift ada di F3.

`db/migrations/0007_ordering.sql:9` — `shift_id text NOT NULL REFERENCES cash_drawer_shift(id)`.

Artinya **tidak satu order pun bisa ditulis tanpa shift terbuka**. Tapi `ARCH:397` menaruh modul `cash` di **F3**, dan `ARCH:396` menaruh "buka shift offline" di **F2**.

**(a) Bangun irisan minimal Modul D sekarang** — hanya "buka shift" (`POST /shifts`), cukup untuk menghasilkan `shift_id` yang sah. Tutup shift, hitung kas, dan selisih tetap di F3. **Rekomendasi saya** — ini yang paling jujur terhadap skema, dan buka-shift memang sudah disebut di F2.

**(b) Jadikan `shift_id` nullable** lewat migrasi baru. Cepat, tapi melubangi jaminan bahwa setiap penjualan terikat ke shift — dan itu jaminan yang dipakai laporan tutup kas nanti. Saya tidak menyarankan.

**(c) Kerjakan Modul D lebih dulu, seluruhnya.** Menggeser urutan roadmap.

### Q2 — `order.device_id` `NOT NULL` menunjuk `device`. Provisioning device ada di mana?

Menariknya, **FR-B6 (pencegahan kode device duplikat) ada di spec Modul B sendiri**, dan constraint databasenya sudah ada sejak F0 (`ux_device_outlet_code`). Jadi provisioning device bisa dibaca sebagai scope Modul B.

**(a) Bangun `POST /devices` di sub-project ini**, menutup FR-B6 sekalian. **Rekomendasi saya.**
**(b) Header placeholder `X-Device-Id`** seperti `X-Actor-Id`, provisioning ditunda. Lebih kecil, tapi FR-B6 tetap terbuka dan device bisa menunjuk baris yang tidak divalidasi.

### Q3 — `order.hlc` `NOT NULL`. HLC adalah F2.

`CLAUDE.md` mensyaratkan lapisan sync ditulis dengan **waktu, keacakan, dan I/O di-inject sebagai dependensi** — dan menyebut retrofitnya mahal.

**(a) Bangun generator HLC sekarang, dengan clock di-inject.** Lebih mahal di depan, tapi persis yang `CLAUDE.md` peringatkan untuk tidak ditunda. **Rekomendasi saya.**
**(b) Terima `hlc` dari klien apa adanya**, validasi bentuk saja. Sesuai semangat client-generated ID, tapi server tidak punya pertahanan terhadap HLC ngawur.
**(c) Tulis `0` sebagai placeholder.** Murah, dan akan menghantui F2.

### Q4 — Drift: `quantity` `numeric` (spec) versus `bigint ×1000` (skema + CLAUDE.md)

Dua dokumen bertentangan, dan aku tidak berwenang mengubah salah satunya.

> `spec-b-kasir-order.md:151` — "`quantity` bertipe `numeric`, bukan `integer`"
> `spec-b-kasir-order.md:159` — AC: "Kolom `quantity` bertipe numerik di PostgreSQL dan SQLite"

> `db/migrations/0007_ordering.sql:63` — `quantity bigint NOT NULL, -- x1000`
> `CLAUDE.md` — "**Kuantitas** | `INTEGER ×1000` ... **Terbukti lewat pengukuran**: `REAL` membuat `WHERE stok = 0` gagal diam-diam"

Keduanya memenuhi maksud sebenarnya — `0.5 kg` bisa disimpan (sebagai `500`). Yang bertentangan adalah **kata dalam AC**, dan AC itu tidak bisa dicentang apa adanya terhadap skema yang ada.

`CLAUDE.md` sendiri bilang angka hasil pengukuran mengalahkan estimasi, jadi **usulku: skema `bigint ×1000` yang benar, dan AC FR-B4 yang perlu diperbarui.** Tapi memperbarui spec adalah keputusanmu, bukan keputusanku — aku hanya melaporkannya.

### Q5 — Exit criteria F1 menyebut "pajak benar". Sub-project ini menulis pajak nol.

> `ARCH:395` — F1 ... **Satu penjualan tersimpan atomik dengan pajak benar**

Invariant #7 melarang angka pajak muncul di luar `TaxCalculator`, dan `TaxCalculator` adalah Modul C. Jadi sub-project ini **tidak bisa** menghasilkan pajak yang benar — kolomnya ditulis nol sampai B-2.

**(a) Terima ini**, tandai eksplisit bahwa F1 belum tertutup sampai B-2 selesai. **Rekomendasi saya** — sama seperti FR-A7 yang sengaja ditandai "sebagian".
**(b) Gabungkan Modul C ke sub-project ini.** Satu perubahan jauh lebih besar, tanpa titik verifikasi di tengah.

### Risiko

- **Ini perubahan terbesar sejauh ini.** Modul A sub-project terbesar menyentuh 4 tabel; ini menyentuh 6 sekaligus dalam satu transaksi, plus paket `packages/domain` yang belum pernah ada isinya.
- **Empat FK klien-suplai baru sekaligus** (`variation_id`, `outlet_id`, `device_id`, `shift_id`). Tiga kali berturut-turut kelas bug ini muncul di proyek ini. Semua akan diuji dengan bukti tulis, bukan status code.
- **AC FR-B2 keempat — `kill -9` di tengah commit dengan SQLite lokal — tidak bisa dipenuhi.** Jalur SQLite WASM+OPFS belum dibangun, dan itu item F0 terakhir yang masih terbuka. Dicatat sekarang supaya tidak terlihat seperti kelalaian nanti.
