# Lumi POS — Memori Proyek

Point-of-sale untuk kafe takeaway **2–20 outlet di Indonesia**. Nilai jualnya: tetap berfungsi penuh tanpa internet — termasuk buka shift, refund, dan tutup kas — dengan batas kemampuan yang **tertulis eksplisit**, bukan ditemukan merchant saat outage.

Bahasa dokumen dan antarmuka: **Indonesia**. Istilah teknis tetap Inggris.

---

## ⛔ Delapan invariant — tidak dapat dinegosiasikan

Pelanggaran = cacat, bukan preferensi gaya. Tolak di review.

1. **Satu penjualan = satu transaksi database.** Order + line + modifier + payment + stock movement + cash movement + audit event + outbox + idempotency key, semuanya dalam satu transaksi. Tidak pernah dipecah jadi event asinkron.
2. **Transaksi selesai tidak pernah di-`UPDATE`.** Void dan refund adalah record baru. Katalog tidak pernah di-`DELETE`, hanya `archived_at`.
3. **Simpan sebelum cetak, selalu.** Cetak dan buka laci adalah efek samping yang boleh gagal. Struk bisa dicetak ulang; penjualan yang hilang tidak bisa dipulihkan.
4. **Tidak ada akses database lintas modul.** Modul berkomunikasi hanya lewat `index.ts` publik. Kepemilikan tabel ada di `product/ARCH-lumi-pos-v1.md` § 3.
5. **Tidak ada `if (isOnPrem)` di kode aplikasi.** Perbedaan lingkungan hanya lewat environment variable.
6. **Tidak ada `if (vertical === 'fnb')` di luar lapisan yang membaca `VerticalProfile`.**
7. **Tidak ada angka pajak di luar `TaxCalculator`.** Kemunculan `0.11`, `* 0.1`, `10%` di jalur perhitungan mana pun adalah cacat arsitektur.
8. **Aplikasi connect ke PostgreSQL sebagai user yang tunduk RLS.** Bukan superuser, bukan owner tabel. `FORCE ROW LEVEL SECURITY` aktif. `app.tenant_id` di-`SET LOCAL` **per transaksi**, bukan per koneksi.

---

## ⛔ Aturan uang, kas, dan sync — selalu dimuat

Aturan saja, tanpa riwayat — riwayat dan alasan lengkap ada di `docs/keputusan/*.md`. Subagen yang menyentuh jalur uang tidak boleh bergantung pada mengikuti rujukan; daftar ini wajib cukup sendiri.

- Pembulatan FR-C9 hanya pada SISA TUNAI sesudah bagian non-tunai, tidak pernah pada `total`. Di perangkat hanya dihitung di `simpanPenjualan` dan hanya tampil di K-07, tidak pernah di K-06; di server hanya di handler `payments` (`computeCashRounding`).
- Pembayaran campuran: bagian TUNAI dikirim TERAKHIR (rantai `depends_on` eksplisit); server menghitungnya dari `total − SUM(confirmed)`.
- Satu baris `payment` per bagian pembayaran. Tidak pernah digabung jadi satu baris.
- Kelebihan bayar NON-TUNAI ditolak. Hanya satu bagian tunai per transaksi.
- QRIS dinamis hanya `confirmed` dari jawaban GATEWAY — tidak pernah ditebak dari status tak dikenal.
- Sync rules adalah SATU-SATUNYA batas tenant pada jalur turun PowerSync (replikasi logis tidak tunduk RLS).
- `item_variation.cost` dan `order_line.cost_at_sale` TIDAK PERNAH turun ke perangkat; server men-snapshot `cost` ke `cost_at_sale` saat order masuk, dan nilai dari klien diabaikan.
- `cash_movement` adalah SATU-SATUNYA definisi saldo laci (`saldo_awal + SUM(delta)`) — tidak ada sumber kedua.
- Pembayaran NON-TUNAI tidak pernah menulis `cash_movement`.
- `posisi-penjualan.ts` adalah SATU-SATUNYA definisi omzet; laporan lain memanggilnya, tidak menghitung ulang.
- Nilai refund lewat `allocateProportionally(order.total, line_total[])`, bukan jumlah `order_line.line_total`.
- Refund tidak pernah membuat `payment` negatif — arah berlawanan dinyatakan lewat baris `refund`.
- Transaksi selesai tidak pernah di-`UPDATE`; void dan refund adalah record baru (invariant #2).
- `jumlah` kas manual (masuk/keluar) selalu POSITIF; `arah` yang menurunkan tandanya — tidak pernah `delta` bertanda.
- Tidak ada angka pajak di luar `TaxCalculator` (invariant #7); tarif selalu `bigint` berskala 10.000, tidak pernah float.

## Stack — terkunci, bukan untuk diperdebatkan

| Lapisan | Pilihan |
|---|---|
| Backend | **Node.js 24.7+** · TypeScript · **Fastify** |
| API | **REST + OpenAPI spec-first** (bukan tRPC — klien POS tidak bisa dipaksa update) |
| Database | **PostgreSQL 17+** · RLS · queue via `SKIP LOCKED` (**tanpa Redis di v1**) |
| Frontend | **React 19 + Vite (SPA)** — terkunci oleh `/ds-bundle` |
| Styling | **CSS custom properties + `components.css`** apa adanya. Tailwind hanya utilitas layout, **tanpa nilai arbitrer** |
| Desktop | **Tauri 2** (bukan Electron) |
| DB lokal | **SQLite** — WASM+OPFS di web, native di Tauri |
| Sync | **Hybrid**: PowerSync Open Edition untuk jalur turun · outbox lokal + REST idempoten untuk jalur naik |
| Auth | Buatan sendiri, modul terisolasi (alur POS tidak dilayani IAM generik) |

Alasan tiap pilihan ada di `research/03-TECH-STACK-EVALUATION.md`. **Jangan mengusulkan alternatif kecuali diminta.**

**Lantai Node adalah 24.7, bukan 22** (dinaikkan 14 Agustus 2026). `crypto.argon2` — hash PIN Modul F, dan alasan repo ini tidak punya dependency Argon2 sama sekali — baru ada sejak Node 24.7.0. `engines.node`, `node-version` di kedua workflow, dan runtime pengembang dijaga tetap sepakat oleh `tests/runtime/versi-node.test.js`, yang berjalan **paling dulu** di CI. Tanpa itu, runtime yang terlalu tua muncul sebagai test PIN merah yang tidak menyebut kata "Node" sama sekali. `research/00` dan `research/03` masih menulis "Node.js 22+" — itu penyuntingan dokumen riset, bukan kewenangan agent.

### ⛔ Container baru: `bash tools/siapkan-dev.sh` SEBELUM apa pun

Container diganti di tengah pekerjaan (19 September 2026) dan yang baru tidak
punya satu pun dari tujuh prasyarat: `node_modules` kosong · Node 22.22.2
sementara repo mengunci `>=24.7` · `origin/main` tidak ada · PostgreSQL mati ·
`.env` tidak ada · role `lumi_owner`/`lumi_app` belum dibuat · nol migrasi.

⛔ **Yang mahal bukan tujuh langkahnya melainkan BENTUK kegagalannya.**
`node --env-file=.env` pada berkas yang tidak ada mencetak satu baris
`node: .env: not found` lalu keluar tenang, jadi sembilan suite ber-database
tercetak sebagai **baris kosong** di ringkasan — terbaca seperti "belum
selesai", bukan seperti "tidak pernah jalan". Kelas cacat "nol baris, bukan
error", kali ini pada perkakasnya sendiri.

Skripnya idempoten, **gagal keras dengan menyebut langkah mana**, dan diakhiri
dengan menjalankan `test:isolation` — penyiapan yang berakhir "selesai" tanpa
menjalankan apa pun hanyalah klaim.

- ⛔ **Ia mencetak baris `export PATH=…` dan menulisnya ke `CLAUDE_ENV_FILE`.**
  Skrip tidak dapat mengubah PATH induknya; tanpa baris itu perintah berikutnya
  kembali ke Node yang terlalu tua, dan gejalanya muncul jauh dari sebabnya.
- ⛔ **`.claude/hooks/session-start.sh` MEMANGGILNYA, tidak menyalinnya.** Yang
  berbeda kebijakannya, bukan langkahnya: skrip gagal keras (dipanggil orang
  yang ingin tahu langkah mana), hook menurunkannya jadi peringatan (sesi yang
  menolak dimulai karena PostgreSQL mati lebih buruk daripada sesi yang dimulai
  dengan catatan).
- ⛔ **BUKAN untuk CI.** `.github/workflows/test.yml` menyiapkan dirinya sendiri.
  Dua penyiapan yang saling menyalin akan menyimpang, dan yang menyimpang
  membuat "hijau di lokal, merah di CI" tidak dapat dijelaskan. Yang dibagi
  keduanya `db/bootstrap.js` dan `db/migrate.js`.

---

## Konvensi data

| Hal | Aturan |
|---|---|
| **Uang** | `bigint` rupiah utuh. **Tidak pernah float.** Design system menetapkan tanpa desimal |
| **Kuantitas** | `INTEGER ×1000`. `0.5 kg` → `500`. **Terbukti lewat pengukuran**: `REAL` membuat `WHERE stok = 0` gagal diam-diam |
| **ID** | ULID/UUIDv7 **di-generate klien**. Auto-increment mustahil untuk penulisan offline |
| **Waktu** | `occurred_at` (device) + `recorded_at` (server) + `hlc`. Simpan UTC, tampilkan zona outlet |
| **Tanggal bisnis** | Berakhir saat **tutup shift**, bukan tengah malam. Default `04:00` |
| **Stok** | `SUM(stock_movement.delta)`. **Tidak ada kolom `quantity`** |
| **Enum** | `text` + CHECK constraint, bukan integer |
| **Nomor struk** | `K1-20260726-0007` — prefiks device + tanggal + urutan. Counter **lokal**, tidak pernah minta ke server |
| **Tenant** | Setiap tabel punya `tenant_id` + kebijakan RLS untuk keempat operasi |
| **Larangan** | Tidak ada kolom untuk PAN, CVV, PIN kartu, data track. Selamanya |

---

## Aturan design system — `/ds-bundle` final, jangan diubah

1. Tepat **4 ukuran teks**: 32/20/15/13, bebas dipakai di mana saja. Tidak ada token khusus — lihat § Skala teks final.
2. Satu aksen (`--primary`, nilai mockup — saat ini `#14706b`), < 5% area, **satu aksi utama per layar**.
3. Target sentuh ≥ **44px**; aksi menyangkut uang **56px**.
4. Angka uang selalu `tabular-nums` (kelas `.num`).
5. Status **tidak pernah warna saja** — selalu ada teks.
6. Semua styling lewat token; **tidak ada nilai warna/ukuran hardcoded** di komponen.
7. Bahasa Indonesia. Setiap komponen punya keadaan **kosong** dan **error**.
8. Tanpa emoji, tanpa dark mode. Gradien, tekstur, dan gambar produk diizinkan — lihat `docs/keputusan/design-system.md` § Pelonggaran DS #8 dan § Gambar produk.
9. Tanpa onboarding in-app, tanpa wizard, tanpa tooltip.

⛔ **Aturan #1 dan #2 mengikuti nilai MOCKUP, bukan lagi nilai lama yang dipaku** (keputusan kampanye Hidupkan desain, 26 September 2026 — `docs/RENCANA-HIDUPKAN-DESAIN.md`). Aturan #1 sebelumnya berbunyi "32/20/15/12" ditambah token khusus `--t-metric`; digantikan skala mockup 32/20/15/13 tanpa token kelima — lihat § Skala teks final untuk riwayatnya. Aturan #2 sebelumnya memaku aksen ke `#0D5C63`; digantikan aksen mockup (`--primary`, `docs/referensi-visual/sumber/tokens/colors.css`), dengan disiplin yang sama: < 5% area, satu aksi utama per layar. Nilai efektif tetap wajib diukur (`getComputedStyle`), bukan disimpulkan dari nama token — dijaga `tests/runtime/token-mockup.test.js` (nilai di berkas) dan `tests/kasir-dom/palet-berlaku.test.js` (nilai yang sungguh dirender).

`_adherence.oxlintrc.json` dari `/ds-bundle` **wajib masuk CI sejak commit pertama**.

⛔ **`ds-bundle/` adalah artefak VENDOR dan tidak pernah disunting langsung** (keputusan user, 31 Agustus 2026). Seluruh perubahan lewat override di `packages/ds`. Suntingan di tempat hilang tanpa jejak pada pembaruan bundle berikutnya, dan yang hilang adalah perbaikan aksesibilitas. Dijaga `tests/runtime/ds-bundle-vendor.test.js`.

⛔ **Wordmark "LumiPOS" dengan ikon toko di kotak beraksen — bukan lagi "tidak boleh disentuh sama sekali"** (keputusan kampanye Hidupkan desain, 26 September 2026 — `docs/RENCANA-HIDUPKAN-DESAIN.md`). Aturan lama di baris ini berbunyi *"Tidak boleh disentuh sama sekali: logo, nama 'Lumi POS', aksen teal `#0D5C63`"*; digantikan. Nama tampil sebagai satu kata "LumiPOS" (tanpa spasi, ejaan berubah), lewat satu komponen `packages/ds/Wordmark.tsx`: ikon `store` 20px dalam kotak 36×36 bersudut `--radius-control` berlatar `--primary`, teks 20px bobot 600 di sampingnya — bukan huruf pertama atau logo lama. Dipasang di `ShellKasir` (topbar kasir), `AppShell.brand` back-office (menggantikan `LogoLumi`), dan kedua layar masuk (back-office, HP). Aksen sendiri kini nilai mockup, bukan `#0D5C63` yang dipaku — lihat aturan #2 di atas.

⛔ **Ikon INTERNAL bundel dialihkan lewat plugin Vite, bukan disunting di tempat** (Task 7, 26 September 2026). `ds-bundle/components/**` (Modal, AppShell, StatCard, SyncIndicator, Ticket, Stepper) memanggil `Icon` dari `forms/Icon.jsx` bundel (42 path gambar-ulang "gaya Lucide") SECARA INTERNAL; `packages/ds/vite-ikon.ts` (`ikonLumi()`) mencegat impor relatif itu di `resolveId` dan mengarahkannya ke `packages/ds/ikon.tsx` — set node `lucide-react@0.468.0` apa adanya (Task 6). Dipasang di SETIAP config Vite yang merender komponen bundel (`apps/kasir/vite*.config.ts` ×3, `apps/backoffice/vite.config.ts`, `apps/hp/vite.config.ts`), dengan komentar di masing-masing — plugin ini **sengaja tidak disembunyikan** (keputusan user), lihat juga `packages/ds/README.md`. Dijaga `tests/runtime/ikon-lucide.test.js` (config yang lupa memasangnya, dan konsumen lain yang membaca `Icon.jsx` bundel langsung) dan `tests/kasir-dom/ikon-bundle.test.js` (pengukuran DOM sungguhan).

### Skala teks final — EMPAT token, nilai mockup

⛔ **Digantikan** (keputusan kampanye Hidupkan desain, 26 September 2026 — `docs/RENCANA-HIDUPKAN-DESAIN.md`, Task 4). Aturan lama di sini adalah keputusan user 31 Agustus 2026 ("Opsi A"): LIMA token bundle — empat inti bebas dipakai di mana saja, ditambah satu token khusus (`--t-metric`, 24px) untuk angka KPI kartu dasbor B-01. Skala final sekarang murni **EMPAT** token, nilai mockup: `--text-display` 32 · `--text-title` 20 · `--text-body` 15 · `--text-small` 13 (bundle menyebutnya `--text-caption`, diarahkan ke `--text-small` lewat `packages/ds/lumi.css`). Angka KPI dasbor B-01 memakai ukuran DISPLAY yang sama dengan total/kembalian kasir (32px, bobot 700) — bukan ukuran kelima.

| Token | px (nilai mockup) | Bobot | Boleh dipakai di |
|---|---:|---:|---|
| `--text-display` | 32 | 700 | mana saja — total, kembalian kasir, angka KPI dasbor |
| `--text-title` | 20 | 600 | mana saja — judul layar, judul kartu |
| `--text-body` | 15 | 400 (600 untuk label tombol) | mana saja — isi, sel tabel |
| `--text-small` (`--text-caption` bundle) | 13 | 400 (600 untuk header tabel) | mana saja — label sekunder, keterangan, waktu |

⛔ **`--t-metric` DIHAPUS, bukan diarahkan ulang atau dipertahankan sebagai alias.** `StatCard` bundle masih merender kartu KPI lewat kelas `t-title-lg`; yang diikat sekarang bukan `--t-metric` melainkan LANGSUNG `var(--text-display)`, lewat selektor `.stat .t-title-lg { font-size: var(--text-display); }` di `packages/ds/lumi.css`. Selektor tetap `.stat .t-title-lg`, bukan `.t-title-lg` telanjang — kelas itu yang menegakkan batasnya, dan layar kasir tidak memakai `.stat` sama sekali.

⛔ **Dua token orphan (`--text-hero` 40, `--text-heading` 28) TIDAK berubah oleh kampanye ini** dan tetap dilarang. Keduanya hidup di `ds-bundle/tokens/typography.css` — vendor, tidak dapat disunting — dan `--text-title-lg` (24px di bundle) tidak lagi punya jalan ke layar sama sekali di luar `.stat`, karena pengikatnya kini `var(--text-display)`, bukan nilainya sendiri.

**Penegakannya di tiga tempat, dan pembagiannya bukan selera:**

- `packages/ds/lumi.css` mengikat `.stat .t-title-lg` ke `var(--text-display)` — tidak ada lagi definisi `--t-metric` di berkas mana pun. Ketiga token inti lain (`--text-display`, `--text-title`, `--text-body`) **sengaja tidak** didefinisikan ulang di sini — nilainya menang lewat urutan `@import` token mockup, dan menyalinnya menciptakan tempat kedua yang memutuskan ukuran teks.
- `tools/oxlint-plugins/ds-adherence.mjs` menolak `t-hero`, `t-heading`, dan `t-title-lg` yang **ditulis sendiri** di `apps/` dan `packages/`. Larangannya LOKAL, bukan di `_adherence.oxlintrc.json` — berkas itu ada di `ds-bundle/`.
- `tests/runtime/token-css-ada.test.js` menutup separuh yang lint tidak dapat lihat — **oxlint tidak membaca berkas CSS sama sekali** — dan juga menolak `--t-metric` bila muncul lagi di `lumi.css` atau di mana pun. `tests/kasir-dom/skala-teks.test.js` mengukur di peramban bahwa hanya `32px/20px/15px/13px` yang benar-benar dirender di seluruh layar galeri.

### ⛔ Aturan memakai `/ds-bundle` — dan ia BUKAN "pakai saja komponen bundle"

Inventaris lengkap: `docs/verifikasi/BUNDLE.md` (**tujuh dari 19 komponen belum pernah dirender sekali pun — TERVERIFIKASI 2 September 2026**; angkanya berubah setiap kali komponen baru dipakai, jadi perlakukan sebagai potret bertanggal, bukan konstanta). Aturannya tiga baris, dan baris ketiga yang menyelamatkan uang:

| Yang dipakai | Aturan |
|---|---|
| **Kelas CSS** bundle | bebas, selalu — kelas tidak menghitung apa pun |
| **Komponen React** bundle | bebas, di mana pun ia **tidak menyentuh angka uang** |
| Komponen yang **menyentuh uang** | ⛔ pakai **KELAS**-nya di atas markup kita, yang memformat lewat `packages/domain/src/uang-tampilan.ts` |

⛔ **Dua komponen ada di baris ketiga, dan keduanya justru yang paling menggoda dipakai di layar kasir:**

| Komponen | Apa yang ia lakukan pada uang |
|---|---|
| `CartRow` | `unitPrice * qty` — **perkalian float di jalur uang** |
| `ProductCard` | `'Rp ' + n.toLocaleString('id-ID')` — pemformat sendiri, **tanpa `−` untuk negatif** |

Keduanya dirancang untuk basis kode yang memakai `number` untuk uang. Repo ini `bigint` rupiah utuh (§ Konvensi data), dan pemformatnya **satu**.

**Penegakannya membuat kesalahannya mustahil, bukan sekadar terdeteksi:** `packages/ds/index.ts` **tidak mengekspor keduanya**, dan itu disengaja — yang tidak dapat diimpor tidak dapat dipakai keliru. `tests/runtime/komponen-bundle-uang.test.js` menjaga agar ekspor itu tidak dikembalikan oleh orang yang membaca ketiadaannya sebagai kelalaian, dan test ketiganya membuktikan larangan itu **berhenti pada dua nama** — penjaga yang melarang seluruh bundle akan dimatikan, dan yang mematikannya benar.

⛔ **`CartRow` tetap layak DICONTEK pada satu hal, dan sudah dicontek:** qty turun ke 0 memanggil `onRemove`. Itu meniadakan tombol "Hapus" terpisah — sekaligus meniadakan risiko salah tekan, bukan dengan menjauhkan tombolnya melainkan dengan menghapusnya.

### ⛔ Pemformat rupiah: SATU, dan penjaganya melarang yang kesembilan

`packages/domain/src/uang-tampilan.ts` adalah satu-satunya. 38 berkas mengimpornya (TERVERIFIKASI 28 September 2026); ia menangani `bigint`, `number`, `string` (endpoint laporan mengirim uang sebagai string justru untuk menjaga presisi di atas 2⁵³), nilai negatif (`−`, U+2212), dan nilai **hilang** (`Rp —`, yang **tidak sama** dengan `Rp 0`). Salinan baru menyimpang tepat di ketiga tepian itu — dan ketiganya adalah yang paling perlu dibaca benar.

Salinan terakhir dihapus 2 September 2026: `apps/backoffice/src/langganan/upgrade.ts` — B-29, satu-satunya layar yang angkanya berakhir di tagihan yang merchant bayar.

⛔ **Satu pengecualian, dan ia bukan salinan melainkan format LAIN:** `apps/kasir/src/cetak/dokumen.ts` mencetak `50.000`, bukan `Rp 50.000` (`spec-c:378`). Struk 58 mm hanya 32 kolom; awalan `Rp` di setiap baris memakan tiga karakter dari nama produk, dan nama produk yang terpotong membuat struk tidak dapat dicocokkan dengan pesanan.

Dijaga `tests/runtime/pemformat-uang-tunggal.test.js`: deklarasi `rupiah`/`uang`/`formatRupiah`/`formatUang` di luar kedua berkas itu, dan string `Rp` yang **dirakit** (`` `Rp ${x}` ``, `'Rp ' + x`). Literal `'Rp 20.000'` di kalimat sengaja **tidak** ditandai — ia teks, bukan pemformat.

Format Indonesia: `Rp 1.847.000` (titik ribuan, tanpa desimal) · `− Rp 8.000` · `11%` · `14:32` · `26 Jul 2026` · `2×`

---

## ⛔ Jangan bangun ini

Coding agent cenderung "membantu" dengan membangun hal yang tidak diminta. Daftar lengkap beserta alasan ada di `product/PRD-lumi-pos-v1.md` § 4.

**Ditunda ke v1.1+:** KDS · table management · berbagi order antar device saat offline · paket on-premise · UI vertikal retail · resep/BOM · purchasing · loyalty · promo lanjutan · transfer stok antar outlet · integrasi GoFood/GrabFood/ShopeeFood · integrasi EDC (ECR) · timbangan · customer display · mobile native · integrasi API Coretax.

**Tidak akan pernah dibangun:** pemrosesan data kartu di dalam POS · pembayaran QRIS saat offline (mustahil secara teknis) · **pencegahan** oversell saat offline (konsekuensi CAP — yang dibangun adalah deteksi & pelaporan) · dukungan Firefox untuk aplikasi kasir (OPFS).

---

## Definition of Done — fitur yang menyentuh uang

- [ ] Invariant finansial diuji sebagai **property**, bukan hanya contoh
- [ ] Perilaku offline didefinisikan dan diuji, termasuk perangkat mati di tengah operasi
- [ ] Idempotensi diuji dengan retry berulang **dan respons yang hilang**
- [ ] Isolasi tenant diuji
- [ ] Audit event dipancarkan dengan aktor, penyetuju, dan alasan
- [ ] Migrasi mengikuti expand-contract dengan `lock_timeout`
- [ ] Kompatibilitas dengan klien versi N-1 diverifikasi
- [ ] Perilaku saat kuota terlampaui didefinisikan — **dan tidak menghentikan penjualan**
- [ ] Metrik dan alarm ditambahkan
- [ ] Empty state dan error state ada
- [ ] Entri runbook dibuat bila fitur bisa gagal dengan cara yang terlihat merchant

---

## Peta dokumen — urutan baca

**Mulai di sini:**
1. `product/PRD-lumi-pos-v1.md` — problem, goals, non-goals, 77 FR
2. `product/ARCH-lumi-pos-v1.md` — batas modul, port, deployment
3. `product/ERD-lumi-pos-v1.md` — skema, RLS, index
4. `product/IA-lumi-pos-v1.md` — 52 layar, offline vs online-only

**Saat mengerjakan modul tertentu** — `product/specs/spec-{a…h}-*.md`, 414 acceptance criteria:

| Modul | File |
|---|---|
| A Katalog · B Kasir & Order · C Pembayaran & Pajak · D Kas & Shift | `spec-a…d` |
| E Inventori · F Identitas/RBAC/Audit · G Laporan · H Sinkronisasi | `spec-e…h` |

**Saat butuh alasan di balik keputusan** — `research/` (15 dokumen, 39 keputusan KEP-01…KEP-39). Mulai dari `research/00-EXECUTIVE-BRIEF.md`.

**Keputusan yang sudah diambil** — `research/13-DECISION-LOG.md` (OQ-01…OQ-06).

**Hasil pengukuran** — `prototypes/*/FINDINGS.md`. Angka di sini **mengalahkan** estimasi di dokumen lain.

Urutan fase F0→F6 ada di `product/ARCH-lumi-pos-v1.md` § 14. Estimasi v1: ±18–24 minggu penuh waktu.

## Peta jalur kode → dokumen keputusan

Supaya mengikuti rujukan bersifat mekanis, bukan penilaian:

| Jalur kode | Dokumen keputusan |
|---|---|
| `apps/server/src/modules/ordering/**`, `payment/**`, `cash/**` | `docs/keputusan/uang-pembayaran-kas.md` |
| `apps/server/src/modules/catalog/**` | `docs/keputusan/uang-pembayaran-kas.md` (harga/katalog), `docs/keputusan/database.md` (FK lintas-tenant) |
| `apps/server/src/modules/reporting/**`, `identity/**`, `tenancy/**` | `docs/keputusan/backoffice-hp-laporan.md` |
| `apps/server/src/modules/sync/**` (idempotency, outbox, token perangkat) | `docs/keputusan/uang-pembayaran-kas.md` (idempotency, ordering) + `docs/keputusan/kasir-offline-sync.md` |
| `apps/server/src/modules/peripheral/**` | `docs/keputusan/backoffice-hp-laporan.md` (`peripheral_configured`) + `docs/keputusan/cetak.md` |
| `apps/server/src/modules/rilis/**` (flag/rollout) | `docs/keputusan/rilis-dan-flag.md` |
| `apps/server/src/tenant-context.ts`, `konteks-permintaan.ts`, `sesi.ts` | `docs/keputusan/backoffice-hp-laporan.md` (support, sesi) + `docs/keputusan/database.md` (RLS/FK) |
| `apps/server/src/modules/audit/**`, `inventory/**` | `docs/keputusan/backoffice-hp-laporan.md` (audit), `docs/keputusan/uang-pembayaran-kas.md` (stok F3) |
| `apps/kasir/src/kas/**`, `kasir/**` (keranjang, diskon, pembayaran), `layar/**` (termasuk `Pembayaran.tsx` K-06/K-07), `riwayat/**`, `katalog/**`, `inventori/**` | `docs/keputusan/uang-pembayaran-kas.md` + `docs/keputusan/design-system.md` (tampilan, gambar produk) |
| `apps/kasir/src/fitur/**` | `docs/keputusan/rilis-dan-flag.md` |
| `apps/kasir/src/identitas/**`, `perangkat/**` | `docs/keputusan/kasir-offline-sync.md` (token perangkat, FR-F12) + `docs/keputusan/cetak.md` (profil printer) |
| `apps/kasir/src/lokal/**`, `apps/kasir/src/sync/**`, skema raw table, `db/local/**` | `docs/keputusan/kasir-offline-sync.md` |
| `apps/kasir/src/cetak/**` | `docs/keputusan/cetak.md` |
| `apps/kasir/src/telemetri/**` | `docs/keputusan/kasir-offline-sync.md` |
| `apps/backoffice/src/**` | `docs/keputusan/backoffice-hp-laporan.md` |
| `apps/hp/src/**` | `docs/keputusan/backoffice-hp-laporan.md` |
| `packages/domain/src/buku-kas.ts`, `kas-manual.ts`, `pembayaran-campuran.ts`, `pembayaran-manual.ts`, `pilihan-refund.ts`, `mdr.ts`, `numeric.ts`, `money.ts`, `tax.ts`, `diskon.ts`, `alokasi.ts`, `posisi-penjualan.ts`, `modifier-pilihan.ts`, `uang-tampilan.ts`, `metode-tampilan.ts` | `docs/keputusan/uang-pembayaran-kas.md` |
| `packages/klien-api/**` | `docs/keputusan/backoffice-hp-laporan.md` (§ G2, sesi bersama) |
| `packages/domain/src/rilis.ts`, `fitur.ts` | `docs/keputusan/rilis-dan-flag.md` |
| `packages/domain/src/audit-peristiwa.ts`, `ambang.ts` | `docs/keputusan/backoffice-hp-laporan.md` |
| `packages/ds/**`, `**/*.css` (kecuali `ds-bundle/`) | `docs/keputusan/design-system.md` |
| `db/migrations/**` | modul yang tabelnya disentuh (lihat baris di atas) + `docs/keputusan/database.md` untuk FK/RLS |
| `prototypes/05-powersync-jalur-turun/powersync/sync-config.yaml` (sync rules) | `docs/keputusan/kasir-offline-sync.md` |
| `tools/kill-switch.mjs`, `tools/naikkan-tahap.mjs` | `docs/keputusan/rilis-dan-flag.md` |
| `tools/siapkan-dev.sh`, `tools/kunci-kampanye.mjs` | bagian § Container baru / § Protokol otonom di `CLAUDE.md` ini |

---

## Open question yang masih terbuka

Jangan menebak jawabannya — tanyakan atau catat sebagai asumsi bertanda.

| # | Pertanyaan | Memblokir |
|---|---|---|
| OQ-14 | Prototipe Tauri Android — printer Bluetooth + scanner HID | Rencana mobile |

### ⛔ "Nol baris, bukan error" — kelas kegagalan, bukan insiden

Lima kejadian dalam satu minggu, mekanismenya identik: sesuatu gagal dan yang muncul adalah **kekosongan yang terlihat sah**, bukan galat. Katalog kosong, antrean sehat, daftar exception bersih — nol adalah jawaban SAH untuk ketiga pertanyaan itu, jadi tidak ada assertion wajar yang menolaknya.

Daftar lengkap beserta mekanisme dan penjaganya: `docs/verifikasi/KELAS-GAGAL.md`. Survei kandidat berikutnya ada di sana juga — **angkanya batas atas populasi yang perlu dipilah, bukan jumlah cacat.**

---

**Sudah diputuskan 25 Agustus 2026 — FR-F5:** `cost` **TIDAK** turun ke perangkat (data leak prevention untuk margin modal owner); server men-snapshot-nya ke `order_line.cost_at_sale` saat order masuk. Jangan tanyakan ulang.

**Sudah diputuskan 1 Agustus 2026 — jangan tanyakan ulang, jangan perlakukan sebagai asumsi:**

| # | Keputusan |
|---|---|
| OQ-09 | `VerticalProfile` **per outlet, mewarisi default tenant**. Pusat menetapkan standar, cabang boleh override. `vertical_profile.is_tenant_default` + partial unique index (`db/migrations/0015`); resolusi = `COALESCE(profil_outlet, profil_default_tenant)` |
| OQ-08 | **Batas kredensial offline: 30 hari** (keputusan 7 Agustus 2026, memakai kompromi `research/12` § OQ-08). Perangkat yang melewati batas tetap dapat **menyelesaikan transaksi berjalan dan menutup shift**, tapi **tidak dapat membuka shift baru** sampai terhubung. Angkanya belum divalidasi ke merchant. `research/12` dan `research/13` belum disamakan — itu penyuntingan dokumen riset, bukan kewenangan agent |
| OQ-15 | QRIS statis **dan** dinamis sama-sama didukung. Dinamis lewat API Midtrans + webhook (online-only); statis lewat QR cetak merchant + konfirmasi manual (**berfungsi offline**, wajib disertai kontrol anti-fraud di `spec-c`) |
| — | Ambang otorisasi: diskon >20% atau >Rp50.000 · selisih kas >Rp20.000 · no-sale wajib alasan, PIN di atas 3×/shift · refund PIN manajer (tidak dapat diubah) · **void TANPA PIN manajer** — cukup alasan daftar tertutup + audit + restock otomatis. Baris void adalah **override eksplisit** terhadap `research/08` §3; konsekuensinya laporan exception FR-G5 naik jadi wajib. Angkanya `[ASUMSI]`, belum divalidasi ke merchant |
| — | ~~MFA wajib Owner v1 atau v1.1?~~ → **v1.1** (keputusan user 24 Agustus 2026). Alasannya dinyatakan: fokus v1 tidak dipecah dari alur utama operasional kasir dan sistem kas | — |
| OQ-04/05 | Kewajiban fiskal & pajak dine-in vs takeaway | **Merchant berbayar pertama**, bukan kode |

Daftar lengkap: `research/12-OPEN-QUESTIONS.md`.

---

## Cara kerja yang diharapkan

- **Baca spec modul sebelum menulis kode modul itu.** Acceptance criteria di sana adalah kontrak.
- **Jangan memperluas scope.** Kalau sesuatu terasa perlu tapi ada di daftar "jangan bangun", angkat sebagai pertanyaan, jangan bangun.
- **Angka hasil pengukuran mengalahkan estimasi.** Kalau `prototypes/*/FINDINGS.md` bertentangan dengan dokumen lain, FINDINGS yang benar.
- ⛔ **Saat dua representasi sama-sama benar, PILIH YANG DAPAT DIUJI DI CI** — bukan yang menuntut infrastruktur penuh untuk membuktikan dirinya.

  Ini bukan catatan tentang gambar; ia yang paling kuat di antara alasan pencabutan `bytea` dan berlaku jauh di luarnya. Versi `bytea` hanya dapat dibuktikan dengan menjalankan PostgreSQL + PowerSync sungguhan — dan di repo ini itu berarti **tidak pernah dibuktikan sama sekali** (`docs/keputusan/database.md` § Docker, diukur 2 September 2026, belum diukur ulang). Versi base64 dibuktikan `node --test` di atas SQLite yang sudah ada di setiap run: byte per byte, termasuk `0x00`, `0xFF`, dan urutan bukan-UTF-8.

  Yang menentukan bukan seberapa aman jalurnya di atas kertas, melainkan **seberapa sering kebenarannya diperiksa ulang**. Jalur yang lebih aman tetapi hanya dapat diuji di lingkungan yang tidak ada berhenti diperiksa setelah hari ia ditulis, dan sejak itu ia dipercaya berdasarkan ingatan. Representasi yang sedikit lebih mahal tetapi diperiksa pada setiap commit menang atas keduanya.

  Ia juga menjelaskan kenapa `KOLOM_BELUM_DIUKUR` boleh ada: kolom yang tipenya menyimpang dan tidak dapat diuji di sini **dinyatakan belum diukur**, bukan dianggap benar.
- **Tandai asumsi.** Pakai `[ASUMSI]` seperti di dokumen riset, jangan selundupkan sebagai fakta.
- **Lapisan sync ditulis dengan waktu, keacakan, dan I/O di-inject** sebagai dependensi — prasyarat DST, dan retrofitnya mahal. Harness referensi ada di `prototypes/02-dst-sinkronisasi/sim.py`.
- ⛔ **Penjaga dulu, merah dulu.** Untuk setiap perubahan perilaku atau tata letak, tulis penjaganya lebih dulu dan buktikan ia MERAH terhadap kode lama, baru perbaiki.
- ⛔ **Sabotase setiap penjaga baru.** Kembalikan perubahannya dan pastikan penjaga merah **karena alasan yang benar** — pesannya menyebut hal yang dijaga, bukan timeout atau selektor yang hilang. Penjaga yang tidak menyala itu hampa: perbaiki penjaganya dan catat.
- ⛔ **Ukur, jangan baca.** Klaim tata letak dibuktikan lewat pengukuran DOM (`getBoundingClientRect`, `getComputedStyle`), bukan lewat membaca CSS. Baris CSS yang ada belum tentu berlaku.
- ⛔ **Penjaga invarian yang merah adalah pelanggaran**, bukan test yang perlu disesuaikan.
- **Satu PR per pekerjaan**, branch baru dari `main` terbaru. **Push setiap commit begitu jadi.** Merge dengan **merge commit**, bukan squash.
- **Suite yang menyentuh PostgreSQL dijalankan berurutan**, satu proses — nol konkurensi.
- **Pengawasan PR: laporkan, jangan perbaiki sendiri** di luar yang diminta. Merah kadang informasi.
- **Container baru:** `bash tools/siapkan-dev.sh` sebelum apa pun (§ Stack).

## Irit (sejak 27 September 2026)

Hemat dengan memampatkan struktur dan lalu lintas input-output, **bukan bahasa**. Fakta, bukti, dan angka tidak pernah dipotong. Anggaran token dipakai untuk kode, bukan narasi.

**Menunggu**
- Jangan polling CI atau proses dengan pesan berulang. Andalkan event CI yang membangunkan session.
- Kalau harus menunggu: satu kali tunggu dengan batas waktu, tanpa pesan antara. Tidak ada pesan "menunggu", "masih berjalan", atau "bot Vercel, tanpa tindakan".

**Membaca**
- Baca rentang atau hasil `rg -n`, bukan berkas utuh, kecuali memang butuh seluruhnya.
- Jangan baca ulang berkas yang sudah ada di konteks dan tidak berubah.
- Diff: `--stat` atau `--name-only` dulu; isi penuh hanya untuk berkas yang relevan.
- Jangan membuka tangkapan layar kecuali memang harus dinilai.

**Menjalankan**
- Selama iterasi: hanya suite yang relevan. Seluruh suite berurutan tetap wajib sekali di akhir task.
- Keluaran test disaring: baris gagal dan ringkasan saja. Log CI diambil bagian yang gagal, tidak seluruhnya.

**Menulis ke user**
- Tanpa narasi langkah ("sekarang aku…", "berikutnya…"). Mulai dari hasil.
- Tidak mengulang yang sudah dilaporkan.
- Laporan task memakai templat tetap, ringkas tapi lengkap:

      Task N — judul
      Status: DONE | DONE_WITH_CONCERNS | BLOCKED
      Commit: <sha>
      Penjaga: <nama> — merah dulu: <pesan singkat>
      Sabotase: <yang disabotase> → <penjaga> merah: "<pesan>"
      Suite: <nama n/n, …>
      Temuan: <kalau ada>

- ⛔ Bukti sabotase, penjaga yang tidak menyala, koreksi atas laporan sendiri, dan temuan **selalu ditulis utuh**. Reviewer menilai dari situ.

**Menulis kode**
- Komentar menjelaskan *kenapa*, paling banyak tiga baris. Alasan yang lebih panjang tinggal di dokumen, dirujuk dari komentar.
- Pesan commit: satu baris subjek dan paling banyak tiga baris alasan.

## Workflow Superpowers (sejak 26 September 2026)

Berlaku untuk kampanye "Hidupkan desain LumiPOS" dan seluruh pekerjaan sesudahnya. **`CLAUDE.md` menang atas skill** — skill `using-superpowers` sendiri menyatakan instruksi pengguna di `CLAUDE.md` didahulukan. Bila skill dan bagian ini berbeda, bagian ini yang berlaku.

### ⛔ Awal setiap session: muat `using-superpowers`

Skill Superpowers v6.4.2 adalah **salinan vendor** di `.claude/skills/` (`.claude/skills/SUPERPOWERS-VENDOR.md`). Plugin aslinya punya hook `SessionStart` yang menyuntikkan `using-superpowers` ke setiap session; **salinan tidak membawa hook itu, dan bagian ini menggantikannya.**

1. Di awal setiap session — termasuk sesudah pergantian container dan sesudah konteks dipadatkan — muat skill `using-superpowers` lewat Skill tool, sebelum pekerjaan apa pun.
2. Lalu baca `docs/RENCANA-HIDUPKAN-DESAIN.md` dan `git log`, dan lanjutkan alur sub-proyek di bawah dari task terakhir yang tercatat.

⛔ **Nama skill tanpa awalan.** Skill proyek dimuat dengan nama direktorinya: `using-superpowers`, `brainstorming`, `writing-plans`, `subagent-driven-development`, `requesting-code-review`, `test-driven-development`, `verification-before-completion`, `finishing-a-development-branch`, `using-git-worktrees`, dan seterusnya. Teks di dalam `SKILL.md` masih menulis `superpowers:<nama>`; itu berarti skill `<nama>` di `.claude/skills/`. Jangan menyunting salinan vendor untuk menyamakannya.

### Alur per sub-proyek

1. **Brainstorming → spec** di `docs/superpowers/specs/`. Keputusan arah yang sudah diambil user tidak ditanyakan ulang satu per satu: sajikan rancangan utuh sekali untuk disetujui, dan tanyakan hanya yang benar-benar belum diputuskan.
2. **Writing-plans → plan** di `docs/superpowers/plans/`. Bagian **Global Constraints** memuat invarian yang tetap berlaku dan keputusan kampanye, **disalin kata demi kata** dari sumbernya. ⛔ **Setiap task di plan mencantumkan berkas `docs/keputusan/*.md` mana yang wajib dibaca implementernya** (lihat § Peta jalur kode → dokumen keputusan di atas) — task yang menyentuh uang/kas/sync tanpa daftar itu tidak lengkap.
3. **Tinjauan plan pra-eksekusi.** Semua pertanyaan dikumpulkan jadi **satu kiriman** ke user, sebelum Task 1.
4. **Eksekusi SDD** (`subagent-driven-development`). Satu implementer per task, **berurutan, tidak pernah paralel** — skill-nya melarang, dan suite PostgreSQL repo ini tidak boleh berjalan bersamaan. ⛔ **Task brief setiap implementer memuat daftar `docs/keputusan/*.md` dari plan-nya**, disalin apa adanya — bukan ditinggalkan sebagai rujukan yang harus dicari sendiri.
5. **Tinjauan per task** oleh reviewer SDD: kepatuhan spec + kualitas.
6. **Tinjauan akhir satu branch** oleh model paling mampu (Opus 5.5).
7. **Selesai:** push, buka PR, merge dengan **merge commit** bila CI hijau dan tinjauan akhir bersih. **Jangan tampilkan menu empat pilihan `finishing-a-development-branch`** — pilihannya sudah ditetapkan di sini, kecuali ada gerbang visual.

Worktree: **tidak dipakai.** Session cloud sudah terisolasi; kerjakan di branch baru dari `main` terbaru, tanpa `git worktree add` (keputusan user 26 September 2026).

### Model — hanya dua

Selalu sebutkan model **secara eksplisit** saat mengirim subagen. Fable dan Haiku **tidak dipakai sama sekali**.

| Peran | Model |
|---|---|
| Brainstorming spec | **Opus 5.5** (`opus`) |
| Penulisan plan | **Opus 5.5** |
| Tinjauan akhir satu branch | **Opus 5.5** |
| Reviewer per task di jalur **uang, kas, dan sync** | **Opus 5.5** |
| Subagen sabotase independen | **Opus 5.5** |
| **Semua implementer**, termasuk task yang kodenya sudah lengkap di plan | **Sonnet 5.5** (`sonnet`) |
| Reviewer per task di luar jalur uang, kas, dan sync | **Sonnet 5.5** |

⛔ Skill SDD menyebut model termurah untuk implementer yang kodenya lengkap. Di repo ini **batas bawahnya Sonnet 5.5** — tidak ada peran yang turun di bawahnya (keputusan user 29 September 2026, issue #76 komentar 5883887477; sebelumnya Sonnet 5).

⛔ **Alias `sonnet` diverifikasi, bukan dipercaya.** Agent tool hanya menerima alias; pada 29 September 2026 `sonnet` terukur mengarah ke `claude-sonnet-5-5` (medan `model` di transkrip subagen). Controller memeriksa medan itu sesudah setiap pengiriman — bila bukan `claude-sonnet-5-5`, hentikan dan laporkan. Definisi agen di `.claude/agents/` yang memaku ID penuh tidak termuat di tengah session, jadi tidak dipakai sebagai pemaku.

### Penjaga dan sabotase dalam SDD

Aturan repo tetap berlaku: penjaga merah dulu, sabotase setiap penjaga, ukur jangan baca.

- **Implementer** menulis penjaga, membuktikannya merah terhadap kode lama, menerapkan, lalu menyabotase. Bukti sabotase ditulis di laporan task: apa yang disabotase, penjaga mana yang merah, dan pesannya.
- **Reviewer SDD bersifat baca-saja** dan tidak menyabotase. Ia memeriksa bukti sabotase di laporan dan menandai penjaga yang dicurigai hampa: mengukur elemen yang salah, memaku nilai sebagai angka tetap, atau kondisinya dipenuhi oleh test-nya sendiri.
- **Subagen sabotase independen** (Opus 5.5) dikirim hanya untuk penjaga di jalur uang, kas, sync, dan invarian kampanye. Ia tidak melihat sabotase implementer, menulis sabotasenya sendiri, lalu memulihkan pohon kerja. Ia berjalan **sesudah** implementer selesai, tidak bersamaan.

### ⛔ Protokol otonom — `docs/PROTOKOL-OTONOM.md`

Sejak 26 September 2026 kampanye berjalan sendiri lewat routine terjadwal. Protokolnya mengatur:

- tiga kelas keputusan: kerjakan · putuskan dan catat · berhenti dan tanya;
- titik sentuh manual;
- saluran kabar: issue berlabel `butuh-dimas`. ⛔ Instruksi hanya dari akun `zethasaintlab`;
- kunci satu pelari: `node tools/kunci-kampanye.mjs ambil <pemilik>` **sebelum** menyentuh branch kampanye, `segarkan` paling lama setiap 30 menit, `pastikan` sebelum **setiap push** (selain kode 0: berhenti tanpa push), dan `lepas` sesudahnya;
- izin di `.claude/settings.json`.

Fitur yang hanya dapat dibuktikan di perangkat nyata dicatat di `docs/BELUM-TERUJI-PERANGKAT.md`. Ia bukan gerbang merge.

### Ledger tahan pergantian container

Ledger SDD di `.superpowers/sdd/progress.md` di-ignore git dan hilang saat container berganti. Setiap kali satu task selesai, **cerminkan barisnya ke `docs/RENCANA-HIDUPKAN-DESAIN.md`**, commit, dan push. Saat session dimulai atau sesudah pergantian container, **percayai berkas yang di-commit dan `git log`, bukan ingatan.**

### Gerbang visual

Hanya user yang dapat melihat tampilan aplikasi. Setiap PR yang mengubah tampilan menyertakan **link preview Vercel per layar yang berubah**. Sub-proyek 1 (fondasi desain) **tidak di-merge sebelum user menyetujui preview-nya**; sub-proyek lain di-merge saat hijau, dan user meninjau sesudahnya.

## Rebuild UI kasir — urutan otoritas (sejak 25 September 2026)

Kampanye membangun ulang tampilan `apps/kasir` supaya terlihat seperti aplikasi POS pada umumnya. Pelacak kemajuannya `docs/RENCANA-REBUILD-UI.md` — **baca itu dulu** bila melanjutkan kampanye di container baru.

**Urutan otoritas saat sumber bertentangan:**

1. **Spec dan test** — perilaku yang memindahkan uang, mengontrol kas, atau menyinkronkan data.
2. **Mockup** `docs/referensi-visual/sumber/design-explorer.html` — seluruh TAMPILAN: nilai (palet, aksen, font, skala, radius, bayangan, spasi) dan tata letak. Selisih per layar terukur di `docs/referensi-visual/BANDING.md`.
3. **Token di kode** — `packages/ds/tokens-mockup.css` dan `packages/ds/lumi.css`, didokumentasikan di `docs/DESIGN.md`. Ia MENYALIN nilai mockup, tidak lagi memutuskannya; token yang berbeda dari mockup adalah penyimpangan yang harus tercatat (hari ini dua, koreksi AA: `--sidebar-label` dan `--step-inactive-text`).

Urutan ini digantikan oleh keputusan kampanye Hidupkan desain, 26 September 2026 (`docs/RENCANA-HIDUPKAN-DESAIN.md`). Sebelumnya token di kode menang atas mockup untuk nilai, dan mockup hanya menentukan tata letak.

⛔ **Saat mockup bertabrakan dengan 1 atau 2: jangan pilih diam-diam.** Tolak elemen itu, catat di laporan, lanjutkan sisanya. Daftar yang sudah ditolak ada di `docs/referensi-visual/README.md` — jangan diterapkan.

**Invarian yang tidak boleh tersentuh.** Penjaganya disebut; yang belum punya penjaga dinyatakan, bukan diandaikan:

| Invarian | Penjaga |
|---|---|
| Hitungan buta K-12: rincian saldo hanya di tahap `review` | `tests/kasir-dom/k12-hitungan-buta.test.js` |
| QRIS mengganti layar penuh saat panelnya aktif | `k06-penjaga.test.js` P1 |
| Pembulatan FR-C9 hanya di `simpanPenjualan`, hanya tampil di K-07 | `k06-penjaga.test.js` P2 + `tests/kasir/penjualan.test.js` |
| Target sentuh ≥ 44px; aksi utama kasir 56px | sebagian: `k03-chrome`, `k06-penjaga`, `k12-aksi-slot`. **Belum ada penjaga umum lintas layar** |
| K-03: ≥ 12 kartu tanpa scroll pada 1024×768 | `k03-chrome.test.js` (IA:62) |
| K-03: Bayar di posisi sama untuk 0, 3, 20 item | `k03-bayar-tetap.test.js` |
| K-14: tabel item gagal ≥ 3 baris utuh | `k14-tata-letak.test.js` |
| Tinggi bilah nav sama di semua layar | `k14-tata-letak.test.js` |
| `ds-bundle/` tidak disunting | `tests/runtime/ds-bundle-vendor.test.js` |
| Palet ikuti nilai mockup, bukan diketik ulang di kode | `tests/runtime/token-mockup.test.js` (nilai token di berkas) + `tests/kasir-dom/palet-berlaku.test.js` (nilai yang sungguh dirender di peramban, kedua viewport). Menggantikan baris lama "Aksen `#0D5C63` tidak berubah" — keputusan kampanye Hidupkan desain, 26 September 2026 (`docs/RENCANA-HIDUPKAN-DESAIN.md`), lahir Fase 1 Task 1–2 |
| Nol hex hardcoded di komponen | `tests/runtime/nol-hex-css.test.js` — memindai `apps/*/src/**/*.css` dan `packages/ds/*.css` (kecuali `lumi.css`/`tokens-mockup.css`, yang justru mendefinisikan token dengan nilai literal). Sebelumnya "belum ada penjaga untuk CSS"; penjaga lahir kampanye Hidupkan desain, Task 2, 26 September 2026 |
