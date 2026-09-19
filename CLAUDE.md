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

1. Tepat **4 ukuran teks inti**: 32/20/15/12, bebas dipakai di mana saja. KDS membesar lewat `--scale`, bukan token baru. Satu token **khusus** (`--t-metric`) ada di luar keempatnya, dan hanya sah di konteks yang disebut namanya — lihat § Skala teks final.
2. Satu aksen teal `#0D5C63`, < 5% area, **satu aksi utama per layar**.
3. Target sentuh ≥ **44px**; aksi menyangkut uang **56px**.
4. Angka uang selalu `tabular-nums` (kelas `.num`).
5. Status **tidak pernah warna saja** — selalu ada teks.
6. Semua styling lewat token; **tidak ada nilai warna/ukuran hardcoded** di komponen.
7. Bahasa Indonesia. Setiap komponen punya keadaan **kosong** dan **error**.
8. Tanpa emoji, tanpa dark mode. **Gradien dan tekstur DIIZINKAN sejak 1 September 2026; GAMBAR PRODUK diizinkan sejak 1 September 2026** — lihat § Pelonggaran DS #8 dan § Gambar produk.
9. Tanpa onboarding in-app, tanpa wizard, tanpa tooltip.

`_adherence.oxlintrc.json` dari `/ds-bundle` **wajib masuk CI sejak commit pertama**.

⛔ **`ds-bundle/` adalah artefak VENDOR dan tidak pernah disunting langsung** (keputusan user, 31 Agustus 2026). Seluruh perubahan lewat override di `packages/ds`. Suntingan di tempat hilang tanpa jejak pada pembaruan bundle berikutnya, dan yang hilang adalah perbaikan aksesibilitas. Dijaga `tests/runtime/ds-bundle-vendor.test.js`. **Tidak boleh disentuh sama sekali:** logo, nama "Lumi POS", aksen teal `#0D5C63`.

### Skala teks final — LIMA token, dipetakan dari tujuh milik bundle

Keputusan user 31 Agustus 2026 ("Opsi A"). Rencananya enam; yang bertahan **lima**, karena token khusus kedua (`--t-data`, nilai sel tabel padat) **tidak punya kasus pakai nyata**: `.table td` bundle memakai `--text-body`, dan tidak ada satu pun berkas CSS di `apps/` yang menyetel ukuran sel tabel. Instruksinya eksplisit — *"Jangan mengarang kebutuhan untuk mengisi slot."*

| Token bundle | px | Status di skala final | Boleh dipakai di |
|---|---|---|---|
| `--text-display` | 32 | **inti** | mana saja |
| `--text-title` | 20 | **inti** | mana saja |
| `--text-body` | 15 | **inti** | mana saja |
| `--text-caption` | 12 | **inti** | mana saja |
| `--text-title-lg` | 24 | **khusus** → `--t-metric` | HANYA angka kartu KPI dasbor B-01, lewat `<StatCard>`. Bukan labelnya. **Layar kasir: tidak sama sekali** |
| `--text-hero` | 40 | **orphan, dilarang** | — |
| `--text-heading` | 28 | **orphan, dilarang** | — |

⛔ **Yang orphan TIDAK DIHAPUS, dan itu disengaja, bukan terlewat.** Ketiganya hidup di `ds-bundle/tokens/typography.css` — vendor, tidak dapat disunting. Larangan adalah satu-satunya penegakan yang tersedia, dan baris ini ada supaya orang berikutnya tahu bedanya.

⛔ **`--t-metric` bukan token karangan.** `StatCard` bundle sudah merender nilainya pada 24px lewat kelas `t-title-lg`, dan B-01 memakai tiga di antaranya — ukuran kelima itu **sudah ada di layar sejak dasbor lahir**. Yang belum ada adalah namanya dan batas tempat ia boleh muncul. Nilainya `var(--text-title-lg)`, bukan `24px` yang diketik ulang: angka yang disalin menyimpang dari bundle diam-diam, alias tidak dapat.

**Penegakannya di tiga tempat, dan pembagiannya bukan selera:**

- `packages/ds/lumi.css` mendefinisikan `--t-metric` dan mengikat cakupannya lewat selektor `.stat .t-title-lg`. Keempat token inti **sengaja tidak** didefinisikan ulang — menyalinnya menciptakan tempat kedua yang memutuskan ukuran teks.
- `tools/oxlint-plugins/ds-adherence.mjs` menolak `t-hero`, `t-heading`, dan `t-title-lg` yang **ditulis sendiri** di `apps/` dan `packages/`. Larangannya LOKAL, bukan di `_adherence.oxlintrc.json` — berkas itu ada di `ds-bundle/`.
- `tests/runtime/token-css-ada.test.js` menutup separuh yang lint tidak dapat lihat: **oxlint tidak membaca berkas CSS sama sekali**.

### Pelonggaran DS #8 — gradien dan tekstur, 1 September 2026

Keputusan user setelah membuka galeri di HP: *"sangat flat, tidak hidup, dan sangat jauh dari kasirpintar"*. Yang dicabut dari aturan #8 **hanya gradien dan tekstur**.

**Yang TETAP berlaku, dan tidak dicabut oleh apa pun:**

- tanpa emoji · tanpa gambar · tanpa dark mode
- ⛔ **PALET tidak disentuh.** Tidak ada satu pun nilai warna baru. Setiap gradien disusun dari token yang sudah ada (`--surface`, `--surface-sunk`, `--surface-alt`, `--accent-soft`). Yang berubah **kedalaman**, bukan warnanya
- aksen teal `#0D5C63` tetap satu-satunya warna AKSI, tetap < 5% area, tetap satu aksi utama per layar

⛔ **Gradiennya sengaja nyaris tidak terlihat sebagai gradien.** Yang dicari adalah permukaan yang tidak rata sempurna — itu yang membuat mata membaca "benda" alih-alih "kotak putih". Gradien yang terlihat sebagai gradien akan bersaing dengan aksen, dan aksen adalah satu-satunya hal yang boleh menarik mata di layar kasir.

Seluruhnya di `packages/ds/lumi.css`; `ds-bundle/` tidak mengirim satu pun gradien dan tidak disentuh.

### Gambar produk — DS #8 dicabut lebih jauh, 1 September 2026

Keputusan user setelah meninjau galeri: *"Card harusnya bergambar"*. Larangan
"tanpa gambar" DICABUT. Yang tetap: tanpa emoji, tanpa dark mode, palet tidak
disentuh.

⛔ **Ini FITUR, bukan perubahan tampilan.** `item.image_url` sudah ada di skema
sejak F0 dan **tidak pernah dibaca, tidak pernah ditulis, tidak ada di sync
rules**; server tidak punya satu pun jalur unggah berkas. Seluruhnya dari nol.

**Penyimpanan: TEKS base64 di PostgreSQL, turun lewat PowerSync.**
Alternatif object storage ditolak karena dua hal: ia layanan berbayar baru, dan
gambar yang tidak ikut PowerSync menuntut mekanisme cache KEDUA supaya kartu
tidak jadi kotak kosong tepat saat internet mati — keadaan yang seluruh
arsitektur ini ada untuk mendukungnya.

### ⛔ `bytea` DICABUT 2 September 2026 — dan ia dicabut karena DIUKUR

Keputusan awal user (1 September) adalah `bytea` PostgreSQL. **User menariknya
sendiri 2 September**, setelah pengukuran, dan alasannya ditulis di sini supaya
orang berikutnya tahu ia ditolak karena diuji — bukan karena tidak terpikir.

Kalimat user, dan ia yang mengikat:

> Yang menentukan bukan base64 lebih aman, melainkan bahwa jalur salah
> menghasilkan **15 byte jadi 4 tanpa error**, dan satu-satunya pembeda rusak
> dari utuh adalah angka yang perangkat tidak punya. Base64 menghapus kelasnya.

Terukur (`docs/verifikasi/GAMBAR-ANGGARAN.md` § 5), muatan uji memuat `0x00`,
`0xFF`, dan tiga bentuk urutan bukan-UTF-8:

| Jalur | `typeof()` | `length()` | Hasil |
|---|---|---:|---|
| bind `Uint8Array` — benar | `blob` | 15 | IDENTIK |
| bind string UTF-8 — salah | `text` | **4** | **BERBEDA** |
| heks Postgres apa adanya | `text` | 33 | **BERBEDA** |

⛔ Yang membuatnya kelas "nol baris, bukan error": `length()` mengembalikan 4,
jadi pemeriksaan "ada isinya" bernilai BENAR, dan kartu tanpa gambar **tidak
dapat dibedakan** dari item yang memang belum difoto.

⛔ **Jangan mengembalikan `bytea` sebagai "optimasi ukuran".** Ongkos base64
(+33%) sudah dibayar di anggaran: batas turun 32 KB → **30 KB mentah / 40 KB
melintas**, dan **500 item = 19,5 MB** per perangkat — tetap di bawah ambang
~20 MB. Setiap 1 KB tambahan pada batas adalah ~0,65 MB per perangkat.

⛔ **`byte` + `checksum` menempel di baris yang sama**, diverifikasi perangkat
saat membaca. Base64 menghapus kerusakan BINER; ia tidak menghapus kerusakan
TRANSPORT. ~40 byte per baris untuk menukar kekosongan diam dengan keadaan
bernama: **"gambar gagal dimuat"**, yang WAJIB berbeda dari "belum punya
gambar".

⛔ **Kartu tanpa gambar BUKAN keadaan menunggu** (keputusan user). Layar kasir
harus dapat dipakai penuh selagi gambar menyusul — 19,5 MB di jaringan warung
butuh waktu, dan kasir tidak boleh menunggunya. Kartu tanpa gambar berfungsi
penuh dan tidak menampilkan penanda memuat apa pun.

- ⛔ **Tabel TERPISAH (`item_image`), bukan kolom di `item`.** Blob di `item`
  ikut terseret setiap query katalog, dan `bacaKatalog` berjalan pada setiap
  pembukaan K-03.
- ⛔ **Kompresi di KLIEN back-office, bukan di server.** Canvas API mengecilkan
  ke ~400×400 WebP sebelum unggah — nol dependensi native baru di server, dan
  CPU-nya di mesin yang tidak melayani penjualan. Server memvalidasi ukuran dan
  mime, tidak mengolah — dan **tidak pernah men-decode base64-nya**: panjang
  byte dihitung dari panjang teks (aritmetika). Makin sedikit titik tempat
  biner dan teks bertukar, makin sedikit tempat 15 byte dapat menjadi 4.
- ⛔ **Menambah raw table mengubah sidik jari skema lokal**, jadi setiap
  perangkat membangun ulang tabel rawnya (`disconnectAndClear()`). Pelajaran
  migrasi `0035` berlaku lagi — bedanya sekarang stream `riwayat` sudah ada
  sebagai jalan pulang, jadi riwayat lokal kembali sendiri.
- **Kartu tanpa gambar wajib punya bentuknya sendiri.** Merchant baru dan
  produk yang belum difoto adalah keadaan normal, bukan pengecualian.

**Unggah + render selesai 3 September 2026.** Rantainya: `GambarProduk.tsx`
(B-07, kanvas → tangga kualitas) → `PUT /items/{id}/image` → `item_image` →
PowerSync → `apps/kasir/src/katalog/gambar.ts` (verifikasi) → kartu K-03.

- ⛔ **TIGA keadaan kartu, dan yang pertama adalah KETIADAAN kunci di peta:**
  belum difoto (kartu NORMAL, nol penanda) · gagal verifikasi (keadaan bernama,
  terlihat berbeda) · utuh. Peta memakai `Map` tanpa entri untuk yang pertama —
  memetakannya ke `null` membuat "belum difoto" dan "rusak" dapat tertukar oleh
  satu pemanggil yang lupa membedakannya. `data-gambar` di kartu membawa ketiga
  nilainya, dan `tests/kasir/gambar-kartu.test.js` menolak setiap aturan CSS
  dekoratif untuk `tanpa` — placeholder abu-abu mengubah katalog merchant baru,
  yang seluruhnya belum difoto, menjadi grid yang terlihat rusak di hari
  pertama.
- ⛔ **`aspect-ratio: 16 / 9` di kartu, meski yang disimpan 1:1** — diukur, dan
  tiga rasio yang lebih tinggi gugur. `IA:62` menuntut ≥12 kartu tanpa scroll;
  1:1 → 8, 4:3 → 8, 3:2 → 8, 16:9 → 12. Penjaganya di `tools/tangkap-galeri.mjs`,
  yang MENGHITUNG kartu terlihat, bukan hanya memotretnya. Angkanya di
  `docs/verifikasi/GAMBAR-ANGGARAN.md` § 7.
- ⛔ **`height: auto` WAJIB pada `<img>` kartu.** Atribut `height="400"` adalah
  presentational hint yang menyetel `height: 400px`, dan `aspect-ratio` hanya
  berlaku bila satu dimensi `auto`. Tanpanya gambar dirender 125×400 di kartu
  151px, tinggi kartu 486px, **4** kartu muat — nol error, nol peringatan
  konsol, CSS terbaca benar. Ditemukan lewat pengukuran DOM.
- ⛔ **Kontrak OpenAPI TIDAK menyalin batasnya sebagai `maxLength`.** Ia salinan
  ketiga yang tidak dijaga apa pun, DAN ia membuat AJV menolak lebih dulu dengan
  `VALIDATION_ERROR` — sehingga `TERLALU_BESAR` beserta sarannya tidak pernah
  tercapai. `bodyLimit` bawaan Fastify menahan muatan tak masuk akal; angkanya
  diputuskan satu tempat. Dijaga `tests/domain/gambar-produk.test.js`.
- ⛔ **`byte` dan `checksum` dihitung SERVER**, dan nilai dari klien diabaikan
  sepenuhnya. Checksum kiriman klien membuat verifikasi perangkat memeriksa
  klaim klien terhadap dirinya sendiri: muatan yang rusak DI KLIEN datang dengan
  checksum yang cocok dengan kerusakannya.
- **`BATAS_BYTE` terikat anggaran lewat test.** `BATAS_BASE64 × 500 > 20 MB`
  MERAH. Sisa anggaran **2,5%**, dan maksimum yang masih muat ~40,9 KB base64
  (~30,7 KB mentah) — kurang dari satu kilobyte di atas nilai sekarang.

### ⛔ Kontrol urutan input K-12 DICABUT, 1 September 2026

Keputusan user, diambil setelah konsekuensinya dinyatakan.

`spec-d:96` berbunyi — dan menyebut dirinya sendiri sebagai kontrol:

> Kasir memasukkan hitungan fisik **sebelum** sistem menampilkan angka
> terhitung. **Ini kontrol, bukan preferensi UX** — kasir yang melihat angka
> target akan menghitung mundur ke angka itu.

Aturan itu **tidak lagi berlaku**. K-12 menampilkan saldo seharusnya sejak
tahap pertama.

⛔ **Konsekuensi yang dinyatakan, bukan disembunyikan:** selisih kas berhenti
menjadi angka yang dapat dipercaya, dan laporan exception **FR-G5 X7 (selisih
kas per kasir)** kehilangan sebagian besar artinya — ia mengukur selisih dari
hitungan yang kini dilakukan sambil melihat targetnya.

⛔ **`spec-d:96` masih berbunyi sebaliknya, dan itu disengaja.** Menyunting
dokumen spec bukan kewenangan agent (aturan yang sama dengan `research/00` dan
`research/03` yang masih menulis "Node.js 22+"). Baris ini ada supaya orang
berikutnya tahu kode dan spec sengaja berbeda di titik ini, bukan terlewat.

### ⛔ Datar BUKAN karena design system-nya austere — `apps/kasir` tidak memakainya

Diukur 1 September 2026, dan ini sebab utamanya:

| Komponen yang `/ds-bundle` kirim | Dipakai kasir sebelumnya |
|---|---|
| `.product-card` — hover & tekan jadi teal, focus ring, `data-out` untuk habis | **0×**, diganti `.kasir-kartu` buatan sendiri |
| `.chip` — `aria-pressed="true"` → latar teal penuh | **0×**, diganti `.kasir-chip` yang hanya menebalkan tepi |
| `.cart-row` · `.badge` | **0×** |
| `<Icon>` (42 ikon) | **2×** — back-office memakai **56×** |
| `--shadow-card` | **0×** — nol shadow di seluruh `kasir.css` |

Kesalahan yang sama dibuat **dua kali dalam dua jam** oleh agent yang sama: menulis `.kasir-kartu:hover` dan `.kasir-chip-aktif` sendiri tanpa memeriksa bahwa bundle sudah mengirim versi yang jauh lebih baik. **Periksa `ds-bundle/components.css` sebelum menulis satu pun kelas baru** — yang ditulis sendiri akan selalu lebih miskin daripada yang sudah dirancang, dan ia tidak menghasilkan satu pun error.

Keduanya kini MODIFIER di atas komponen bundle, bukan pengganti.

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

`packages/domain/src/uang-tampilan.ts` adalah satu-satunya. 35 berkas mengimpornya (TERVERIFIKASI 2 September 2026); ia menangani `bigint`, `number`, `string` (endpoint laporan mengirim uang sebagai string justru untuk menjaga presisi di atas 2⁵³), nilai negatif (`−`, U+2212), dan nilai **hilang** (`Rp —`, yang **tidak sama** dengan `Rp 0`). Salinan baru menyimpang tepat di ketiga tepian itu — dan ketiganya adalah yang paling perlu dibaca benar.

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

---

## Status & fase saat ini

**Fase: G2 (Owner mobile) selesai, 25 Agustus 2026.** G1 (back-office) ditutup 16 Agustus 2026. F0–F3 tertutup; F4 tertutup sejauh yang dapat dibuktikan tanpa printer. Rincian per item ada di `HANDOFF.md`.

### G2 — Owner mobile (`apps/hp`), 25 Agustus 2026

**Aplikasi KETIGA berdiri**, dan keempat layar v1 `IA:§4` ada: M-00 login ·
M-01 Ringkasan Hari Ini · M-02 Perlu Diperiksa · M-03 Laporan ringkas. M-04
(otorisasi jarak jauh) tetap v1.1 — `IA:251`.

> `IA:229` — *"Persona P3 membuka aplikasi **pukul 23:00 untuk satu
> pertanyaan**. IA-nya harus menjawab pertanyaan itu di layar pertama, bukan
> menyediakan navigasi lengkap."*

⛔ **Tiga modul PINDAH menjadi milik bersama, tidak satu pun disalin.** Aplikasi
ketiga adalah titik di mana salinan mulai menyimpang:

| Ke | Isi | Kenapa |
|---|---|---|
| `packages/klien-api` | `http.ts` · `sesi-simpanan.ts` · `sesi.tsx` | `IA:245`: kredensial M-00 SAMA dengan back-office. Dua klien sesi yang menyimpang menghasilkan aplikasi yang berhenti dari sesi yang masih hidup — atau tetap menampilkan layar dengan sesi yang sudah mati |
| `packages/domain/src/uang-tampilan.ts` | `rupiah` · `bacaRupiah` | Format uang adalah aturan produk, dan yang ditulis ulang per layar menyimpang tepat di nilai besar, negatif, dan hilang |
| `packages/domain/src/metode-tampilan.ts` | `LABEL_METODE` · `LABEL_STATUS_BAYAR` | HP merinci pembayaran per metode; dua peta yang menyimpang menyebut saluran berbeda dari back-office untuk hari yang sama |

⛔ **`apps/kasir/src/cetak/metode.ts` SENGAJA tetap terpisah** — nama di struk
dipendekkan karena struk 58 mm hanya 32 kolom, dan "QRIS (dinamis)" tidak muat.
Batasnya dinyatakan di kedua berkas.

⛔ **Utang yang dinyatakan:** `apps/kasir` masih punya **delapan** salinan
pemformat uang sendiri (`Rp ${n.toLocaleString('id-ID')}`, satu per layar). Ia
menerima `number` alih-alih `bigint` dan TIDAK menghasilkan `−` untuk negatif.

**Keputusan yang mengikat kode Owner mobile:**

- ⛔ **"Hari ini" diputuskan SERVER, bukan jam HP.** `date` di
  `GET /reports/daily-summary` OPSIONAL; dikosongkan berarti hari ini, dihitung
  dari `now()` database + zona outlet + jam tutupnya lewat `tanggalBisnis` yang
  kasir pakai. FR-F8 ada di produk ini justru karena jam perangkat berbohong
  cukup sering untuk perlu dideteksi, dan HP yang jamnya maju satu hari meminta
  ringkasan hari yang belum terjadi lalu menerima **nol transaksi tanpa satu pun
  error** — owner menyimpulkan outletnya tidak berjualan. `date` KOSONG tetap
  ditolak: string kosong berarti klien bermaksud menyebut tanggal dan gagal.
- ⛔ **Tanpa `outlet_id`, "hari ini" hanya dijawab bila SELURUH outlet aktif
  sepakat** zona waktu DAN jam tutup. Pukul 23:00 di Jayapura masih pukul 21:00
  di Jakarta; angka gabungan memuat dua tanggal bisnis berbeda. `400
  BUSINESS_DATE_AMBIGUOUS` dengan instruksi memilih outlet — bentuk yang sama
  dengan "ringkasan stok `null` tanpa `outlet_id`". Outlet DIARSIPKAN tidak ikut
  membuatnya ambigu.
- ⛔ **Pembanding tren HARI YANG SAMA empat minggu ke belakang** (FR-G6,
  `spec-g:243`), bukan hari sebelumnya. Delta terhadap kemarin membuat setiap
  Senin terlihat seperti bencana dan setiap Jumat seperti rekor — dua sinyal
  palsu setiap minggu, selamanya. `deltaPersen: null` BERBEDA dari 0; hari
  pembanding yang tidak punya transaksi tidak dihitung nol; minimum dua hari
  (`[ASUMSI]`), dan `basisMinggu` menyatakan seberapa kasar pembandingnya.
- ⛔ **Daftar "perlu diperiksa" TERTUNGGAK, bukan harian**
  (`GET /reports/needs-attention`). Oversell yang belum ditindaklanjuti tiga
  hari lalu masih perlu ditindaklanjuti malam ini. Daftar yang disaring per
  tanggal **mengosongkan dirinya setiap tengah malam**. Diurutkan ulang LINTAS
  JENIS — tiga daftar yang disambung apa adanya membuat M-01, yang hanya
  menampilkan tiga teratas, tidak pernah menampilkan selisih kas.
  `jumlah` adalah TOTAL, bukan panjang `temuan`.
- ⛔ **Server mengirim DATA; kalimatnya disusun klien.** Kalimat yang disusun
  server menjadi kalimat KEDUA yang harus dijaga sepakat dengan back-office.
  Tanpa satu pun kata yang menyalahkan orang (`spec-g:168`), diuji di kedua
  sisi — oversell khususnya **bukan kesalahan**, ia konsekuensi CAP.
- ⛔ **Rincian per outlet dihitung `posisiPenjualan` per kelompok**, bukan
  `GROUP BY … SUM`. Ia bergantung pada order PEMBATAL berbagi outlet dengan
  aslinya — benar hari ini karena `cancel.ts` menyalin `outlet_id` lewat
  `INSERT … SELECT`. Refund menempel pada outlet ORDER-nya (JOIN), dan yang
  jatuh ke outlet salah membuat satu cabang terlihat merugi dan satu untung.
  `perOutlet: null` saat satu outlet diminta; outlet tanpa transaksi tidak
  muncul sebagai baris nol.
- ⛔ **Setiap angka bertanda membawa KATANYA**, dan besaran ditampilkan **tanpa
  tandanya** — "−12,3% lebih rendah" adalah negasi ganda yang dibaca cepat
  berarti naik. Panah tidak pernah sendirian (aturan DS #5).
- ⛔ **Bilah nav DUA item, dan keduanya bukan yang wireframe gambar.**
  `IA:§4.2` menulis `[Laporan] [Otorisasi]`; Otorisasi adalah M-04 dan tidak ada
  di v1, jadi tab yang menujunya akan mati. Yang dipakai `[Ringkasan]
  [Laporan]`. **M-02 bukan tab** — `spec-g:245` melarang bagian "perlu
  diperiksa" muncul tanpa temuan, dan tab untuknya akan tampil juga saat tidak
  ada apa pun.
- ⛔ **Pengambilan data di `Beranda.tsx`, bukan di tiap layar.** M-01 meringkas
  daftar yang M-02 tampilkan penuh; dua permintaan untuk satu jawaban dapat
  berbeda.
- ⛔ **`CATATAN_ANTREAN` selalu tampil**, juga saat angkanya lengkap: angka di
  layar adalah apa yang SUDAH SAMPAI ke server, bukan apa yang terjual.
- **Rute di state, bukan di URL** — tidak satu pun dari ketiga layar berguna
  di-bookmark. **Online-only** (`IA:265`): tanpa PowerSync, tanpa SQLite lokal.
- **Bukan PWA** — `IA:445` masih membukanya sebagai pertanyaan. **M-03 adalah
  SATU laporan, bukan sembilan.** **Email di DUA tenant tidak dapat masuk lewat
  HP** (tanpa field "ID Tenant" di layar 390px).

**AC FR-A2 KEEMPAT ditutup 25 Agustus 2026** (migrasi `0035`, keputusan user).

⛔ **Yang diperbaikinya adalah cacat NYATA:** `cetak/dokumen.ts` menerima
`variationName` di setiap baris dan **tidak pernah merendernya sama sekali**.
Merchant yang menjual "Kopi Susu Regular" dan "Kopi Susu Large" mencetak dua
baris struk yang **tidak dapat dibedakan** — dan struk adalah satu-satunya
bukti yang pelanggan pegang. Bidangnya dibawa sepanjang jalur cetak lalu
dijatuhkan di titik render; seluruh test kasir hijau di atasnya.

- ⛔ **`order_line.variation_count_at_sale` adalah SNAPSHOT, dan itu yang
  membuat ACnya dapat ditegakkan sama sekali.** Cetak ulang membangun
  dokumennya dari `order_line` dan `spec-b:145` melarangnya menyentuh tabel
  katalog; jumlah varian karena itu harus ada DI BARISNYA, kalau tidak cetakan
  pertama (yang punya katalog di tangan) dan cetak ulang (yang tidak) akan
  berbeda tepat pada hari merchant menambahkan varian kedua.
- ⛔ **Aturan berbasis NAMA ("sebut varian bila berbeda dari nama item")
  DICOBA dan DIKEMBALIKAN.** Ia bertentangan dengan contoh spec sendiri:
  `spec-c:376` mencetak "2x Kopi Susu" untuk baris ber-varian "Regular". Ada
  test kontrol yang mereproduksi contoh itu dan menolak aturan tersebut —
  sabotase memastikan ia menyala.
- ⛔ **`DEFAULT 1` dibuang setelah backfill** (pola `refund.method`, migrasi
  `0021`). Default yang tertinggal membuat jalur tulis berikutnya yang lupa
  mengirimnya diam-diam mengaku "produk ini hanya punya satu varian", dan nama
  varian menghilang dari struk tanpa satu pun error. Enam fixture test langsung
  gagal keras saat migrasi jalan — itu justru gunanya.
- ⛔ **Varian yang DIARSIPKAN ikut dihitung.** Pertanyaannya "apakah nama
  varian menambah informasi bagi pelanggan", dan merchant yang mengarsipkan
  "Large" hari ini tetap punya pelanggan yang memegang struk "Regular" dari
  kemarin.
- ⛔ **Jumlah dibekukan di baris keranjang**, bukan dibaca ulang saat menyimpan:
  katalog dapat turun di tengah antrean pelanggan.
- ⛔ **`CHECK (>= 1)`.** Nol berarti "item tanpa varian", keadaan yang tidak
  dapat ada — dan nol yang lolos membuat `> 1` bernilai false, gejala yang sama
  dengan default yang tertinggal.
- ⛔ **Biaya yang dinyatakan:** `order_line` adalah raw table, jadi kolom baru
  mengubah sidik jari skema lokal dan setiap perangkat membangun ulang tabel
  raw-nya (`disconnectAndClear()`). Riwayat penjualan LOKAL perangkat hilang
  karenanya — K-08 dan cetak ulang K-09 untuk penjualan lama berhenti bekerja
  di perangkat yang sudah terpasang. Datanya ada di server; `order_line` belum
  ada di sync rules jalur turun, jadi ia tidak kembali sendiri.

⛔ **AC FR-G6 KELIMA: `Payload Optimized <50KB (Environment-Blocked)`** —
status resmi user, 25 Agustus 2026. *"Render < 2 detik pada koneksi seluler"*
dipindahkan ke Acceptance Test, sejajar dengan gate F4 bagian pertama.

⛔ **Yang menjadi dasarnya adalah UKURAN muatan, bukan latensi terukur.**
Agregasi terjadi di server dan responsnya beberapa puluh baris; tidak ada satu
pun pengukuran throttling yang pernah dijalankan **di dalam repo ini**, dan
tidak ada test yang menegakkan ambang dua detik. Kalimat "sudah diverifikasi"
tentang AC ini salah; yang benar "biayanya dibatasi di sisi muatan, latensinya
belum diukur".

---

⛔ **Gate F4 punya DUA bagian.** `ARCH:398`: *"Cetak berhasil di ≥5 model; penjualan tetap tersimpan saat cetak gagal."* Bagian kedua terbukti lewat test. **Bagian pertama: `Logika & Profil Production-Ready (Hardware-Blocked)`** — status resmi user, 25 Agustus 2026. Ia dipindahkan ke Acceptance Test lapangan, bukan dinyatakan lulus.

⛔ **Perbedaan itu harus dijaga di kalimat mana pun tentang F4.** Yang benar: *"logika pemilihan profil dan antrean cetak selesai dan teruji deterministik; cetak di lima model fisik belum pernah dijalankan."* Yang SALAH: "F4 hijau". Tidak satu byte pun pernah meninggalkan perangkat menuju printer sungguhan — `peripheralAktif()` masih mengembalikan `null`, dan itu tercatat sebagai utang Tauri, bukan sebagai adapter yang bekerja.

---

### G1 — back-office, milestone ditutup 16 Agustus 2026

`apps/backoffice` bukan lagi kerangka. Empat epik selesai dan ter-merge, semuanya lewat PR ber-CI:

| Epik | Layar | PR |
|---|---|---|
| **Dasbor** | B-01 beranda | #44 |
| **Penjualan** | B-02 riwayat · B-03 detail transaksi · B-04 shift · B-05 detail shift | #34–#36, #41 |
| **Inventori** | B-12 stok · B-13 penyesuaian · B-14 opname · B-15 perlu diperiksa | #38–#40, #42, #43 |
| **Pengawasan** | B-21 laporan exception | #32, #33 |

**⛔ Modul `reporting` adalah satu-satunya yang boleh MEMBACA lintas domain.** Ia lahir bersama B-03 dan aman karena dua sifat yang **diuji**, bukan dijanjikan: ia tidak memiliki satu pun tabel, dan ia tidak pernah menulis. Invariant #4 karena itu tidak dilonggarkan — yang dibuat adalah satu tempat yang batasnya dinyatakan dan dijaga. Setiap layar yang menjahit data dari beberapa modul masuk ke sana.

**Keputusan yang mengikat kode back-office:**

- **`posisi-penjualan.ts` tetap satu-satunya definisi omzet, dan B-01 membuktikannya lewat test.** Dasbor memakai `ambilPenjualan`/`ambilProduk`/`ambilStok` — fungsi yang **sama persis** dengan B-16/B-17/B-12, diekspor lewat `index.ts` masing-masing. Test utamanya `assert.deepEqual` terhadap respons `GET /reports/sales`, bukan terhadap angka tulisan tangan. Dasbor adalah layar yang pertama dilihat merchant setiap pagi dan yang paling jarang diperiksa ulang; angka di sini yang berbeda dari laporan akan dipercaya lebih dulu.
- **Top-N diambil `slice`, bukan `LIMIT` di query kedua.** Query kedua dengan urutannya sendiri adalah tempat kedua yang memutuskan "terlaris".
- **Ringkasan stok `null` tanpa `outlet_id`.** Stok per outlet; satu angka gabungan lintas outlet tidak dapat dipakai memutuskan apa pun — kekurangan di satu cabang tertutup kelebihan di cabang lain.
- **`order` TIDAK berisi satu baris per transaksi.** Order pembatal adalah baris tersendiri dan order asli tetap `open` (lihat § void & refund). Setiap layar riwayat harus menurunkan status dari ada/tidaknya pembatal, bukan dari kolom `status`.
- **B-06 memakai pencarian SISI SERVER**, dan `saringProduk` dihapus (21 Agustus 2026). Dua tempat yang memutuskan "produk mana yang cocok" akan menyimpang; yang menyimpang menghasilkan pencarian yang menemukan hal berbeda tergantung layar mana yang bertanya. ⛔ Server punya cabang `category_id IS NULL` untuk `TANPA_KATEGORI` — tanpa itu, saringan "tanpa kategori" mengembalikan **nol produk** alih-alih produk tanpa kategori, dan nol terlihat persis seperti "memang tidak ada". Konstantanya di `packages/domain/src/katalog-saringan.ts`.
- **Paginasi riwayat wajib keyset, bukan offset.** Perangkat offline menyisipkan baris ber-`business_date` historis di tengah urutan; offset akan melewatkan atau menggandakan baris tepat saat antrean terkuras.
- **Delta opname dihitung dari snapshot pada T**, bukan dari stok saat tombol ditekan (FR-E7) — penjualan yang terjadi SELAMA opname tidak boleh ikut terkoreksi. Dibuktikan di browser: stok 5, bukan 8.
- **Ambang stok menipis dan `AMBANG_SELISIH` hidup di `packages/domain`**, dibagi server dan klien. Konstanta yang dipanggang di satu sisi akan menyimpang dari sisi lain.

**⛔ Utang PostgreSQL yang dibersihkan, 16 Agustus 2026 (PR #45):** `Promise.all` atas **satu `PoolClient`** dihapus dari ketiga tempat yang punya — rute Dasbor (`reporting/handlers/dasbor.ts`), Identity (`identity/handlers/users.ts`), dan Reporting (`reporting/index.ts`).

`node-postgres` **tidak** memparalelkan query pada satu koneksi; ia mengantrekannya. Jadi polanya tidak pernah membeli apa pun — yang didapat hanya `DeprecationWarning: Calling client.query() when the client is already executing a query`, perilaku yang **dihapus di pg@9**. Terlihat di log server saat E2E, bukan di test: ketiganya menjawab benar.

Memparalelkannya dengan sungguh-sungguh menuntut koneksi tambahan, dan itu berarti transaksi tambahan — `SET LOCAL app.tenant_id` berlaku **per transaksi** (invariant #8), jadi responsnya berhenti menjadi satu potret pada satu titik waktu. **Jangan mengembalikan `Promise.all` ke sana sebagai "optimasi";** alasannya ditulis sebagai komentar di ketiga berkas.

Gate F3 `ARCH:§14` — *"buka toko → jual → tutup buku dengan angka konsisten antar laporan"* — terpenuhi: buku kas menjadi sumber tunggal saldo laci, satu fungsi mendefinisikan omzet untuk seluruh laporan, dan stok akhirnya bergerak dua arah.

**Apa yang F3 temukan, dan ini polanya:** setiap potongan Modul G dan E yang dibangun menjatuhkan cacat diam di kode yang sudah lolos review dan lolos gate sebelumnya. Empat, semuanya di jalur uang atau stok, semuanya tanpa satu pun error:

| Cacat | Akibatnya | Yang menyembunyikannya |
|---|---|---|
| Saldo laci dihitung dari `payment`, bukan `cash_movement` | Refund tunai tidak pernah mengurangi laci; kasir terlihat kurang sebesar nilai refund, **dan tutup kasnya menuntut otorisasi manajer** untuk selisih yang tidak ada | Fake `DbLokal` diberi baris `{method:'cash', arah:-1}` yang query sungguhannya **tidak dapat hasilkan** |
| Tidak ada `stock_movement` bertipe `sale` sama sekali | Stok hanya pernah NAIK — void/refund mengembalikan barang yang tidak pernah dikurangi | 18 test void/refund menghitung SELURUH baris `stock_movement`; nol adalah jawaban benar karena alasan yang salah |
| `getVariationSnapshot` memetakan `itemId`/`categoryId` tanpa menyeleksinya | Tarif ber-scope item/kategori **tidak pernah berlaku**; FR-C6 punya tiga tingkat, dua teratasnya mati | Test hanya menguji PEMBUATAN tarif ber-scope item, bukan penerapannya ke order |
| Cabang `arah = -1` di tutup kas | Kode mati yang menyamar sebagai penanganan pembatalan | Order pembatal tidak punya baris `payment`; cabangnya tidak pernah menyala |

**Yang ketiganya punya bersama:** test yang hijau karena hampa. Bukan test yang salah menghitung — test yang memeriksa keadaan yang tidak dapat terjadi. Itu kelas yang tidak tertangkap review dan tidak tertangkap coverage.

Seluruh isi F2 yang `ARCH:§14` sebut kini ada, dan **seluruh alur kasir berjalan tanpa jaringan**:

```
login PIN → buka shift → jual (grid + modifier) → bayar tunai
          → riwayat → batalkan/refund → tutup kas → laporan shift
```

| Layar | Kode | Bukti |
|---|---|---|
| Login PIN | K-01 | Argon2 WASM, 33 ms, diverifikasi di browser |
| Buka shift | K-02 | Tanggal bisnis dari zona outlet; relay `pending → sent` |
| Kasir + modifier | K-03/04/05 | Tangga harga tiga tingkat berjalan di perangkat |
| Pembayaran | K-06/07 | Satu `writeTransaction`; mendarat di server dengan ULID klien |
| Riwayat + detail | K-08/09 | Rantai koreksi dua arah |
| Void/refund | K-10 | Dua identitas, stok kembali, nol payment negatif |
| Otorisasi | K-11 | PIN manajer diverifikasi lokal |
| Tutup kas + laporan | K-12/13 | Urutan input wajib; percobaan hitungan tercatat |

**Gate F2 hijau:** `npm run test:dst` — 10.000 iterasi fault injection, nol pelanggaran atas sepuluh invariant.

**Yang TIDAK termasuk, dan tercatat sebagai utang:** enkripsi at-rest (menunggu Tauri, F4). (FR-F5 ditutup 25 Agustus 2026 — lihat § FR-F5.) (FR-H8, Modul C-3, refund parsial dengan pemilihan baris, K-16 buka laci, dan K-17 scanner sudah ditutup, 21 Agustus 2026; FR-D5 kas masuk/keluar 24 Agustus 2026.)

**Kas masuk & kas keluar (FR-D5) ditutup 24 Agustus 2026.** `spec-d:189` mendaftarkan `paid_in`/`paid_out` di enum `cash_movement` sejak awal dan `spec-d:202` menetapkan aturannya; sampai hari itu tidak ada satu pun jalan untuk membuatnya, di server maupun di perangkat.

⛔ **Ketiadaannya adalah bentuk KEEMPAT dari cacat "laci yang angkanya berbeda dari uang di dalamnya".** Tiga yang pertama adalah uang yang tidak pernah masuk; ini uang yang keluar dengan sah dan tidak pernah tercatat. Owner yang mengambil Rp 500.000 untuk membayar pemasok membuat tutup kas **ditolak** (`VARIANCE_REASON_REQUIRED`) sampai kasir mengarang alasan untuk selisih yang bukan salahnya — dan Rp 500.000 melewati ambang, jadi otorisasi manajer dituntut juga, lalu FR-G5 menandai kasirnya. Kedua sisinya diuji langsung: shift identik DENGAN pencatatan menutup dengan selisih **nol**.

- ⛔ **`jumlah` selalu POSITIF; `arah` yang menurunkan tandanya** (`packages/domain/src/kas-manual.ts`), dipakai server dan klien. Klien yang mengirim `-50000` untuk kas MASUK mengurangi laci yang seharusnya bertambah — angkanya benar, tandanya tidak, dan tutup kas menemukannya berjam-jam kemudian sebagai selisih dua kali lipat. Klien karena itu mengirim `{arah, jumlah}`, **bukan** `delta` bertanda: dua tempat yang menurunkan tanda akan menyimpang.
- ⛔ **`counterpart_type` diturunkan dari ALASAN, bukan dari arah** (FR-D6). "Ambil pemilik" dan "bayar pemasok" keduanya `paid_out` dengan jumlah yang sama; yang pertama `owner_draw`, yang kedua `expense`. Pembukuan yang menyamakannya melaporkan biaya operasional yang tidak pernah terjadi. `lainnya`/`koreksi_pencatatan` → `unidentified`, dan itu **jujur** — menebaknya `expense` membuat setiap koreksi kecil masuk laporan biaya.
- ⛔ **TANPA PIN manajer**, ditiru dari keputusan void 1 Agustus 2026. Orang yang mengambil uang dari laci sering satu-satunya orang yang ada, dan ia pemiliknya; penyetuju yang wajib berbeda dari aktor (`CHECK` di `audit_event`) membuat fiturnya mustahil dipakai justru oleh yang paling membutuhkannya — dan yang tidak dapat mencatat tetap mengambil uangnya. `[ASUMSI]`; yang menjaganya `assertBoleh(shift_open_close)` + alasan daftar tertutup + audit.
- ⛔ **Nol ditolak**, alasan yang sama dengan no-sale yang justru TIDAK menulis `cash_movement`: movement bernilai nol membuat buku kas memuat baris yang tidak menjelaskan apa pun. **Shift TERTUTUP menolak 409** — saldo dan selisihnya sudah ditandatangani seseorang.
- ⛔ **Rute jalur perangkat wajib `sesiOpsional`, bukan sekadar `DIKECUALIKAN`.** Ia sempat hanya yang kedua, dan akibatnya setiap kas masuk/keluar yang dicatat offline dijawab **401** lalu berhenti permanen di antrean — bentuk PERSIS sama dengan cacat refund offline 21 Agustus. Yang menemukannya adalah aturan yang lahir dari cacat itu: test yang memakai `buatPengirimHttp` dan `klasifikasi` yang ASLI. Ke-16 test endpoint langsung hijau selama itu.
- **`setor_ke_bank` ada di daftar keluar** meski enum punya `bank_deposit` tersendiri: `spec-d:339` menunda fitur setoran, dan yang tidak boleh terjadi sementara itu adalah merchant yang menyetor ke bank tidak punya cara mencatatnya sama sekali. `counterpart_type` tetap `bank` supaya barisnya dapat ditemukan lagi bila `bank_deposit` kelak dibangun.

**Percobaan hitungan kas (FR-D2, `shift_count_attempt`) ditutup 24 Agustus 2026** lewat jalur tulis yang **berdiri sendiri**.

⛔ **Ia tidak dapat ditulis dari dalam transaksi penutupan.** Percobaan yang DITOLAK — selisih melewati ambang tanpa penyetuju — dilempar `closeShift` SEBELUM satu pun `UPDATE`, dan seluruh transaksinya di-rollback. Dan justru percobaan yang gagal itulah yang `spec-d:127` ingin buktikan tidak dapat diulang diam-diam: kasir yang mencoba Rp 2.450.000, melihat selisihnya, lalu mengetik Rp 2.485.000 supaya cocok, meninggalkan jejak **NOL**.

- ⛔ **`POST /shifts/{id}/count-attempts` TIDAK menyentuh `cash_drawer_shift` sama sekali.** Endpoint yang menulis percobaan DAN memperbarui shift menjadi jalan kedua menuju penutupan — tanpa pemeriksaan ambang, tanpa penyetuju, tanpa buku kas. Yang ditulis hanya JEJAK; diuji dengan membandingkan seluruh baris shift sebelum dan sesudah.
- ⛔ **Di klien, satu transaksi yang BERDIRI SENDIRI** — riwayat lokal dan jejak auditnya ditulis BERSAMA, tapi tidak pernah bersarang di dalam transaksi `tutupKas`.
- ⛔ **Shift yang SUDAH TERTUTUP tetap menerima percobaan.** Yang dikirim terlambat adalah jejak dari SEBELUM penutupan; menolaknya menghapus jejak justru pada perangkat yang paling lama offline.
- ⛔ **Tipe peristiwa DI-BIND sebagai parameter bertipe `PeristiwaAudit`**, bukan inline di string SQL — nama yang dipaku di dalam string tidak diperiksa TypeScript terhadap kosakata tertutup.
- **Batas AJV yang dinyatakan:** `countedAmount` bertipe `number` TIDAK ditolak — koersi AJV mengubahnya menjadi string sebelum handler melihatnya. Kemunculan KETIGA kelas ini (ambang otorisasi, telemetri). Yang masih dijaga adalah nilainya: pecahan dan negatif gagal regex.

**Keputusan yang mengikat K-16 (FR-D7) dan K-17:**

- ⛔ **Yang dicatat no-sale adalah PERINTAH sistem, bukan bukti laci terbuka.** `spec-d:231`: sinyalnya **satu arah** — sistem tidak tahu apakah laci benar-benar terbuka, dan **tidak dapat mendeteksi laci yang dibuka manual dengan kunci**. AC FR-D7 kelima menuntut ini dinyatakan ke merchant; ia ada di layar, runbook §8.5, dan kontrak endpoint.
- ⛔ **Ambang no-sale dihitung dari `audit_event`, bukan dari kolom hitungan.** Kolom hitungan adalah angka kedua yang harus dijaga sepakat dengan jejaknya, dan yang menyimpang di antaranya tidak dapat diputuskan mana yang benar. Pembukaan **KEEMPAT** yang menuntut PIN (`AMBANG_NO_SALE = 3` berarti tiga yang bebas).
- ⛔ **No-sale TIDAK menulis `cash_movement`** — ia tidak memindahkan uang, dan movement bernilai nol membuat buku kas memuat baris yang tidak menjelaskan apa pun.
- ⛔ **RBAC no-sale ada di `DIKECUALIKAN`, bukan `PETA_PERAN`.** Setiap entri `PETA_PERAN` diuji MENOLAK kasir, sementara kasir justru BOLEH membuka laci (`IA:66`). Yang menjaganya `assertBoleh(shift_open_close)` di handler — menutup akuntan (`spec-f:82`) — plus ambang frekuensi.
- ⛔ **Scanner: `cariBarcode` BUKAN `cariItem`.** Pencarian menyaring daftar untuk dilihat kasir; scan memutuskan SATU produk tanpa kasir melihat apa pun. Barcode ganda **tidak memilih siapa pun** — menebak berarti setengah penjualan produk itu tercatat pada produk lain, tanpa satu pun error.
- ⛔ **Listener scanner global TIDAK menangkap ketukan di kolom teks.** PIN di K-01/K-11 diketik cepat dan diakhiri Enter — bentuk yang PERSIS sama dengan scan.
- ⛔ **`X-Actor-Id` diabaikan sepenuhnya di rute terlindungi** (`getActorId`: "sesi menang"). Test yang mengganti header itu untuk menguji peran lain sebenarnya menguji pemilik sesi — ditemukan lewat test "akuntan ditolak" yang hijau dengan status **201**. Pakai `buatSesi`.

**Keputusan yang mengikat refund parsial (FR-B7, 21 Agustus 2026):**

- ⛔ **Nilai refund BUKAN jumlah `order_line.line_total`.** `line_total` belum kena pajak eksklusif sementara `order.total` sudah; menjumlahkannya mengembalikan uang **lebih sedikit** daripada yang pelanggan bayar, dan salahnya diam. Untuk pajak inklusif ia justru sudah termasuk — tidak ada satu rumus penjumlahan yang benar untuk keduanya. Yang dipakai: `allocateProportionally(order.total, line_total[])` di `packages/domain/src/pilihan-refund.ts`, sehingga memilih seluruh baris mengembalikan **tepat** `order.total`.
- ⛔ **Batas per baris diturunkan per VARIASI**, meniru `planRestock` server. `stock_movement` tidak menyimpan `line_id`, jadi kebenaran per baris tidak ada di mana pun; yang dijamin adalah jumlahnya per variasi tidak melebihi yang server izinkan.
- **Pilihan bermula KOSONG.** `lines: []` sah — uang kembali tanpa barang kembali. Memulai penuh membuat restock jadi bawaan diam-diam, dan stok yang mengembang baru ketahuan saat opname.
- ⛔ **Kosakata `stock_movement.type` klien kini SAMA dengan server.** Klien sempat menulis `void_return`/`refund_return` — nilai yang `CHECK` di server tolak. Ia tidak pernah gagal karena barisnya murni lokal dan skema lokal tanpa CHECK, tapi `stock_movement` sudah terdaftar sebagai raw table: hari ia masuk sync rules, dua kosakata untuk satu peristiwa menjadi laporan yang menghitung sebagian pengembalian dan melewatkan sisanya. Dijaga `tests/kasir/kosakata-stock-movement.test.js`.

Gate F0 (lihat `HANDOFF.md` untuk bukti per item):
- [x] Skema PostgreSQL + RLS berjalan (`db/migrations/0001–0014`)
- [x] **Test isolasi lintas-tenant hijau untuk setiap tabel** — `npm run test:isolation`, 189/189
- [x] Skema SQLite lokal berjalan (`db/local/001-initial.sql`) — `npm run test:sqlite-local` hijau
- [x] Font Inter di-self-host (mengganti `@import` Google Fonts)
- [x] Header COOP/COEP di-set (`apps/kasir/vite.config.ts` + `tauri.conf.json`)
- [x] `_adherence.oxlintrc.json` masuk CI — `npm run lint:ds` hijau, `.github/workflows/lint-ds.yml`
- [x] Aplikasi kosong berjalan di Tauri dengan token design system terpasang
- [x] **DST menembak server sungguhan juga** — `npm run test:dst-server`: Fastify + PostgreSQL lewat transport yang sama cacatnya, invariant diperiksa terhadap baris database. Iterasinya jauh lebih sedikit; yang dicari ikatan ke implementasi, bukan kedalaman ruang keadaan
- [x] **Harness DST ada dan gate-nya hijau** — `npm run test:dst`, 10.000 iterasi fault injection, nol pelanggaran. **Sepuluh** invariant: I1–I8 dari `prototypes/02-dst-sinkronisasi/FINDINGS.md`, lalu **I9 urutan kausal** dan **I10 monotonisitas HLC per perangkat** yang lahir bersama FR-H5 (8 Agustus 2026). Tiap perangkat punya jamnya sendiri, saling geser dan sesekali mundur — sebelumnya ketiganya berbagi satu jam, jadi HLC dihitung lalu diabaikan. Ketujuh mode cacat tinggal permanen sebagai bukti invariantnya tidak kosong
- [x] **SQLite WASM+OPFS berjalan di browser — diukur 7 Agustus 2026** (`prototypes/03-sqlite-opfs/FINDINGS.md`). Paket `@sqlite.org/sqlite-wasm`. **Temuan yang membalik asumsi: VFS `opfs-sahpool` 71× lebih cepat menulis daripada VFS `opfs`, dan tidak butuh COOP/COEP.** Dua tab tidak dapat sama-sama menulis (`NoModificationAllowedError`) — pola satu-penulis WAJIB. `storage.persisted()` = `false`: data lokal dapat dihapus browser. Belum diukur di Android/iOS

Status F1 sekarang:

- **Sub-project 1 — endpoint REST inti: selesai.** 28 operasi REST atas `category`, `item`/`item_variation`, `modifier_list`/`modifier`, `item_modifier_list` (`docs/superpowers/plans/PLAN-katalog-rest-inti.md`). Menutup FR-A1/A2/A4/A6/A9 di sisi backend.
- **Sub-project 2 — FR-A7 harga per outlet dan riwayatnya: selesai sebagian** (`docs/superpowers/plans/PLAN-katalog-harga-riwayat.md`). 4 operasi REST atas `price_history`, resolver tangga tiga tingkat diekspor lewat `catalog/index.ts` untuk dipakai Modul B, migrasi `0016` (index resolusi).

**FR-A7 AC keempat ditutup 24 Agustus 2026** — `GET /reports/stale-price-devices` + panel di B-01.

⛔ **"Terakhir terlihat" adalah PROKSI, bukan bukti, dan arahnya SATU ARAH.** Checkpoint PowerSync hidup di tabel `ps_*` MILIK PERANGKAT; server kami tidak dapat membacanya. Yang server tahu hanya `device.last_seen_at` (diperbarui saat perangkat meminta token sync). Jadi `last_seen_at < effective_from` berarti perangkat **PASTI** belum menerimanya, sementara sebaliknya **belum tentu** sudah. Layar menyatakan asimetri itu, dan kalimatnya tampil **juga saat daftarnya kosong** — daftar kosong yang tidak disertai kalimat itu terbaca sebagai jaminan.

- ⛔ **`jumlahDiperiksa` ikut di respons.** "Tidak ada yang tertinggal" dari NOL perangkat berarti hal yang sangat berbeda dari yang sama dari sepuluh perangkat, dan keduanya terlihat sama.
- ⛔ **Harga ber-`effective_from` di MASA DEPAN tidak dihitung tertinggal.** Harga terjadwal belum berlaku untuk siapa pun; menghitungnya membuat setiap penjadwalan menandai SELURUH armada sebagai basi.
- ⛔ **Perangkat yang BELUM PERNAH terlihat ikut**, lewat `COALESCE(last_seen_at, '-infinity')` — ia justru yang paling penting: perangkat yang baru didaftarkan dan tidak pernah menyala tidak akan pernah memakai harga apa pun yang benar.
- ⛔ **Harga milik outlet LAIN tidak menandai perangkat outlet ini** (tangga tiga tingkat). Laporan yang menandai armada untuk perubahan yang tidak berlaku baginya berhenti dipercaya.
- ⛔ **Panel mengambil datanya SENDIRI, bukan ikut respons dasbor.** RBAC-nya `price_edit` sementara dasbor dibaca peran yang lebih luas; menggabungkannya berarti seluruh dasbor dijawab 403 untuk manajer outlet. **403 dibedakan dari gagal** di layar.
- **Harga AWAL item adalah baris `price_history` juga**, jadi perangkat yang lama tidak terlihat tertinggal olehnya. Benar, dan ditemukan lewat test yang ekspektasinya salah.

**FR-G6 ditutup 25 Agustus 2026** — `GET /reports/daily-summary` + `GET /reports/needs-attention` + `apps/hp`. Rinciannya di § G2.

**FR-F5 dan FR-A7 AC ketiga ditutup 25 Agustus 2026** (keputusan user).

⛔ **`cost` TIDAK PERNAH turun ke perangkat, dan servernya yang men-snapshot.** Ia margin modal milik owner; perangkat kasir yang memegangnya adalah kebocoran yang tidak dapat ditarik kembali begitu satu tablet hilang. `item_variation.cost` ada di `KOLOM_SENGAJA_TIDAK_TURUN`, dan `POST /orders` mengambil nilainya dari katalog lewat `getVariationSnapshot` saat order masuk.

- ⛔ **Nilai dari KLIEN diabaikan sepenuhnya.** `order_line` lokal PUNYA kolom `cost_at_sale` dan klien menulis nol ke sana; jalur naik yang kelak menyertakannya akan mengirim nol, dan nol yang dipercaya menghasilkan **margin 100%** untuk setiap produk. Angkanya terlihat meyakinkan, dan owner memutuskan harga jual berdasarkan itu.
- ⛔ **Snapshot BEKU.** `spec-a:227`: laporan margin historis memakai `cost_at_sale`, bukan `cost` katalog hari ini. Merchant yang harga belinya naik pekan depan tidak boleh mendapati margin bulan lalu ikut berubah — laporan yang jawabannya berubah tanpa satu pun transaksi berubah tidak dapat dipakai memutuskan apa pun.
- ⛔ **Kolom margin HILANG untuk yang tidak berhak, bukan bernilai `null`** (`spec-g:99`). Kolom kosong tetap memberi tahu bahwa margin ada dan tidak boleh dilihat.
- ⛔ **`view_margin` TIDAK menolak permintaannya.** `spec-g:86` menandai laporan produk tersedia di perangkat kasir; 403 di sana akan menutup seluruh laporan demi satu kolom. Yang berubah hanya kolomnya, dan `margin: boolean` di respons **menyatakannya** — layar yang menyimpulkannya dari baris pertama akan menyembunyikan kolom untuk owner pada periode tanpa penjualan.
- ⛔ **Baris ber-HPP NOL dihitung dan DISEBUTKAN** (`barisTanpaHpp`). Nol dapat berarti "belum diisi" atau "memang tanpa biaya", dan keduanya menghasilkan margin 100%; layar menyatakan arah kesalahannya ("angka di bawah lebih tinggi dari yang sebenarnya").
- ⛔ **Margin NEGATIF tidak di-clamp**, dan persennya membawa kata "rugi" — "−60%" di kolom bernama Margin dibaca sekilas sebagai enam puluh persen, dan baris yang rugi adalah tepat yang paling perlu dilihat.
- **Ekspor CSV TANPA margin**, batas yang dinyatakan: kolom yang berubah menurut peran pengekspor menghasilkan dua berkas bernama sama dengan isi berbeda, dan akuntan merchant tidak punya cara mengetahui mana yang ia pegang.

**FR-A5 ditutup bersama B-09** · **FR-A3 ditutup 22 Agustus 2026** · **FR-A8 (import katalog) sudah ada** — `catalog/handlers/import.ts` + layar impor back-office.

**Keputusan yang mengikat kode pemilihan modifier (FR-A3):**

- ⛔ **Aturannya di `packages/domain/src/modifier-pilihan.ts`, bukan di komponen React.** `spec-a:117` menulis tabelnya sebagai "perilaku di layar kasir" dan itu benar, tapi aturannya bukan tata letak: `max_selections = 3` yang dilanggar menghasilkan `order_line_modifier` yang tidak dapat dibuat barista. Yang hanya dapat diuji lewat DOM biasanya tidak diuji sama sekali.
- ⛔ **Batas menghitung UNIT, bukan baris.** `Extra Shot ×2` dihitung dua; menghitung baris membuat `max_selections = 3` meloloskan enam shot lewat tiga baris ber-qty 2. `[ASUMSI]` — `spec-a` tidak menyatakan interaksi `max_selections` dengan `allow_duplicate`.
- ⛔ **Pilihan yang melewati batas DINONAKTIFKAN** (`spec-a:126`: "bukan menerima lalu menolak"), dan batasnya ikut terlihat di legend. Kasir yang tombolnya mati tanpa penjelasan menyimpulkan aplikasinya rusak.
- ⛔ **`is_required` dan `min_selections` adalah SATU pertanyaan**, yang berlaku yang lebih besar. Dua sumber untuk satu pertanyaan menghasilkan dialog yang menolak karena alasan yang tidak ditampilkannya.
- ⛔ **Kuantitas modifier masuk SIDIK JARI keranjang.** Tanpa itu "Extra Shot ×1" dan "×2" digabung jadi satu baris — pelanggan kedua menerima kopi pelanggan pertama, dan totalnya salah tanpa error.
- ⛔ **`ModifierTerpilih` terpisah dari `ModifierPilihan` katalog.** `bawaan` sifat katalog, `qtyMilli` sifat pilihan; satu tipe untuk keduanya membuat `bawaan` ikut tersimpan ke keranjang dan terkirim ke server sebagai bagian dari pesanan.
- ⛔ **`order_line.modifier_snapshot` lokal kini `[{nama, qtyMilli}]`, dan parsernya menerima TIGA bentuk.** Baris lama ada di perangkat merchant dan tidak dapat ditulis ulang — `order_line` tidak pernah di-`UPDATE` (invariant #2). ⛔ Bentuk ini **berbeda** dari snapshot server (`[{id, modifierId, name, price, quantityMilli}]`), dan **hari yang diramalkan itu tiba 29 Agustus 2026** saat `order_line` masuk sync rules: tanpa bentuk ketiga, `nama` bernilai `undefined` dan K-08 menampilkan kata **`"undefined"`** sebagai nama modifier untuk setiap baris yang dipulihkan dari server — di layar yang dipakai memutuskan refund, tanpa satu pun error. Bentuk klien menang bila keduanya ada.
- **Server TIDAK menegakkan aturan ini.** `POST /orders` menerima modifier apa adanya; menegakkannya di sana menuntut server membaca `modifier_list` pada setiap penjualan, dan aturannya dapat berubah setelah order antre offline berjam-jam. Batas yang dinyatakan.

Sisa Modul B: tidak ada yang belum digarap. **FR-B11 ditutup** bersama antrean `print_job` (tombol cetak ulang di K-09). **FR-B8/B9 ditutup 22 Agustus 2026** — server + domain lebih dulu, lalu layar kasir; keputusannya di § diskon di bawah.

**Keputusan yang mengikat kode diskon (FR-B8/B9):**

- ⛔ **Sebelum ini `order_discount` SELALU NOL.** Kolomnya ada sejak F0 dan `computeOrderTotals` sudah menghitungnya sejak Modul C, tapi `POST /orders` menulis nol ke sana — tidak ada satu pun jalan bagi merchant untuk memberi diskon, dan tidak ada satu pun test yang merah karenanya.
- ⛔ **Ambang diputuskan dari NILAI RUPIAH, bukan dari bentuk yang diketik kasir.** `spec-b:273` menulis "> 20% **atau** > Rp 50.000", dan keduanya berlaku apa pun bentuk masukannya. Memeriksa satu bentuk saja membuat setengah ambang tidak pernah menyala — dan yang tidak menyala adalah yang dipakai untuk melewatinya. Perbandingannya **perkalian silang**: pembagian bigint memotong, dan 20,004% akan terbaca persis 20% lalu lolos.
- ⛔ **Ambang dihitung dari subtotal SERVER**, dan **turun ke perangkat** supaya aturannya berlaku offline. Klien yang tidak tahu ambangnya menerapkan diskon 90% tanpa satu pun PIN, lalu server menolaknya berjam-jam kemudian — saat uangnya sudah diterima. Kolomnya kemunculan KEEMPAT kelas cacat `numeric → INTEGER berskala`.
- ⛔ **Persetujuan manajer berlaku untuk ANGKA yang ia lihat, bukan untuk persentasenya** (`DiskonKeranjang.nominalDisetujui`). Manajer menyetujui 30% dari Rp 100.000 — Rp 30.000 — lalu kasir menambah barang senilai Rp 900.000 dan potongannya menjadi Rp 300.000 dengan persetujuan yang sama. Potongan yang **tumbuh** melewatinya menuntut persetujuan baru; yang **mengecil** tidak. `approverId` tanpa `nominalDisetujui` tidak menutup apa pun.
- ⛔ **`statusDiskon` adalah SATU fungsi untuk layar dan untuk jalur penulisan.** K-03 memakainya untuk memberi tahu kasir sebelum ia menekan Bayar; `simpanPenjualan` memakainya untuk menolak. Dua salinan menghasilkan layar yang berkata "siap" pada penjualan yang ditolak sendiri.
- ⛔ **Klien mengirim PERMINTAAN (`{tipe, nilai}`), bukan nominalnya.** Server menghitung ulang dari subtotalnya sendiri; itu yang membuat pemeriksaan selisih FR-H6 dapat membedakan perangkat berharga basi dari angka yang dikarang.
- ⛔ **Penjualan berdiskon di atas ambang TIDAK ditulis tanpa penyetuju.** Berbeda dari selisih hitungan (`spec-h:95`, "tidak pernah menolak transaksi"): di sana uangnya sudah diterima merchant, di sini kasir belum menerima apa pun. `approver_id` dibekukan di `outbox_local` — tanpanya diskon offline dijawab `403` lalu berhenti permanen di antrean, bentuk cacat yang sama persis dengan refund offline.
- ⛔ **403 `APPROVAL_REQUIRED`, bukan 400.** Permintaannya tidak cacat, ia hanya belum disetujui; kasir yang menerima 400 akan mengira ia salah memasukkan angka.
- ⛔ **Alasan dituntut untuk SETIAP diskon**, bukan hanya yang melewati ambang, dan audit ditulis untuk keduanya. Pola diskon kecil yang berulang adalah persis yang laporan exception FR-G5 ada untuk menemukannya.
- ⛔ **Digit desimal persen DITURUNKAN dari skalanya.** "15%" adalah rate 0,15, berskala 10.000 ia `1500` — jadi angka persennya berskala `SKALA_TARIF / 100`, tepat dua digit. Koma dan titik sama-sama diterima; nominal rupiah tidak menerima desimal sama sekali.
- **Struk mencetak diskonnya.** `computeOrderTotals` tidak mengurangi `subtotal`, jadi `diskon: 0` yang sempat dipaku di jalur cetak menghasilkan struk bersubtotal 20.000 dan TOTAL 20.900 tanpa baris yang menjelaskan selisihnya.
- **Diskon PER BARIS tidak dibangun.** `spec-b:267` menyebutnya dan `order_line.discount_amount` ada di skema, tapi `POST /orders` hanya menerima diskon tingkat order. Batas yang dinyatakan.

**Modul C sub-project 1 selesai** (`docs/superpowers/plans/PLAN-pembayaran-pajak.md`): `TaxCalculator`, REST `tax_rate`, dan pembayaran tunai. `OPEN` → `PAID` → `CLOSED` kini hidup. Menutup FR-C6, C7, C8, C9, C11, dan FR-C1/C2 untuk tunai.

**Modul C sub-project 2 — gateway: selesai** (`docs/superpowers/plans/PLAN-void-refund-gateway.md` §5.7). QRIS dinamis lewat port `PaymentProvider`, QRIS statis, EDC, endpoint cek status, dan webhook Midtrans. Menutup sisa FR-C2, FR-C4, FR-C5, dan FR-C14.

**Keputusan yang mengikat kode gateway:**

- **Port `PaymentProvider` wajib, bukan pilihan gaya.** CI mengisi `MIDTRANS_SERVER_KEY` dengan string kosong, jadi **tidak ada satu pun test yang boleh menyentuh jaringan**. Adapter dipilih di `buildApp` lewat `PAYMENT_PROVIDER` (invariant #5); `midtrans` dengan kunci kosong **gagal saat boot**, bukan saat pelanggan pertama membayar.
- **Status gateway tak dikenal → `pending`, tidak pernah `confirmed`.** `spec-c:320` melarang sistem menandai lunas tanpa konfirmasi; menebak ke arah lain berarti menandai lunas berdasarkan kata yang tidak dimengerti.
- **QRIS dinamis memakai DUA transaksi** — satu-satunya jalur di repo ini yang begitu. Payment `pending_confirmation` ditulis dan di-commit **sebelum** gateway dipanggil, karena kegagalan gateway di dalam transaksi akan me-rollback satu-satunya jejak bahwa QR pernah diminta — sementara pelanggan mungkin sudah membayar (FR-C14). Ini tidak melanggar invariant #1: inisiasi QRIS bukan penjualan yang selesai, dan `sumConfirmed` mengabaikan payment `pending_confirmation` sepenuhnya.
- **Idempotency key gateway hanya diselesaikan bila gateway menjawab.** Kalau ia diselesaikan juga saat gateway gagal, retry dengan key yang sama menerima respons "tanpa QR" dari cache selamanya. Ini yang membuat `IdempotencyRecord.completed` perlu ada — `response_status ?? 200` membuat klaim yang belum selesai tidak dapat dibedakan dari sukses ber-body kosong.
- **QRIS statis dan EDC langsung `confirmed`, dan itu bukan pelanggaran `spec-c:320`** — aturan itu berbunyi "tanpa konfirmasi dari **gateway**" dan berlaku untuk pembayaran yang punya gateway. Yang mengonfirmasi keduanya adalah orang. `confirmed_manually` menandai bahwa tidak ada sistem yang memverifikasi (FR-G5 memakainya), dan diisi `true` hanya untuk `qris_static`.
- **Webhook adalah satu-satunya endpoint tanpa `X-Tenant-Id`.** Signature diverifikasi sebelum satu query pun jalan; tenant dibaca dari `custom_field1` lalu dipakai sebagai `app.tenant_id`, sehingga pencariannya tetap tunduk RLS. Kunci kosong → `503`, bukan diterima apa adanya.
- **Redaksi log dipasang di lapisan logging** (`logMethod` pino), bukan dipanggil dari tiap handler — AC FR-C5 ketiga menuntut kata itu. Ia menyaring bentuk nomor kartu **dan** nilai rahasia yang didaftarkan saat boot; penyaringan berbasis nama field saja tidak menangkap kunci yang menyelinap ke pesan error.

**Modul C sub-project 3 — rekonsiliasi & ekspor: selesai** (21 Agustus 2026). FR-C12 dan FR-C13, keduanya P1. `IA:§3.3` menamai B-19 "Laporan Pembayaran **& Rekonsiliasi**" sejak awal; kata kedua itu kini punya kode di baliknya.

**Keputusan yang mengikat kode rekonsiliasi:**

- ⛔ **MDR bukan pajak.** Ia hidup di `packages/domain/src/mdr.ts`, bukan di `tax.ts` — biaya jasa akuisisi yang tidak masuk `order.tax_amount`, tidak muncul di struk, dan tidak mengubah satu pun angka di `order`. Tarifnya `bigint` berskala 10.000, konvensi yang sama dengan `tax_rate.rate`.
- ⛔ **`null` BERBEDA dari `0`, dan perbedaannya sampai ke layar.** `0` = diperkirakan tidak dipotong (UMI ≤ Rp 500.000); `null` = metode itu tidak punya perkiraan sama sekali. Kartu EDC masuk yang kedua — tarifnya per-acquirer dan `spec-c` tidak memberikan satu pun angkanya. Layar menulis "— tidak ada perkiraan", CSV menulis sel kosong. "Rp 0" untuk kartu adalah pernyataan yang **salah**.
- ⛔ **`payment.mdr_estimated` SNAPSHOT**, ditulis di transaksi pembayaran. Menghitungnya saat dibaca membuat dua ekspor untuk periode yang sama berbeda begitu kategori atau tarif regulator berubah. Konsekuensinya dinyatakan: memperbaiki `tenant.merchant_category` **tidak** mengubah baris lama.
- ⛔ **Angka kepala rekapitulasi dari `posisiPenjualan`**, lewat `rekapPenjualan` di berkas yang sama. AC FR-C13 kedua menuntut totalnya cocok dengan laporan penjualan; memakai fungsi yang sama membuat itu benar menurut **konstruksi**, dan testnya `assert.deepEqual` terhadap respons `GET /reports/sales`.
- ⛔ **Pajak dipisah dari kolom SNAPSHOT** `order_line.tax_rate_name` (`0022`) dan `order_line.tax_jurisdiction` (`0028`), bukan JOIN ke `tax_rate`. Tarif yang di-rename setelah pelaporan tidak boleh mengubah rekapitulasi periode yang sudah dilaporkan.
- **`tax_jurisdiction` sengaja TIDAK turun ke perangkat.** Menambah kolom raw table mengubah sidik jari skema lokal, dan itu menuntut `disconnectAndClear()` + unduh ulang katalog di setiap perangkat merchant — biaya nyata untuk kolom yang tidak satu pun layar kasir baca.
- **`totalServiceCharge` masih selalu NOL**: `POST /orders` menulis literal `0` ke `service_charge_amount` (TERVERIFIKASI 2 September 2026). ⛔ **`totalDiskonOrder` TIDAK lagi nol sejak FR-B8/B9 (22 Agustus 2026)** — kalimat ini menyebut keduanya sampai 2 September dan sudah salah selama sebelas hari. Keduanya tetap dilaporkan karena `spec-c:444` menyebutnya. ⛔ Test integrasi untuk keduanya akan hijau karena **hampa**; aturannya diuji di `tests/domain/posisi-penjualan.test.js`.
- **XLSX tidak dibuat.** `spec-c:444` menulis "CSV + XLSX"; XLSX menuntut dependensi baru dan CSV terbuka apa adanya di Excel dan Google Sheets. Batas yang dinyatakan.

**K-06 menerima QRIS statis dan EDC, 22 Agustus 2026.** Server menerima keempat metode sejak sub-project 2; yang tidak ada adalah jalan bagi KASIR memakainya — `MetodeBayar` di klien secara harfiah `'cash'`, jadi merchant yang pelanggannya membayar QRIS mencatatnya sebagai tunai dan saldo laci berbohong sebesar seluruh omzet QRIS.

**Keputusan yang mengikat kode pembayaran di perangkat:**

- ⛔ **Aturan validasi QRIS statis dan EDC hidup di `packages/domain/src/pembayaran-manual.ts`, dan SERVER memakainya juga.** Keduanya berfungsi offline; aturan yang hanya hidup di server berarti kasir mengetik referensi kosong, penjualan tersimpan, dan barisnya berhenti `gagal-permanen` di antrean berjam-jam kemudian — bentuk cacat yang sama dengan refund offline. Kode galatnya ikut dikembalikan: `POSSIBLE_CARD_NUMBER` berbeda dari `VALIDATION_ERROR`, dan menyamakannya membuang satu-satunya sinyal bahwa seseorang mengetik nomor kartu ke POS.
- ⛔ **Non-tunai TIDAK menulis `cash_movement`.** Laci yang naik pada setiap penjualan QRIS membuat tutup kas menuntut otorisasi manajer untuk selisih yang tidak pernah ada — cacat yang PERSIS sama bentuknya dengan yang F3 temukan pada refund tunai, arahnya terbalik.
- ⛔ **Pembulatan tunai berhenti tanpa syarat** (FR-C9). Sebelum metode kedua lahir, membulatkan selalu kebetulan benar; QRIS memindahkan angka, bukan lembaran.
- ⛔ **`tendered_amount` dan `change_amount` NULL untuk non-tunai.** Mengisinya sama dengan `amount` membuat laporan tidak dapat membedakan uang yang benar-benar diserahkan dari nominal transaksi, dan `spec-d:201` memakai perbedaan itu.
- ⛔ **Muatan outbox berbeda PER METODE.** Kartu yang membawa `tenderedAmount` terlihat seperti tunai di setiap laporan yang membacanya.
- ⛔ **`card_last4` dipotong di titik MASUKNYA di layar**, bukan hanya ditolak saat simpan. Membiarkan digit kelima masuk state berarti nomor kartu sempat ada di dalam aplikasi.
- **`LABEL_METODE` satu sumber** (`cetak/metode.ts`), dipakai cetakan pertama dan cetak ulang. Dua peta nama yang menyimpang menghasilkan struk kedua yang menyebut metode berbeda — tepat yang `spec-b:145` larang.

**Pembayaran campuran (FR-C1) ditutup 22 Agustus 2026.** Keputusan yang mengikat kodenya:

- ⛔ **Yang dibulatkan SISA TUNAI setelah bagian non-tunai** (`spec-c:181`), bukan totalnya. Total 93.555 dengan QRIS 50.020 menagih tunai 43.500; membulatkan total lebih dulu menagih 43.580 — 80 rupiah per transaksi. Aturannya di `packages/domain/src/pembayaran-campuran.ts`, dan ia menerima seluruh bagian sekaligus karena menghitung per bagian berarti membulatkan sisa yang belum lengkap.
- ⛔ **Bagian TUNAI dikirim TERAKHIR, dengan rantai `depends_on` eksplisit.** Server menghitung nominal tunai dari `total − SUM(confirmed)` lalu membulatkannya: tunai yang mendarat lebih dulu menagih SELURUH total dan menutup ordernya, lalu bagian QRIS berikutnya **ditolak** — untuk penjualan yang sempurna. Urutan antar-baris outbox tidak dijamin apa pun kecuali `depends_on`.
- ⛔ **`delta` laci adalah BAGIAN TUNAI-nya, bukan `amount_due`.** Kemunculan KETIGA cacat yang sama: `amount_due` pada pembayaran campuran memuat uang yang masuk lewat bank.
- ⛔ **Satu baris `payment` per bagian.** Menggabungkan dua metode menjadi satu baris membuat rekonsiliasi FR-C12 tidak dapat memisahkan uang bank dari uang laci — dua saluran yang settlement-nya berbeda hari.
- ⛔ **Kelebihan bayar non-tunai DITOLAK** (`spec-c:225`), dengan angkanya. Hanya SATU bagian tunai per transaksi.
- ⛔ **`hitungKeranjang` adalah satu fungsi untuk layar dan jalur penulisan.** K-06 harus menampilkan TOTAL sebelum kasir membaginya, dan subtotal belum kena pajak.
- **Penjualan tetap ditulis hanya saat LUNAS.** Order `open` yang tidak pernah dibayar akan muncul di laporan dan belum punya jalan penutupan (KEP-21).

**Modul C selesai. FR-C3 + QRIS dinamis di kasir ditutup 24 Agustus 2026** lewat jalur penjualan **ONLINE-FIRST** — satu-satunya jalur di repo ini yang menulis ke server lebih dulu.

```
cadangkan nomor struk (lokal) → POST /orders (draf, `open`)
  → POST /orders/{id}/payments (qris_dynamic → QR) → polling 2 dtk / maks 5 mnt
  → confirmed → simpanPenjualan({ draf })   ← satu transaksi lokal
```

- ⛔ **`navigator.onLine === true` BUKAN bukti.** Browser melaporkan keadaan ANTARMUKA, bukan keterjangkauan: kafe yang Wi-Fi-nya menyala dengan uplink mati, captive portal yang belum di-login, dan DNS yang tidak menjawab semuanya melaporkan `true`. Ketiganya keadaan nyata di outlet, dan ketiganya membuat QRIS dinamis tampil AKTIF lalu gagal — persis yang `spec-c:272` larang. Arahnya asimetris: `false` **pasti** tidak terjangkau; `true` **belum tahu**, dan yang menjawabnya hanya permintaan yang benar-benar sampai ke `/health` **server kami** (`apps/kasir/src/lokal/keterjangkauan.ts`). `memeriksa` diperlakukan sebagai tidak terjangkau.
- ⛔ **Nomor struk dicadangkan SEBELUM QR diminta**, dan draf yang batal TIDAK menghapus ordernya. Server menuntut `receiptNumber` saat order dibuat dan counternya lokal; pelanggan yang batal membakar satu nomor. Yang tidak boleh terjadi adalah **LUBANG di urutan struk** — 41 dan 43 ada sementara 42 tidak pernah ada di mana pun tidak dapat dijelaskan siapa pun saat diperiksa. Nomor yang melekat pada order `abandoned` jauh lebih baik.
- ⛔ **Payment lokal ditulis `qris_dynamic`, BUKAN `qris_static`.** Keduanya "QRIS" di mata kasir dan sangat berbeda di mata laporan: `qris_static` menandai `confirmed_manually`, dan FR-G5 memakainya sebagai sinyal exception. Menulis pembayaran yang GATEWAY konfirmasi sebagai dikonfirmasi-manual **menuduh kasir atas kontrol yang justru berjalan.**
- ⛔ **`draf` adalah SATU objek, bukan beberapa bendera.** Ia mengubah dua hal yang tidak pernah benar sendirian: identitas tidak di-generate ulang, dan outbox tidak diisi. Outbox dilewati karena PEMBAYARANNYA — relay ulang QRIS dinamis meminta gateway menerbitkan **QR KEDUA untuk uang yang sudah diterima**.
- ⛔ **Draf BERTAHAN di perangkat** (`draf_qris_lokal`, murni lokal) dan disimpan **sebelum** gateway dipanggil — alasan yang sama persis dengan commit `pending_confirmation` di server. `spec-c:328` menuntutnya; K-06 memulihkannya saat dibuka.
- ⛔ **Timeout polling BUKAN gagal**, dan kalimat di layar mengatakannya. Kasir yang membaca "gagal" akan menagih ulang pelanggan yang mungkin sudah membayar. **"Batalkan" hanya ditawarkan saat kita TAHU uang tidak berpindah** (ditolak penerbit / QR kedaluwarsa); selama `pending` yang tersedia adalah menutup layar.
- ⛔ **`POST /orders/{id}/abandon`** — pembersihan massal baru menyentuh order `open` setelah **24 jam** dan menuntut `stock_adjust`. Kasir yang membatalkan di depan pelanggan tidak dapat menunggu keduanya, dan stok yang terkunci sehari membuat produk berikutnya terlihat habis. `tinggalkanOrder` adalah SATU fungsi yang dipakai keduanya; order yang sudah dibayar ditolak **409** (void/refund punya kontrolnya sendiri).
- **QR ditampilkan sebagai TEKS, bukan gambar.** Merender QR menuntut pustaka baru dan stack dikunci. Batas yang dinyatakan.
- **Bentuk SQL `draf_qris_lokal` belum dijalankan di BROWSER** — utang yang dicatat; `ON CONFLICT(id)` pernah ditolak `wa-sqlite`.

**Keputusan produk yang mengikat kode katalog:**

- `item_variation.price` **beku setelah variation dibuat** — ia adalah harga awal, anak tangga paling bawah resolusi. Semua perubahan harga lewat `price_history`. `updateItemVariation` tidak menerima `price`, dan itu permanen, bukan penundaan.
- **Harga terjadwal masa depan diizinkan.** `effective_from` boleh di masa depan; resolusi `effective_from <= at` yang menentukan kapan ia berlaku.
- Aktor perubahan dibaca dari header **`X-Actor-Id`** (`getActorId`), divalidasi ke tabel `"user"` lewat SELECT yang tunduk RLS. Placeholder sampai modul identity ada — satu titik yang nanti diganti ekstraksi token, sejajar dengan `X-Tenant-Id`.

**Modul B (Kasir & Order) sub-project 1 — fondasi order: selesai** (`docs/superpowers/plans/PLAN-ordering-fondasi.md`). `POST /orders` menulis order + check + line + modifier + outbox + idempotency_key dalam **satu transaksi** (invariant #1). Menutup FR-B2, B3, B4, B5, B6, B10, B12 dan sebagian B1.

`packages/domain` akhirnya berisi kode: state machine order, aritmetika uang, generator HLC — semuanya **fungsi murni tanpa I/O**, dibagi server dan klien supaya keduanya tidak pernah menghitung total yang berbeda.

**Tiga aplikasi kini ada**: `apps/kasir` (offline-first, PowerSync), `apps/backoffice` (online-only), `apps/hp` (Owner mobile, online-only). Sesi dan pintu HTTP keduanya yang terakhir dibagi lewat `packages/klien-api`.

**Dua belas modul kini punya kode** (TERVERIFIKASI 2 September 2026): `catalog`, `ordering`, `identity`, `cash`, `tenancy`, `sync`, `inventory`, `audit`, `peripheral`, `payment`, `reporting`, `rilis`. Peta lengkapnya di `apps/server/src/modules/README.md`. Modul-modul kecil itu lahir karena invariant #4 — jalur penjualan menunjuk ke lima modul lain, dan alternatifnya adalah `ordering` meng-query tabel milik semuanya.

**Keputusan yang mengikat kode ordering:**

- **Harga diresolusi pada `occurred_at`, bukan `now()`** (FR-H6, `spec-h:77`). Order yang antre offline berjam-jam dihitung dengan harga saat penjualan terjadi. Klien yang tidak mengirim `occurredAt` tetap memakai jam database, persis seperti sebelumnya. Ini memperkenalkan **jam ketiga** — jam perangkat klien — dan risikonya dicatat di `HANDOFF.md`.
- **Selisih hitungan klien TIDAK PERNAH menolak transaksi** (`spec-h:95`). Yang tersimpan selalu hitungan server; selisihnya ditandai `has_calculation_variance` + `variance_amount` + `audit_event` bertipe `calculation_variance`. Menolak berarti kehilangan penjualan yang uangnya sudah diterima merchant.
- **Selisih dianggap terjelaskan hanya bila DUA syarat terpenuhi**: setiap harga yang dipakai klien pernah benar-benar berlaku pada-atau-sebelum `occurred_at`, **dan** total klien konsisten dengan harga-harganya sendiri. Memeriksa syarat pertama saja meloloskan klien yang aritmetikanya salah — ditemukan lewat sabotase, bukan review.

- **`item_variation.price` beku setelah dibuat** — lihat bagian katalog di atas; `order_line.unit_price` adalah snapshot hasil `resolvePrice`, bukan pembacaan langsung.
- **Waktu selalu dari jam database, tidak pernah `new Date()` di Node.** Dipelajari dari bug nyata: resolusi harga menstempel `effective_from` dengan jam PostgreSQL tapi membaca `at` dari jam Node — skew ±2 ms cukup membuat harga yang baru ditulis dianggap belum berlaku, 4 dari 12 run gagal. Di produksi keduanya mesin terpisah. Berlaku juga untuk `occurred_at`, `expires_at`, dan seterusnya.
- **HLC**: satu instance dibuat di `buildApp` dengan clock di-inject di batas itu; domain tetap murni. Klien mengirim `hlc` → `update()`, tidak mengirim → `tick()`.
- **Idempotency**: key di-*claim* lebih dulu (INSERT `response_status = NULL`), order ditulis, lalu key di-*complete*. Urutan ini penting — kalau key ditulis terakhir, PK milik `order` sendiri yang memenangkan balapan dan klien menerima `ID_ALREADY_EXISTS`, bukan `409` idempotency dengan instruksi retry.
- **Cache hit mengembalikan `response_status` yang tersimpan** (jadi `201`), bukan `200`. `spec-b:336` menulis "status 200" sementara `spec-b:325` menulis "mengembalikan respons asli" dan skema menyediakan kolom `response_status` justru untuk itu. **`[ASUMSI]` — belum kamu putuskan.**

**Keputusan yang mengikat kode pajak dan pembayaran:**

- **Tarif tidak pernah float.** `tax_rate.rate` dan `outlet.service_charge_rate` adalah `numeric(6,4)`; di domain keduanya `bigint` berskala 10.000 (10% → `1000n`). Konversinya di `packages/domain/src/numeric.ts`, dibagi server dan klien. Float **terbukti aman** di skala ini — diuji atas seluruh 1.000.000 nilai — jadi alasannya bukan presisi, melainkan agar aturan "jalur uang tidak menyentuh float" tidak punya pengecualian yang akan disalin ke kolom lain.
- **`total` tidak pernah dibulatkan.** Yang dibulatkan `amount_due`, dan hanya **saat ada pembayaran tunai** (FR-C9). Pembulatan karena itu mustahil dihitung saat order dibuat, dan `computeOrderTotals` tidak menerima `roundingIncrement` sama sekali.
- **Pembulatan uang dilakukan per langkah** FR-C8, bukan sekali di akhir.
- **`order.tax_amount` = `totalTax`** (seluruh pajak, untuk struk); yang **menambah** total hanya `totalTaxExclusive`. Menukar keduanya menggandakan pajak inklusif.
- **`payment` PK-nya `(id, occurred_at)`**, bukan `id` saja — tabelnya dipartisi. Berbeda dari `order`. Yang melindungi retry pembayaran adalah **Idempotency-Key**, bukan primary key: satu lapisan lebih sedikit daripada yang dimiliki order.

**Modul B sub-project 3 — void & refund (FR-B7): selesai** (`docs/superpowers/plans/PLAN-void-refund-gateway.md`). Satu endpoint `POST /orders/{id}/cancel`; **server** yang memilih operasi dari status order, bukan kasir (`spec-b:235`). Void dan refund menulis order pembatal / baris `refund` + `stock_movement` + `audit_event` + outbox + idempotency_key dalam **satu transaksi**.

`inventory` dan `audit` lahir sebagai irisan minimal, masing-masing satu fungsi — keputusan 1 Agustus menghapus PIN dari void, jadi restock dan audit adalah kontrol yang tersisa untuknya, bukan pelengkap.

**Keputusan yang mengikat kode void & refund:**

- **`voided_by_order_id` ada di order PEMBATAL**, menunjuk order yang dibatalkan. Arahnya **dipaksa** AC FR-B7 pertama ("tidak ada `UPDATE` pada order asli") — pembatalnya belum ada saat order asli ditulis, jadi tidak ada arah lain yang mungkin. Namanya terbaca terbalik; itu utang yang dicatat di `HANDOFF.md`, bukan kekeliruan implementasi.
- **Order yang sudah di-void tetap berstatus `open`.** Konsekuensi langsung dari aturan di atas. Yang menolak void kedua adalah `SELECT` di aplikasi **dan** index unik `ux_order_voided_by` (migrasi `0017`). Jangan pernah menyimpulkan "order ini sah" dari `status = 'open'` saja.
- **Refund tidak membuat `payment` negatif** (keputusan user 7 Agustus 2026). `payment.amount` punya `CHECK (amount > 0)` dan itu dipertahankan; arah berlawanan dinyatakan lewat baris `refund`. `spec-b:230` yang menulis "payment negatif" karena itu tidak akurat terhadap kode.
- **Refund sebagian wajib menyebut `lines`.** Tanpa itu server harus menebak apakah barang fisik kembali ke rak. `lines: []` berarti uang kembali tanpa barang kembali.
- **Void berjalan tanpa `X-Approver-Id`; refund selalu menuntutnya.** Header itu diabaikan pada jalur void. Bahwa penyetuju berbeda dari aktor ditegakkan `CHECK` di `audit_event` — **database**, bukan aplikasi.

**Exit criteria F1 terpenuhi.** Satu penjualan tersimpan atomik dengan pajak benar, dapat dibayar tunai/QRIS/EDC, dan dapat dikoreksi lewat void & refund. `ARCH:395` menuntut modul `payment` — ia ada, beserta port gateway-nya. C-3 (rekonsiliasi dan ekspor) ditutup 21 Agustus 2026.

---

## F2 — kepemilikan database lokal, diputuskan 7 Agustus 2026

**PowerSync memegang database lokal. Seluruh tabel kami yang direplikasi didaftarkan sebagai `withRawTables`, bukan tabel PowerSync biasa.** Ini memperjelas baris "DB lokal" di tabel stack; ia bukan pilihan baru, melainkan jawaban atas siapa yang memegang koneksinya.

Dibuktikan dengan menjalankan kode, bukan membaca dokumentasi — `prototypes/04-powersync-raw-tables/FINDINGS.md`.

**Yang mengikat kode klien:**

- **Tabel kami WAJIB raw table.** Mendeklarasikannya sebagai tabel PowerSync biasa membuat core membuat VIEW bernama sama di atas `ps_data__<nama>`, dan ia bertabrakan dengan tabel nyata kami. Tabrakannya gagal keras saat boot — bukan diam-diam.
- **Raw table wajib punya kolom `id`.** Bukan konvensi kami; core menolaknya (`Table X has no id column.`). PK komposit tidak cukup.
- **Tabel murni lokal TIDAK didaftarkan sama sekali.** `outbox_local`, `stock_snapshot`, `device_config` aman justru karena PowerSync tidak tahu keduanya ada — `powersync_replace_schema` hanya menyentuh objek yang cocok `GLOB 'ps_data_*'` atau view bertanda `-- powersync-auto-generated`.
- **Jangan pasang trigger CRUD PowerSync.** Penulisan lokal ke raw table ditangkap **hanya** lewat `powersync_create_raw_table_crud_trigger`. Tidak memasangnya adalah yang membuat `outbox_local` + REST idempoten tetap satu-satunya jalur naik. Memasangnya berarti membangun jalur naik kedua yang diam-diam.
- **Satu penjualan tetap satu `writeTransaction`** — `BEGIN IMMEDIATE`/`COMMIT` sungguhan dengan kunci global. Invariant #1 tidak berubah bentuknya.
- **`enableMultiTabs` di-set eksplisit**, tidak diandalkan pada default. Ia yang memenuhi pola satu-penulis; tanpanya tab kedua mematikan aplikasi (prototipe 03 §3).
- **`worker: { format: 'es' }` di setiap Vite config yang memuat PowerSync.** Sudah dipasang di `apps/kasir`. `vite dev` hijau tanpanya; hanya build rilis yang gagal.

**Harganya terukur, dan bukan nol:** 12,33 ms per penjualan versus 3,25 ms lewat driver mentah — 3,8×. Terbukti **bukan** karena raw table. Masih jauh di bawah ambang yang terlihat kasir, tapi angka itu dari mesin pengembangan.

**Jalur turun sudah dijalankan** terhadap PowerSync Open Edition self-hosted — `prototypes/05-powersync-jalur-turun/FINDINGS.md`. Katalog turun ke raw table kami, `item_modifier_list` utuh, perubahan berjalan sampai tanpa reload. Dua hal dari sana **mengikat kode klien**, dan keduanya tidak terlihat sampai diuji:

- ⛔ **Sync rules adalah SATU-SATUNYA batas tenant pada jalur turun.** Role replikasi wajib `BYPASSRLS` — replikasi logis membaca WAL, dan RLS tidak berlaku di sana. Invariant #8 tidak menjaga apa pun pada jalur ini. Sabotase membuktikannya: satu `WHERE tenant_id = auth.parameter('tenant_id')` dilepas dari satu baris, dan katalog merchant lain mendarat di perangkat yang salah tanpa satu pun error. Pemeriksaan isolasi karena itu harus menyentuh **setiap tabel** — kebocoran satu tabel tidak terlihat oleh pemeriksaan pada tabel lain.
- ⛔ **Membangun ulang raw table lokal TIDAK memicu unduh ulang.** Checkpoint PowerSync hidup di tabel `ps_*`, terpisah dari tabel kami; `waitForFirstSync()` selesai dalam 0 ms dan **melaporkan sukses** sementara katalog kosong permanen. Setiap migrasi skema lokal yang menyentuh raw table wajib diikuti `disconnectAndClear()`.

- ⛔ **Stream `riwayat` ada supaya `disconnectAndClear()` tidak permanen** (29 Agustus 2026). Migrasi `0035` menyentuh `order_line` — raw table — jadi setiap perangkat membangun ulang tabel rawnya dan **riwayat penjualan lokalnya hilang**; tanpa jalan pulang, K-08 dan cetak ulang K-09 untuk penjualan lama berhenti bekerja permanen. Enam tabel turun: `order` · `check` · `order_line` · `order_line_modifier` · `payment` · `refund`. Jalur NAIK tidak berubah sama sekali — penjualan tetap naik lewat `outbox_local` + REST idempoten.
  - ⛔ **Disaring per PERANGKAT (`device_id`), bukan per outlet.** Ia memulihkan TEPAT yang hilang; scope per outlet membuat K-08 menampilkan penjualan perangkat LAIN — perubahan perilaku yang tidak seorang pun minta, diselundupkan lewat task pemulihan.
  - ⛔ **TANPA batas tanggal.** Cutoff yang dihitung dari jam server berubah setiap penerbitan ulang token, dan setiap nilai parameter berbeda adalah **bucket PowerSync berbeda** — perangkat mengunduh ulang seluruh riwayatnya setiap hari. Volumenya dibatasi scope perangkat.
  - ⛔ **`cost_at_sale` TIDAK turun** (FR-F5), dan penjaganya sempat **buta**: polanya `/\bcost\b/`, yang tidak cocok dengan `cost_at_sale` karena `_` adalah word character. Kini SUBSTRING — tidak ada kolom sah ber-`cost` yang boleh turun, dan pola yang menuntut ketepatan nama akan dilewati oleh nama berikutnya.
  - ⛔ **`voided_by_order_id` WAJIB turun.** Order yang di-void tetap berstatus `open` (AC FR-B7 pertama), jadi status diturunkan dari ada/tidaknya pembatal; tanpa kolom itu order yang dibatalkan tampil NORMAL di K-08 dan dapat dicetak ulang sebagai struk yang sah. `card_last4` tidak turun.
  - ⛔ **Klaim `device_id` di JWT dijaga penjaga SILANG** — `auth.parameter('x')` di sync rules wajib punya `x` di `tokens.ts`. Dua berkas yang tidak ada apa pun menyatukannya, dan yang tidak sepakat menghasilkan **NOL BARIS, bukan error**.
  - ⛔ **`tabelDari` di penjaga sync-rules wajib `\bFROM`.** Tanpa `\b`, potongan `from` di dalam nama kolom (`effective_from`) membuat regexnya menangkap kata `FROM` sebagai nama tabel — dan penjaga tenant **melewati query `price_history` sepenuhnya**. Ditemukan dengan mencetak apa yang parser lihat, bukan dengan memercayai suite hijau.
  - **Batas yang dinyatakan:** stream ini **belum pernah dijalankan terhadap PowerSync sungguhan** (Docker tidak tersedia). `order_line.modifier_snapshot` (`jsonb`→`TEXT`) dan `is_tax_inclusive` (`boolean`→`INTEGER`) masih di `KOLOM_BELUM_DIUKUR`, dan stream ini yang pertama menjalankan keduanya menembus PowerSync.

- ⛔ **Setiap kolom yang tipenya berbeda antara PostgreSQL dan skema lokal wajib punya `put` raw table yang DITULIS SENDIRI.** `put` yang disimpulkan PowerSync menyalin nilai apa adanya. Terukur pada `tax_rate.rate` (`numeric(6,4)` di server, `INTEGER` ×10000 di lokal): `0.1100` mendarat sebagai `0.11` — 10.000× terlalu kecil — **dan tersimpan sebagai `real` di kolom `INTEGER`** tanpa satu pun error, karena affinity SQLite hanya mengubah nilai bila lossless. Perbaikannya `CAST(ROUND(? * 10000) AS INTEGER)` di dalam `put`. Kolomnya tetap terlihat `INTEGER` di skema dan `typeof` JavaScript tetap `number`; hanya `typeof()` SQLite yang membedakannya.

Bucket storage boleh PostgreSQL — MongoDB tidak wajib. `client_auth.jwks` menerima kunci inline; di produksi ia harus **asimetris** dan dicetak server kami.

**Pondasi `apps/kasir` berdiri, 8 Agustus 2026** (`docs/superpowers/plans/PLAN-pondasi-kasir.md`). Kerangka penuh, nol layar fitur: router buatan sendiri dari IA §7, shell kasir, skema raw table + penjaga drift, migrasi lokal, adapter `DbLokal`, dan penjadwal relay. Semuanya modul murni yang diuji `node --test`; yang hanya browser dapat buktikan dijalankan lewat `apps/kasir/harness.html`.

**Yang mengikat kode klien, dan tidak terlihat sampai dijalankan:**

- ⛔ **VFS di-set eksplisit `OPFSWriteAheadVFS`, dan itu BUKAN default paket.** Default `@powersync/web@2.1.1` adalah `IDBBatchAtomicVFS` — IndexedDB. Prototipe 04/05 tidak pernah menyetel `vfs`, jadi **seluruh angkanya angka IndexedDB**, termasuk 12,33 ms dan perbandingan 3,8×; angka prototipe 03 (`opfs-sahpool`) datang dari pustaka berbeda dan tidak sebanding dengan keduanya. Diukur ulang lewat PowerSync, tiga run, beban yang sama: **p50 26,8–28,5 ms (IndexedDB) · 7,0–9,1 (OPFSCoopSync) · 9,0–11,8 (AccessHandlePool) · 4,5–5,1 (OPFSWriteAhead)**. Dua tab tetap aman di atas OPFS — diuji terpisah, bukan diasumsikan dari prototipe 04.
- ⛔ **`watch()` PowerSync butuh ~1.000 ms untuk melihat perubahan raw table** (diukur sembilan kali; `throttleMs` tidak berpengaruh), sementara `spec-h:224` menuntut indikator diperbarui **< 1 detik**. Perubahan yang lewat kode kita karena itu mengirim isyarat baca-ulang lewat `buatPemberitahu()`; datanya tetap dibaca dari SQLite. `watch()` tidak diganti — ia satu-satunya yang melihat perubahan dari luar (katalog turun, tab lain).
- **Interval relay 15 detik adalah BATAS ATAS, bukan denyut.** Jeda berikutnya mengikuti tangga backoff `spec-h:62`; denyut tetap membuat anak tangga 2/4/8 detik tidak pernah tercapai. Koneksi yang kembali menjalankan putaran segera tapi **tidak** mereset backoff item.
- **Setiap raw table punya `put` yang ditulis sendiri, termasuk tabel yang seluruh kolomnya sepakat.** Kalau hanya tabel bermasalah yang punya, kolom berskala yang ditambahkan kelak ke tabel "aman" diam-diam kembali memakai jalur yang disimpulkan. Perbandingan DDL PostgreSQL vs SQLite menemukan **dua kolom lagi** berbentuk cacat yang sama dengan `tax_rate.rate`: `item_variation.conversion_factor` (`numeric` → `INTEGER` ×1000) dan `order_line.tax_rate` (`numeric(6,4)` → ×10000). Keduanya belum pernah turun; keduanya akan salah.
- **Versi skema lokal adalah sidik jari, bukan nomor.** Dihitung dari nama + kolom raw table, disimpan di `skema_lokal`. Nomor versi harus diingat untuk dinaikkan; yang lupa dinaikkan menghasilkan tepat keadaan paling berbahaya di jalur turun.
- **Rencana DDL tidak pernah men-drop tabel murni lokal.** `outbox_local` adalah antrean penjualan yang belum terkirim; men-drop-nya saat migrasi menghapus uang merchant yang tidak tercatat di mana pun.
- **`disconnectAndClear()` dijalankan sebelum DDL**, mengikuti urutan yang diukur di prototipe 05 — bukan urutan yang terasa logis.
- **`uploadData` connector GAGAL KERAS bila antrean CRUD PowerSync tidak kosong.** Ia seharusnya selalu kosong (trigger tidak dipasang); kalau tidak, jalur naik kedua sudah lahir tanpa disengaja.
- **Token PowerSync tidak pernah dicetak di klien.** Ia diminta ke server (Modul F). Ada test yang memindai seluruh `apps/kasir/src` untuk operasi penandatanganan.
- **`AppShell` bukan untuk kasir.** IA §2.1: "Kasir tidak punya sidebar." Penggantinya `ShellKasir`.
- **`<Button>` design system TIDAK boleh menerima `onClick` atau `disabled`.** `_adherence.oxlintrc.json` membatasi propsnya ke `variant`/`critical`/`fullWidth`/`className`/`style`, dan `lint:ds` menolak sisanya — meski komponennya me-spread `...rest` dan akan bekerja. Tombol interaktif memakai `apps/kasir/src/Tombol.tsx`, yang merender `<button className="btn btn-…">` persis seperti `SyncIndicator` sendiri melakukannya.

**FR-H2 & FR-H3 selesai, 8 Agustus 2026** (`docs/superpowers/plans/PLAN-status-sinkronisasi.md`). Indikator di topbar tersambung ke antrean sungguhan dan dapat diklik menuju K-14; layar K-14 menampilkan jumlah, umur tertua, daftar gagal ber-halaman, penggunaan storage, dan ekspor darurat.

- **Latensi indikator 1–2 ms lewat `pemberitahu`, 980 ms lewat `watch()`** — diukur terhadap DOM sungguhan di `harness-h2.html`. AC `spec-h:224` (< 1 detik) hanya terpenuhi lewat jalur pertama.
- **Konsol devtools tidak dapat dipakai mengukur apa pun yang menyentuh singleton modul.** `import()` dari konsol mendapat instance modul KEDUA (Vite `?t=` setelah HMR), jadi `buka()` memoisasi terpisah dan pengukurannya diam-diam berpindah ke jalur lain. Terbukti dari `jumlahPelanggan: 0`.
- **`setTimeout` di-clamp ~1.000 ms di tab yang tidak di depan.** Setiap pengukuran latensi di browser wajib memakai `MutationObserver`, bukan poll timer — poll 10 ms melaporkan 991 ms untuk sesuatu yang sebenarnya 1 ms.
- **Teks `failed` design system hanya lengkap bila `onRetry` diberikan.** "Coba lagi" adalah tombol di dalam komponen, bukan label; tanpanya `spec-h:216` tidak terpenuhi. Karena itu pembungkus indikator `span role="button"` — tombol di dalam tombol tidak sah.
- **`tertuaPada` dihitung HANYA dari item yang belum terkirim.** Dari seluruh baris, satu item lama yang sudah `sent` membuat antrean sehat terbaca berumur satu hari — dan `spec-h:302` memakai umur itu sebagai ambang 4/24/72 jam.
- **Status per-record memakai aturan terburuk-menang.** Satu order punya beberapa baris outbox (`payment` dan `order_cancel` memakai `entity_id` yang sama); order yang pembayarannya gagal terkirim tidak boleh terlihat `ok`.

**FR-F12 (token perangkat) ditarik dari F3 ke F2, 8 Agustus 2026** (`docs/superpowers/plans/PLAN-fr-f12-token-perangkat.md`). **Hanya FR-F12** — bukan peran, PIN, step-up, audit, atau akses support; sisa Modul F tetap di F3. Ia ditarik karena ia satu-satunya potongan yang menutup ⛔ token PowerSync, dan karena skemanya (`device.token_hash`, `credentials_expire_at`, `last_seen_at`, `revoked_at`) sudah ada sejak F0.

- **Token sinkronisasi dicetak SERVER dengan RS256**, kunci dari `POWERSYNC_JWT_PRIVATE_KEY`, JWKS di `GET /.well-known/jwks.json`. Ditandatangani `node:crypto` — nol dependensi baru. Klien tidak pernah memegang bahan rahasia; ada test yang memindai `apps/kasir/src` untuk operasi penandatanganan.
- ⛔ **`tenant_id` dan `outlet_id` adalah klaim TOP-LEVEL, bukan di dalam objek `parameters`.** Diukur di prototipe 05: `auth.parameter('x')` membaca `payload.x`. Salah tempat berarti sync rules mencocokkan dengan `undefined`, dan yang turun bukan error melainkan **nol baris** — katalog kosong permanen tanpa satu pun keluhan.
- **Secret perangkat di-hash SHA-256, bukan Argon2id.** Aturan Argon2id berlaku untuk password dan PIN — rahasia berentropi rendah yang dipilih manusia. Secret ini 256 bit dari CSPRNG; KDF lambat tidak membeli apa pun dan diverifikasi pada setiap permintaan token. Yang tetap berlaku: tidak pernah disimpan apa adanya, dan dibandingkan timing-safe.
- **`POST /devices/{id}/sync-token` TETAP menuntut `X-Tenant-Id`.** Webhook Midtrans tetap satu-satunya endpoint tanpa header itu. Perangkat tahu tenant-nya sendiri, dan menyertakannya menjaga pencarian tetap tunduk RLS; berbohong hanya membuat device id-nya tidak ditemukan.
- **Kunci kosong → 503, bukan gagal saat boot.** Berbeda dari adapter pembayaran, dan sengaja: gagal boot akan menuntut setiap test dan setiap lingkungan pengembangan menyediakan kunci RSA untuk endpoint yang tidak dipakainya.
- **Kredensial yang hilang dijawab 401, bukan 400.** Karena itu header `Authorization` tidak ditandai `required` di OpenAPI — validator akan menjawab 400, dan 400 berarti "permintaan cacat" sementara yang dimaksud adalah "buktikan siapa kamu".

**Jalur turun berjalan lewat aplikasi sungguhan, 8 Agustus 2026.** Stack PowerSync prototipe 05 + server kami + `apps/kasir`: `terhubung: true`, ketujuh tabel katalog turun ke raw table kami, isolasi tenant menahan (tenant lain nol baris). `client_auth.jwks` inline di prototipe diganti `jwks_uri` yang menunjuk server kami — **tidak ada lagi bahan rahasia di konfigurasi PowerSync**.

- **Kedua kolom berskala terbukti benar di aplikasi**: `tax_rate.rate` mendarat `1100` bertipe `integer` (bukan `0.11` bertipe `real`), dan `item_variation.conversion_factor` mendarat `1000` (bukan `1`). Yang kedua ditemukan lewat perbandingan DDL dan belum pernah terukur sampai sekarang.
- **CORS wajib, dan daftarnya dari `CORS_ORIGINS`** — bukan dari kode (invariant #5). Kosong = tidak ada origin yang diizinkan; `*` tidak pernah dijawab. Tanpa ini aplikasi kasir tidak dapat mencapai server sama sekali.
- **Perubahan bentuk tabel LOKAL-SAJA tidak terlihat sidik jari skema.** Ia hanya menghitung raw table. Migrasi tabel lokal karena itu ADITIF (`ALTER TABLE ADD COLUMN`) dan berjalan di setiap boot — `outbox_local` memegang penjualan yang belum terkirim, `device_config` memegang `receipt_sequence`. ALTER tidak dapat mengubah primary key; kalau itu yang berubah, database lama harus dibuang.
- ⛔ **Test klien berjalan di atas SQLite yang BERBEDA dari aplikasi.** `ON CONFLICT(id)` diterima `node:sqlite` dan DITOLAK `wa-sqlite` — seluruh test hijau, hanya aplikasinya yang gagal. Bentuk SQL baru wajib dijalankan di browser sebelum dipercaya.
- **Aktor dibekukan saat item outbox DIBUAT** (`outbox_local.actor_id`), bukan dibaca saat dikirim. Antrean yang terkuras setelah pergantian shift akan menisbatkan penjualan ke kasir yang salah.
- ⛔ **`@powersync/web` mengembalikan kolom `INTEGER` yang besar sebagai `bigint`, bukan `number`.** Diukur dari database sungguhan, bukan dibaca dari dokumentasi. Konsekuensinya setiap pembacaan kolom numerik besar harus menerima **ketiga** bentuk — `bigint`, `number`, dan `string` — karena driver test (`node:sqlite`) dan driver aplikasi tidak sepakat. Guard yang hanya memeriksa `number` **tidak pernah mengambil cabangnya**, dan itu hijau di seluruh test sambil salah di aplikasi. Ditemukan saat menutup I10 di jalur produksi.
- ⛔ **HLC klien disimpan sebagai TEXT (`device_config.hlc_teks`), bukan di kolom `INTEGER`.** HLC 57-bit melampaui 2⁵³ untuk setiap nilai nyata (physical = milidetik epoch, digeser 16 bit counter), jadi kolom `INTEGER` mengembalikannya lewat double dan presisinya hilang. Kolom `hlc_state` lama dipertahankan hanya untuk perangkat yang sudah ada — `device_config` murni lokal dan bermigrasi **aditif**, dan SQLite tidak dapat mengubah tipe kolom. Gejala aslinya: setelah restart dengan jam yang sedang mundur, HLC **turun**, tanpa satu pun error.
- **Keadaan HLC ditulis DI DALAM transaksi penjualan.** Di luar transaksi ada jendela tempat perangkat dapat mati setelah order ter-commit tapi sebelum `hlc_teks` tersimpan; boot berikutnya memuat nilai lama, dan tick berikutnya dapat menghasilkan HLC yang **sudah dipakai** order yang sudah ada. Dua order ber-HLC sama adalah pelanggaran I10 yang tidak menghasilkan error — ia hanya membuat "mana yang lebih dulu" tidak terjawab, di tempat yang paling membutuhkannya.
- ⛔ **Fake `DbLokal` tidak menegakkan constraint apa pun.** `NOT NULL`, `CHECK`, dan `ON CONFLICT` semuanya lolos di test dan gagal keras di `wa-sqlite`. Terjadi dua kali: `ON CONFLICT(id)` (8 Agustus) dan `audit_event.tenant_id = NULL` (14 Agustus). Test karena itu harus memeriksa **nilai yang di-bind**, bukan sekadar bahwa tabelnya disentuh — dan bentuk SQL baru tetap wajib dijalankan di browser sebelum dipercaya.
- ⛔ **Fake juga tidak menegakkan `ORDER BY`.** Jaminan urutan yang hanya hidup di SQL tidak dapat diuji sama sekali. Kalau urutannya penting bagi pengguna, ia dimiliki di JS di titik data disusun — `katalog/baca.ts` (modifier, karena dikelompokkan ulang) dan `riwayat/baca.ts` (SQL memilih baris mana lewat `LIMIT`, JS menjamin urutan tampil).
- **Keranjang K-03 BERTAHAN melewati muat ulang sejak 24 Agustus 2026 (KEP-21)** — lewat tabel murni lokal `keranjang_lokal` + `kasir/keranjang-simpan.ts`. `simpanan.ts` tetap memori-saja (ia dipanggil dari render React dan harus sinkron; I/O di balik setter sinkron menghasilkan kegagalan tulis yang tidak dapat ditangani siapa pun).
  - ⛔ **Pembersihannya ada DI DALAM transaksi penjualan.** Membersihkan sesudah commit meninggalkan jendela tempat perangkat dapat mati di antaranya, dan boot berikutnya memulihkan keranjang untuk penjualan yang **sudah dibayar** — kasir menagih pelanggan berikutnya dua kali tanpa satu pun error. Alasan yang sama persis dengan `simpanHlc`.
  - ⛔ **BUKAN `order` berstatus `open`.** ERD menyiapkan `order.status = 'open'` + `owned_by_device_id` untuk ini, dan jalan itu sengaja tidak diambil: baris `order` akan terkirim ke server, dan order `open` yang tidak pernah dibayar muncul di laporan tanpa jalan penutupan. Berbagi order antar device saat offline tetap non-goal v1 (`PRD` § 4).
  - ⛔ **`JSON.stringify` MELEMPAR pada `bigint`**, dan keranjang berdiskon punya dua. Tanpa replacer, keranjang berdiskon adalah satu-satunya yang tidak dapat disimpan — persis yang paling mahal dimasukkan ulang. Uang ditulis sebagai string; `number` ditolak saat memulihkan.
  - ⛔ **Keranjang milik shift LAIN tidak pernah dipulihkan**, dan barisnya dibuang. **Penulisan baru dimulai setelah pemulihan selesai** — efek yang menulis sejak render pertama menyimpan keranjang kosong lebih dulu, dan keranjang kosong menghapus barisnya. **Pemulihan disebutkan di layar**; keranjang yang muncul sendiri terbaca seperti pesanan pelanggan yang sedang berdiri di depan kasir.
  - K-06/K-07 **tetap tanpa URL** (`IA:§7`). Alasannya berubah, kesimpulannya tidak: memulihkan kasir langsung ke layar pembayaran menempatkannya di depan angka yang harus ditagih tanpa sempat memeriksa pesanan yang baru dipulihkan.
  - **X6 (FR-G5) tetap tidak dapat dibangun** — ia menuntut RIWAYAT perubahan keranjang, bukan keadaannya.

## F4 — keputusan yang mengikat kode

**Rantai cetak: `ReceiptDocument` → `ReceiptRenderer` → `PeripheralPort`** (`ARCH:199-200`). Dokumen deskriptif dulu, byte belakangan — `ARCH:204` menyebut alasannya: tanpa pemisahan itu, mendukung printer fiskal berarti menyentuh layar kasir.

- ⛔ **Invariant #3 ditegakkan di DUA tempat.** `cetakStruk` tidak pernah melempar (lemparan apa pun jadi `HasilCetak`), dan cetak berjalan SETELAH `db.transaction` ter-commit. Satu saja tidak cukup: lemparan yang lolos naik ke alur penjualan, dan cetak di dalam transaksi membuat kertas habis me-rollback penjualan yang uangnya sudah masuk laci.
- **Kegagalan cetak DIKEMBALIKAN, bukan didiamkan.** Layar harus dapat berkata "struk gagal dicetak, transaksi tersimpan". `tanpa_printer` dibedakan dari `gagal` — merchant tanpa printer adalah kasus sah.
- **Renderer MURNI.** Tanpa jam, tanpa acak. FR-B11 menuntut cetak ulang identik dengan cetakan pertama; renderer yang menyentuh `Date.now()` membuat itu mustahil dibuktikan.
- ⛔ **Perintah printer datang dari PROFIL, tidak pernah dari renderer** (`ERD:445`: "Data, bukan kode"). `printer_profile` diturunkan sebagai tabel; baseline 58/80 mm ikut di kode hanya supaya perangkat tanpa profil tersinkron tetap dapat mencetak.
- ⛔ **Transliterasi terjadi SEBELUM hitungan lebar.** `…` panjangnya 1 karakter di JavaScript tetapi mencetak 3; menerjemahkan belakangan membuat baris yang dihitung "pas 32" mencetak 34, dan printer melipatnya sendiri.
- **Dua kolom dipotong di KIRI**, tidak pernah di angkanya — memotong dari kanan menghasilkan "Rp 25.0", struk yang menyebut harga salah.
- **Cetak ulang tidak menyentuh satu pun tabel katalog** (`spec-b:145`), diuji dari tabel yang benar-benar disentuh query. Konsekuensinya: baris pajak pada cetak ulang berbunyi "Pajak" tanpa nama tarif — nama tarif hidup di `tax_rate`, dan meresolusinya melanggar aturan itu. **Batas yang dinyatakan**, bukan kelalaian.
- `print_job` **murni lokal**: struk adalah artefak perangkat, dan printer yang gagal di kasir 1 tidak dapat dicetak ulang oleh kasir 2.

**⛔ Penjaga sync-rules kini menurunkan aturannya dari DDL.** Aturannya bukan lagi "setiap query menyaring tenant" melainkan "setiap query atas tabel **ber-tenant** menyaring tenant", dan daftar tabel ber-tenant dibaca dari `db/migrations/*.sql`. Diperlukan karena `printer_profile` dikecualikan dari RLS dan tidak punya `tenant_id` sama sekali. Daftar pengecualian yang ditulis tangan akan bertambah panjang sampai penjaganya tidak menjaga apa pun.

---

## F3 — keputusan yang mengikat kode

**Buku kas (`cash_movement`) adalah SATU-SATUNYA definisi saldo laci** (`spec-d:14`). `saldo_awal + SUM(delta)`, tidak ada sumber kedua. Ia ditulis di transaksi yang sama dengan penjualan/refund/buka-shift, di **kedua sisi**, dari aturan yang sama di `packages/domain/src/buku-kas.ts`.

- ⛔ `saldoSeharusnya` **mengecualikan** tipe `opening_float` dan memakai `shift.opening_float` langsung. Menjumlahkan keduanya menghitung modal awal dua kali, dan setiap shift terlihat kelebihan sebesar modalnya sendiri. Pengecualian yang sama berlaku di **setiap** test yang menjumlahkan `delta` per shift.
- `delta` memakai nilai transaksi, bukan `tendered_amount` (`spec-d:201`). Kembalian tidak menghasilkan movement terpisah.
- **`refund.method` ditambahkan** (migrasi `0021`, keputusan user 14 Agustus). Hanya refund tunai mengurangi laci. Nilainya diturunkan dari payment order aslinya lewat `metodeRefundDari` — dibagi server dan klien — lalu **disimpan**, bukan disimpulkan ulang saat dibaca. Pembayaran campuran **melempar**, tidak menebak (`spec-d:207`).
- ⛔ **Backfill lintas-tenant mustahil lewat DML.** `UPDATE` ditolak `FORCE ROW LEVEL SECURITY` yang berlaku untuk owner juga, sementara `app.tenant_id` hanya dapat bernilai satu tenant. Jalannya `ADD COLUMN … DEFAULT` (DDL, tidak lewat RLS) lalu **DROP DEFAULT** — default yang tertinggal membuat klien yang lupa mengirim `method` diam-diam mencatat refund tunai.

**`posisi-penjualan.ts` adalah satu-satunya definisi omzet** (FR-G3). Setiap laporan memanggilnya; ada penjaga yang menolak `SUM(...)` atas tabel `"order"` di berkas mana pun selain itu.

- ⛔ **Definisi kanonik `spec-g:34` ditulis untuk skema yang bukan skema ini.** Void tidak mengubah status order aslinya (AC FR-B7 pertama), jadi membaca `status IN ('PAID','CLOSED')` harfiah membuat order yang **sudah dibatalkan tetap masuk omzet kotor**. Yang dipakai: order dianggap batal bila ADA pembatal yang menunjuknya. Penerjemahan ke skema, bukan perubahan spec.
- Omzet bersih boleh **negatif**, tanpa clamp (`spec-g:283`). Sama seperti saldo laci.
- Refund atas order yang dibatalkan **tidak** dikurangkan lagi — ordernya sudah keluar dari omzet kotor.
- **Penjaga satu-sumber polanya diubah dari yang ACnya sebut.** `status = 'voided'` muncul sah di jalur penulisan; meng-grepnya menandai kode benar. Versi pertama penjaga menandai `SUM(amount)` apa pun dan menemukan tiga tempat yang semuanya sah (sisa refund, sisa tagihan). Dipersempit ke `SUM(...)` atas `"order"`, **bukan** dilonggarkan lewat daftar pengecualian: penjaga yang menandai kode benar akan dimatikan orang berikutnya.
- **`basis` laporan per produk adalah `sebelum void & refund`**, dan itu bukan kelalaian: baris produk menyatakan barang apa yang keluar, dan refund uang tidak selalu mengembalikan barang (`lines: []`).
- Tanggal bisnis **dibaca** dari `order.business_date`, tidak dihitung ulang dari `occurred_at` — menghitungnya ulang menjadikan laporan tempat kedua yang memutuskan hal yang sama.

**Modul E — stok bergerak dua arah, akhirnya.**

- ⛔ `item_variation.cost` **dibuang** dari skema lokal dan sync rules (FR-F5). Klien menulis `cost_at_sale = 0`; server menghitungnya lewat `getVariationSnapshot`. Perangkat tidak pernah membutuhkannya.
- ⛔ **`vertical_profile` diturunkan sebagai TABEL, bukan kolom terhitung di `outlet`.** PowerSync mereplikasi perubahan per tabel dari WAL: mengubah profil tidak mengubah baris outlet, jadi baris itu tidak dipancarkan ulang — perangkat memegang nilai basi selamanya, tanpa error. Resolusi `COALESCE(profil_outlet, default_tenant)` terjadi di perangkat.
- `allow_negative_stock` default `true` untuk F&B, ditandai **`[ASUMSI]`** — `spec-e:341` menuntut validasi tiga merchant untuk NILAINYA, bukan untuk keberadaan setting-nya.
- Peringatan stok **tidak memblokir** saat boleh negatif (`spec-e:146`); saat blokir aktif, pesannya membawa **angkanya** (`spec-e:152`). Kuantitas diperiksa **kumulatif lintas baris** — modifier memisahkan baris, stoknya satu.
- Snapshot stok di-rebuild saat tutup shift, **di luar** transaksi penutupan: snapshot adalah cache, dan kegagalan membangunnya tidak boleh me-rollback penutupan kas yang sudah benar.
- Penandaan habis **terpisah** dari stok terhitung dan tidak pernah saling menyimpulkan (`spec-e:220`). Ledger ber-HLC; penanda terbaru menang.
- ⛔ **Oversell tidak dicegah** (non-goal permanen) dan tidak pernah ditolak. Konteks `OversellEvent` dibaca dari `stock_movement`, **bukan** dari parameter: event lahir pada penjualan kedua, jadi menyerahkan perangkat yang sedang menulis membuat perangkat pertama tidak pernah muncul. Terlibat = setiap penjualan sejak saldo terakhir kali masih positif.

**⛔ Pelajaran terpenting F3: database sungguhan juga dapat menyembunyikan cacat.**

Aturannya selama ini "fake menyembunyikan, SQLite sungguhan membuktikan". F3 menemukan kebalikannya: test HLC penandaan habis tetap **hijau** saat perbandingan HLC diganti "baris terakhir menang", karena index `(outlet_id, variation_id, hlc)` membuat pemindaian terurut hlc menaik — kedua aturan memberi jawaban identik, secara struktural. Membalik urutan `INSERT` tidak menolong; index yang menentukan.

Jaminan urutan yang kodenya sendiri harus berikan hanya dapat diuji lewat sumber yang mengembalikan baris dalam urutan **yang tidak dijamin SQL** — di sana fake bukan penyederhanaan, melainkan satu-satunya alat yang benar.

---

## F6 — telemetri klien, keputusan yang mengikat kode

Lima dari delapan metrik `ARCH:296` **tidak dapat dihasilkan server** — dan itu bukan kelalaian, melainkan sifat: keadaan yang mereka ukur hidup di perangkat, sebagian besar justru saat perangkat tidak terhubung. Rantainya: `catat()` → `telemetry_local` → penjadwal → `POST /devices/{id}/telemetry` → `device_telemetry` (migrasi `0029`) → `GET /devices/{id}/telemetry`.

- ⛔ **Batas etis `ARCH:309` ditegakkan di TIGA lapisan, dan yang ketiga membaca KODE.** Daftar event tertutup dan nilai yang wajib angka menjaga datanya; yang tidak dijaga keduanya adalah slot `tipe` — ia memang string, dan string apa pun lolos. `tests/kasir/telemetri-batas-etis.test.js` memindai setiap pemanggilan `catat()` di `apps/kasir/src` dan menolak `.message`, template literal, serta properti selain `.name`. Pesan error memuat nama produk ("Kopi Susu tidak ditemukan"); tidak satu pun lapisan di bawah dapat mengetahuinya.
- ⛔ **`VITE_TELEMETRY` yang TIDAK DISET berarti `off`, bukan `full`.** `ARCH:262` tetap berlaku — yang menetapkan `full` adalah konfigurasi deployment SaaS, bukan ketiadaan konfigurasi. Asimetri akibatnya yang memutuskan: on-premise yang lupa menyetelnya akan MENGUMPULKAN data tanpa ada yang menyetujuinya, dan itu tidak terlihat siapa pun; SaaS yang lupa hanya menghasilkan metrik kosong, dan kosong itu terlihat.
- ⛔ **`mode === 'off'` tidak memasang apa pun** — bukan sink yang membuang, bukan penjadwal yang mengirim nol. "Dikumpulkan lalu dibuang" adalah jawaban yang berbeda dari "tidak dikumpulkan".
- ⛔ **`rekam()` menelan SETIAP kegagalan**, termasuk `no such table` pada perangkat yang migrasi lokalnya belum jalan (`ARCH:307`). Pemanggilnya jalur penjualan dan jalur cetak; telemetri yang menggagalkan keduanya lebih berbahaya daripada telemetri yang tidak ada.
- ⛔ **Buffer BERBATAS dan memangkas yang TERLAMA.** Disk yang penuh membuat `outbox_local` gagal menulis penjualan — telemetri dapat dibuang, penjualan tidak. Jaminan urutannya hidup di `ORDER BY`, dan fake `DbLokal` tidak menegakkan `ORDER BY` sama sekali; testnya karena itu di atas SQLite sungguhan, disisipkan dalam urutan acak.
- ⛔ **Percobaan ulang mengirim BATCH YANG SAMA**, dengan kunci idempotensi yang diturunkan dari daftar id. Batch yang melebar di antara dua percobaan akan menghitung ganda bila yang pertama sebenarnya sampai — dan respons yang hilang adalah kejadian normal di jalur ini.
- ⛔ **`401` dipertahankan, `400` dibuang.** Perangkat yang kredensialnya kedaluwarsa akan di-provisioning ulang, dan metrik dari masa ia tidak terhubung justru yang menjelaskan kenapa. Muatan yang bentuknya salah tidak akan pernah diterima, dan batch yang diulang selamanya akhirnya memangkas metrik yang masih baik.
- ⛔ **Koersi AJV mengubah `null` menjadi `0`** pada properti bertipe `number`, sebelum handler melihatnya — pengukuran yang tidak pernah terjadi, tidak dapat dibedakan dari nol yang sungguhan, tanpa satu pun error. `typeof === 'number'` tidak melihat apa pun. Yang menangkapnya **aritmetika**: setiap sampel ada di `[min, max]`, jadi `total` ada di `[min × count, max × count]`.
- ⛔ **Migrasi lokal sekarang MEMBUAT tabel murni-lokal yang baru.** `jalankanDdl` hanya berjalan saat sidik jari raw table berubah, dan sidik jari itu tidak menghitung tabel lokal — jadi setiap tabel lokal baru adalah `no such table` permanen di setiap perangkat yang sudah terpasang. `rencanaBuatLokalHilang` menutupnya; ia berjalan sebelum ALTER kolom, di setiap boot.
- **Latensi keranjang diukur HANYA untuk jalur langsung.** Penandanya dikosongkan begitu dialog modifier terbuka — angka yang memuat waktu berpikir orang mengukur menu, bukan aplikasi.
- **`app_version` disimpan bersama angkanya**, bukan dibaca dari `device.app_version` saat laporan dibuat: `ARCH:302` memakai crash rate per versi sebagai gate rollout, dan versi perangkat sekarang sudah berubah saat rollout gagal.
- **Kesehatan antrean dibaca lewat `ringkasanAntrean`** — fungsi yang sama dengan indikator sinkronisasi dan K-14. Antrean kosong TIDAK mengirim `umur_antrean_jam: 0`; nol akan menurunkan rata-rata umur tepat pada perangkat yang paling sehat.
- **`double precision` di `device_telemetry` bukan pengecualian aturan float.** Larangan itu berlaku di jalur uang; yang menjaga kolom-kolom ini tetap di luar jalur itu adalah CHECK `event` — tidak ada nama event yang menyebut jumlah uang, dan tidak boleh ada.
- **Agregasi lintas-tenant TIDAK dibangun**, batas yang sama dengan `metrik.ts`: ia menuntut pembaca ber-`BYPASSRLS`, dan itu keputusan deployment.

### ⛔ Transport perangkat diuji SEBAGAI transport — pelajaran 21 Agustus 2026

**Setiap refund yang dibuat offline tidak pernah sampai ke server**, dan itu hidup di kode ter-merge sampai ditemukan tanpa sengaja. `POST /orders/{id}/cancel` menuntut `X-Approver-Id`; relay outbox tidak pernah mengirimnya, dan `outbox_local` tidak punya kolom untuk menyimpannya. Hasilnya `400 MISSING_APPROVER_ID` → `gagal-permanen` → berhenti di antrean selamanya, sementara kasir sudah mengembalikan uangnya dan server tetap mencatat penjualannya tertutup dengan omzet penuh.

**Delapan belas test void/refund hijau selama itu.** Semuanya memanggil endpoint LANGSUNG dengan header yang ditulis test itu sendiri — bentuk yang dipakai back-office, bukan yang dipakai perangkat. Header yang tidak pernah disusun `buatPengirimHttp` tidak dapat hilang dari test yang menuliskan headernya sendiri.

Aturannya sekarang: **setiap operasi yang perangkat kirim lewat outbox wajib punya satu test yang memakai `buatPengirimHttp` dan `klasifikasi` yang ASLI**, dengan hanya `fetch` yang dipalsukan dan diteruskan ke server sungguhan (`tests/ordering/refund-offline-relay.test.js`). Yang dibuktikan test endpoint langsung adalah servernya benar; ia tidak dapat membuktikan kliennya memanggil dengan benar.

⛔ **Membuka rute untuk jalur perangkat MENGEMBALIKAN kepercayaan pada `X-Actor-Id`.** Rute di `RUTE_TERBUKA` melewati penjaga sesi sepenuhnya, jadi `req.sesi` tidak pernah terisi dan `getActorId` kembali memakai header — pemanggil yang PUNYA sesi tetap dapat mengaku jadi orang lain. Karena itu jalur perangkat ditandai **`sesiOpsional`**: sesi tidak dituntut (relay tidak mengirimnya), tapi ditegakkan bila dibawa, dan Bearer tidak sah ditolak 401 alih-alih diabaikan. ⛔ Ia TIDAK dipasang pada rute berkredensial perangkat (`sync-token`, `telemetry`, `update`) — Bearer di sana secret perangkat, dan memverifikasinya sebagai sesi menolak perangkat yang sah.

Konsekuensi lain yang mengikat: **penyetuju dibekukan di `outbox_local.approver_id`**, alasan yang sama dengan `actor_id` — antrean dapat terkuras setelah pergantian shift. Header KOSONG tidak pernah dikirim: `getApproverId` menolaknya dengan pesan yang sama persis dengan header yang hilang, jadi mengirimnya hanya memindahkan kegagalan.

---

### F6 — staged rollout, keputusan yang mengikat kode

`ARCH:§12` dan KEP-36 menolak dua jalan yang lebih mudah: auto-update paksa **menghentikan outlet di jam makan siang**, dan update manual berarti delapan versi di lapangan setelah setahun. Yang tersisa adalah rollout bertahap dengan jendela waktu. Aturannya di `packages/domain/src/rilis.ts`; keadaannya di `app_release` (migrasi `0030`).

- ⛔ **Yang dibangun adalah KEPUTUSAN, bukan PEMASANGAN.** `GET /devices/{id}/update` menjawab "versi mana yang seharusnya, dan boleh dipasang sekarang atau tidak". Mengunduh dan memasangnya menuntut shell Tauri — utang F4 yang tercatat. Memisahkan keduanya membuat updater yang lahir kelak tinggal menempel, bukan memutuskan ulang; aturannya tidak akan pernah punya dua salinan.
- ⛔ **Persentase MERCHANT, bukan perangkat.** Satu outlet dengan tiga kasir tidak boleh terbelah dua versi: ketiganya berbagi shift, printer, dan nomor struk, dan selisih versi di antara mereka adalah tepat beban multi-versi yang KEP-36 ingin hindari — dialami dalam satu ruangan.
- ⛔ **Kohort wajib SUBSET: 5% ⊂ 25% ⊂ 100%.** Merchant yang keluar dari cakupan saat tahap naik harus TURUN versi, dan rollback skema SQLite lokal "hampir mustahil" setelah data ditulis dengan skema baru (KEP-36). Diuji sebagai property atas 2.000 tenant.
- ⛔ **Kohort DI-GARAM per versi.** Tanpa garam, merchant yang kebetulan berkohort rendah menjadi kelinci percobaan untuk **setiap** rilis, selamanya.
- ⛔ **Kanari adalah PILIHAN (`tenant.is_canary`), bukan undian**, dan cakupannya nol persen. Merchant sungguhan tidak pernah menjadi kelinci percobaan tanpa memilihnya.
- ⛔ **Jendela update boleh MELEWATI TENGAH MALAM.** Outlet yang tutup 02:00 memilih 23:00–02:00, dan perbandingan naif (`mulai <= jam && jam < selesai`) menjawab "tidak pernah" untuknya — update yang tidak pernah terpasang terlihat persis seperti tidak ada rilis. `mulai = selesai` adalah jendela KOSONG, bukan 24 jam penuh; CHECK constraint menolaknya, karena menafsirkannya sebagai penuh membuat satu salah ketik mengizinkan update di jam makan siang.
- ⛔ **Jam lokal outlet dibaca dari jam DATABASE.** Jendela selebar tiga jam, dan dua mesin yang jamnya berselisih memasang update di luar jendela yang merchant setujui.
- ⛔ **Urutan pemeriksaan bukan selera.** "Belum giliran" mendahului segalanya — termasuk update yang wajib segera; yang menaikkan tahap adalah orang. "Wajib segera" mendahului jendela dan penundaan justru karena kategorinya tertutup (`keamanan`, `kehilangan_data`): yang lolos ke sana hanya kehilangan data dan lubang keamanan, dan menunggu 03:00 untuk keduanya berarti membiarkan kerusakan berjalan semalaman.
- ⛔ **Penundaan dihitung PER VERSI** (`device.update_deferred_version`). Tanpa itu, penundaan yang terkumpul untuk versi lama membuat versi berikutnya wajib segera saat pertama kali muncul — merchant kehilangan haknya tanpa pernah memakainya. Jatah yang habis membuat update **wajib**, bukan batal.
- ⛔ **Gate crash rate MENAHAN saat datanya belum ada.** Gate yang meloloskan ketidaktahuan hanya menyala pada rilis yang sudah cukup lama berjalan untuk tidak membutuhkannya. Dan crash rate yang naik SEDIKIT PUN menahan: `ARCH:304` menulis ambangnya `> baseline`, dan toleransi adalah angka yang harus dipilih seseorang — tidak ada di dokumen mana pun, jadi ia tidak dikarang di kode.
- ⛔ **Angka crash rate DIKETIK operator, bukan dihitung alat.** Crash rate satu versi bersifat lintas-tenant, dan `device_telemetry` tunduk RLS — `FORCE ROW LEVEL SECURITY` berlaku untuk owner juga, jadi bahkan `DATABASE_MIGRATION_URL` tidak dapat mengagregasinya. `tools/naikkan-tahap.mjs` menuntut angkanya disebutkan, menegakkan aturannya, lalu **menyimpan** angka yang dipakai di `app_release.gate_crash_*`.
- **`app_release` dikecualikan RLS**, sejajar `printer_profile`: rilis milik KAMI, tidak ada tenant yang memilikinya. Konsekuensinya dinyatakan — setiap merchant dapat membaca barisnya, dan tidak satu pun kolomnya menyebut merchant lain.
- **Rilis yang dihentikan TIDAK dihapus.** Barisnya justru yang menjelaskan perangkat yang terlanjur memasangnya. Yang berlaku adalah rilis **terbaru dibuat**, bukan yang tertinggi nomornya — itulah yang membuat penarikan lewat versi bernomor lebih rendah mungkin.
- **Tidak ada endpoint untuk menaikkan tahap**, dan itu batas yang dinyatakan: seluruh peran di `spec-f` adalah peran merchant, dan endpoint operator menuntut permukaan otentikasi staf yang tidak ada di sistem ini. Alat memakai kredensial database yang memang sudah dipegang operator.

---

### F6 — feature flag & kill switch, keputusan yang mengikat kode

`ARCH:358`: *"Kill switch: per fitur per merchant, dari server tanpa rilis — kebutuhan operasional, bukan kemewahan."* Rantainya: `tools/kill-switch.mjs` → `feature_flag` (migrasi `0032`) → `GET /devices/{id}/features` → `fitur_lokal` → layar kasir.

- ⛔ **Tabel menyimpan PENYIMPANGAN saja.** Bawaan tiap fitur hidup di `packages/domain/src/fitur.ts`, bukan sebagai `DEFAULT` kolom — pola yang sama dengan ambang diskon dan jendela update. Tabelnya akan tetap hampir kosong, dan itu benar.
- ⛔ **`tenant_id IS NULL` = penyimpangan GLOBAL, dan baris tenant MENANG atasnya.** "Matikan untuk semua kecuali yang sudah kami periksa" adalah bentuk pemulihan insiden yang paling sering dipakai.
- ⛔ **DUA index unik parsial, bukan satu.** NULL tidak sama dengan NULL di index unik PostgreSQL, jadi `UNIQUE (key, tenant_id)` tunggal mengizinkan dua baris global untuk fitur yang sama.
- ⛔ **Kunci ASING dibaca MATI**, di server dan di klien. Baris yang tertinggal untuk fitur yang sudah dihapus dari kode tidak boleh menyalakan apa pun.
- ⛔ **Tabelnya dikecualikan RLS**, sejajar `app_release`: alat operator memakai `DATABASE_MIGRATION_URL`, dan `FORCE ROW LEVEL SECURITY` berlaku untuk owner juga. Konsekuensinya dijaga dua penjaga — hanya SATU query di server yang menyentuhnya, dan query itu menyaring tenant.
- ⛔ **Respons berisi BOOLEAN per fitur, bukan barisnya.** Mengirim barisnya berarti mengirim `tenant_id` merchant lain; `reason` sebuah kill switch biasanya menyebut dugaan fraud.
- ⛔ **`fitur_lokal` murni lokal, SENGAJA bukan raw table.** Raw table mengubah sidik jari skema lokal dan menuntut `disconnectAndClear()` + unduh ulang katalog di setiap perangkat merchant — untuk tiga boolean.
- ⛔ **Dua fallback yang arahnya BERLAWANAN.** Fitur tanpa baris mengikuti bawaan kode (menyala) supaya perangkat baru tetap dapat berjualan; fitur yang punya baris bertahan **tanpa kedaluwarsa** supaya kill switch tetap berlaku pada perangkat yang mencabut internetnya. Kegagalan menyegarkan mempertahankan keadaan lama — respons yang tidak sampai bukan "tidak ada flag".
- ⛔ **Tidak ada flag yang menyentuh AUDIT** (`spec-f:369`) maupun yang dapat **menghentikan penjualan**. Keduanya dijaga test atas daftar tertutup, karena kunci berikutnya akan ditambahkan oleh orang yang sedang menangani insiden.

---

### FR-G5 — delapan laporan exception, keputusan yang mengikat kode

`spec-g:151` menyebutnya *"fitur yang **dibeli owner**, bukan sekadar kontrol keamanan"*. Tujuh dari delapan belum ada sampai 23 Agustus 2026; kini tujuh selesai (X1, X2, X3, X4, X5, X7, X8) dan satu **tidak dapat dibangun**.

- ⛔ **X2–X7 hidup di `reporting`, X1 tetap di `ordering`.** Yang baru membaca `cash_drawer_shift` + `audit_event` + `"order"` — tiga modul dalam satu pertanyaan, dan `reporting` satu-satunya yang boleh (invariant #4). X1 lahir sebelum modul itu ada; memindahkannya adalah refactor tersendiri, dan `reporting/index.ts` sudah menyatakan kebijakan itu sejak B-03.
- ⛔ **Penjaga `report_exception` dipasang di SATU pembungkus**, bukan disalin per laporan. Laporan berikutnya yang lahir akan lupa menyalinnya, dan yang lupa membocorkan daftar siapa-membatalkan-apa ke kasir.
- ⛔ **Prinsipnya VARIASI, bukan nilai absolut** (`spec-g:153`). X3 memakai persentil 90 dari periode yang diminta — ambang rupiah tetap menandai seluruh kasir di kafe besar dan tidak pernah menandai siapa pun di kafe kecil. Ambangnya ikut di respons: daftar tanpa ambangnya tidak dapat dijelaskan kepada kasir yang namanya ada di sana.
- ⛔ **X2 membandingkan dengan `shift.closed_at`, bukan jam sekarang.** Shift yang belum ditutup tidak punya "60 menit terakhir"; menghitungnya dari sekarang menghasilkan laporan yang jawabannya berubah tanpa satu pun data berubah.
- ⛔ **X8 membaca `clock_drift_detected`, bukan selisih `occurred_at` vs `recorded_at`.** Selisih keduanya adalah durasi offline pada hampir setiap penjualan yang produk ini ada untuk mendukung.
- ⛔ **X7 mengembalikan total DAN total mutlak.** Kasir yang kurang Rp 50.000 lalu lebih Rp 50.000 punya total nol dan mutlak Rp 100.000 — dua angka yang menceritakan hal yang sangat berbeda.
- ⛔ **X6 TIDAK DAPAT DIBANGUN, dan KEP-21 tidak mengubahnya.** "Item ditambah lalu dihapus berkali-kali" menuntut RIWAYAT perubahan keranjang; keranjang yang bertahan (24 Agustus 2026) menyimpan **keadaannya**, dan keadaan terakhir tidak menyebut apa pun yang pernah dihapus darinya. Menyimpan riwayatnya menuntut telemetri yang memuat nama produk — yang `ARCH:309` larang. Batas yang dinyatakan, bukan penundaan.
- **Tanpa bahasa menuduh, dan itu diuji.** Tidak ada field skor maupun label; ada test yang memindai JSON keluaran ketujuhnya. `spec-g:168`: *"produk yang menuduh karyawan merchant akan merusak hubungan merchant dengan stafnya"*.

**B-21 menampung kedelapan laporan, 23 Agustus 2026.** `IA:200` menamainya "Laporan Exception (8 laporan)" — satu layar, penyeleksi tab, bukan delapan entri menu (`IA:173` menjelaskan kenapa PENGAWASAN dipisah dari LAPORAN sama sekali; memecahnya delapan mengembalikan masalah yang pemisahan itu selesaikan).

- ⛔ **Daftar laporan adalah DATA (`apps/backoffice/src/pengawasan/b21-daftar.ts`), bukan cabang JSX.** Penjaga bahasa menuduh karena itu membaca data, bukan berkas: laporan kesembilan yang lahir kelak diperiksa tanpa siapa pun mengingat penjaganya ada.
- ⛔ **`pesanLaporan` adalah SATU fungsi untuk kedelapan keadaan layar.** "Belum dimuat", "tidak ada apa-apa", dan "gagal memuat" tampak sama dan berarti sangat berbeda; delapan salinan berarti tujuh kesempatan melupakan kalimat "perangkat yang belum tersinkronisasi juga menghasilkan daftar kosong" — dan yang lupa membuat kegagalan jaringan terbaca sebagai **pembebasan** orang yang namanya tidak muncul. `pesanKeadaan` di `b21.ts` dihapus, bukan disalin.
- ⛔ **Bentuk respons X3 BERSARANG, dan `barisLaporan` menanganinya di satu tempat.** Hasil X3 ada di bawah kunci `laporan` sebagai objek `{ambang, jumlahSeluruhRefund, refund}`, bukan larik: `hasil[kunci].length` adalah `undefined`, `undefined > 0` adalah `false`, dan layar berkata "tidak ada refund" untuk periode yang penuh refund tanpa satu pun error.
- ⛔ **X6 tetap punya tab, dengan alasannya di layar, untuk SETIAP keadaan** — termasuk `siap`: berpindah ke tab X6 tidak boleh menampilkan tabel refund yang baru saja dilihat. Menghilangkan tabnya membuat merchant yang membaca spec menyimpulkan laporannya rusak.
- **Angka bertanda selalu disertai KATANYA**: selisih kas negatif diberi kata "kurang", menit ke penutupan yang negatif dibaca "sesudah tutup", selisih jam dibaca "maju"/"mundur". Tren `datar` berbunyi "belum menunjukkan arah", bukan "stabil" — `arahTren` mengembalikan `datar` juga untuk deret yang terlalu pendek.
- **Endpoint tiap laporan dicocokkan ke `openapi.yaml` oleh test.** Path salah ketik menghasilkan 404 yang layar tampilkan sebagai "laporan tidak dapat dimuat" — tidak dapat dibedakan dari server mati.

---

### B-22 Audit & Aktivitas, dan kosakata `audit_event` (23 Agustus 2026)

⛔ **`audit_event.event_type` kini daftar TERTUTUP** (`packages/domain/src/audit-peristiwa.ts`), dan `recordAuditEvent` menerima `PeristiwaAudit`, bukan `string`. Sampai sekarang delapan belas nama tersebar di dua belas berkas tanpa satu pun terdaftar di mana pun. Ejaan yang menyimpang **tidak menghasilkan error** — ia menghasilkan baris audit yang tidak pernah cocok dengan saringan mana pun, dan laporan yang melewatkannya terlihat persis seperti laporan yang tidak menemukan apa pun. Bentuk cacat yang sama persis dengan `stock_movement.type`.

⛔ **Audit trail BERLUBANG terhadap `spec-f:288`, dan lubangnya adalah DATA.** Saat ditemukan: 24 dari 35 nama di tabel spec belum dipancarkan sama sekali. `PERISTIWA_BELUM_DIPANCARKAN` diturunkan dari selisih kedua daftar, ikut di respons `GET /audit-events`, dan **disebutkan di layar**: trail berlubang yang terlihat lengkap lebih berbahaya daripada trail yang tidak ada. Daftarnya menyusut sendiri saat peristiwanya mulai ditulis, jadi tidak ada daftar kedua yang harus diingat untuk dipangkas. FR-F6 **ditutup 25 Agustus 2026** — daftar itu kosong.

**Ditutup 23 Agustus 2026, lubang 24 → 9**, lewat satu pembungkus `catatPerubahanServer` di modul `audit`: katalog/harga/stok/pajak (`item_created` · `item_updated` · `item_archived` · `price_changed` · `stock_adjusted` · `stocktake_completed` · `sold_out_toggled` · `tax_rate_changed`), lalu sesi/shift/perangkat/ekspor (`login` · `logout` · `shift_opened` · `cash_variance_approved` · `device_provisioned` · `device_revoked` · `data_exported`). **Lubang 9 → 4 pada 24 Agustus** bersama FR-D5 (`cash_paid_in` · `cash_paid_out`) dan peran/ambang/vertikal.

**Lubang 4 → 2 pada 24 Agustus** bersama F.5 akses support (`support_session_started` · `support_session_ended`), lalu **2 → 1** bersama FR-D2 (`shift_count_attempt`), lalu **1 → 0 pada 25 Agustus** bersama modul `peripheral` (`peripheral_configured`). **FR-F6 tertutup: `PERISTIWA_BELUM_DIPANCARKAN` kosong.**

⛔ **`peripheral_configured` TIDAK menunggu shell Tauri, dan anggapan sebaliknya menyembunyikan cacat nyata selama berminggu-minggu.** Yang menunggu Tauri adalah *mendeteksi* perangkat keras; yang tidak menunggu apa pun adalah **mencatat printer mana yang merchant katakan ada di perangkat ini** — dan tanpa itu, K-09 dan K-15 memilih profil dengan `p[0]`, baris PERTAMA dari query yang tidak punya `ORDER BY` sama sekali. Merchant dengan tiga model printer mencetak dengan profil yang dipilih urutan baris, bukan dengan printer yang benar-benar tercolok: struk 80 mm dipotong di kolom 32, atau perintah potong tercetak sebagai karakter sampah. Tanpa satu pun error.

- ⛔ **Pilihan hidup di PERANGKAT** (`device_config.printer_profile_id`, murni lokal), bukan di merchant. Kasir 1 dengan Epson dan kasir 2 dengan Xprinter di outlet yang sama adalah keadaan normal.
- ⛔ **`profilBerlaku` membedakan EMPAT sebab**, dan masing-masing punya kalimatnya: dipilih · pilihan-hilang · belum-dipilih · tidak-ada-profil. Yang belum memilih jatuh ke **baseline**, bukan ke `daftar[0]` — jatuh ke elemen pertama mengembalikan cacat yang sama satu lapis lebih dalam.
- ⛔ **`peripheralId` DIBEKUKAN per perangkat.** Id baru pada setiap penyimpanan menghasilkan lima printer terdaftar untuk merchant yang mengubah profilnya lima kali. Kunci idempotensinya `peripheral:{id}:{profilId}` — tanpa profil di dalamnya, perubahan KEDUA dijawab dari cache dan tidak pernah berlaku.
- ⛔ **Rutenya kemunculan KEEMPAT cacat "jalur perangkat 401"**, dan dua propertinya diuji TERPISAH: entri di `RUTE_TERBUKA` (dijaga test relay) dan `sesiOpsional: true` pada entri itu (dijaga test endpoint). Sabotase menunjukkan test relay semula hanya membuktikan yang pertama.
- ⛔ **Pengiriman ulang MEMPERBARUI barisnya**, bukan ditolak `ID_ALREADY_EXISTS` — `peripheral` bukan tabel transaksional, dan invariant #2 menjaga transaksi selesai dan katalog, bukan setelan perangkat. Riwayat perubahannya ada di `audit_event`, dengan `before` memuat keadaan sebelumnya.
- ⛔ **Perintah printer TIDAK diterima dari klien**, hanya `printerProfileId`. Perangkat yang dapat mengarang perintahnya sendiri dapat mengirim byte apa pun ke printer merchant.

### F.5 akses support, ditutup 24 Agustus 2026 (B-30)

`spec-f:393`: *"akses support harus menjadi fitur SISTEM, bukan akses database langsung."* Alternatif yang tidak dibangun adalah alternatif yang akan dipakai — staf tanpa jalan resmi akan diberi kredensial database, dan sejak itu tidak ada baris yang mencatat siapa membaca apa milik merchant mana. Rantainya: `packages/domain/src/sesi-support.ts` → `support_session` (migrasi `0034`) → `POST/GET /support-sessions` + `/end` → penjaga token di `sesi.ts` → banner di seluruh layar back-office.

- ⛔ **Penanda audit dipasang SEKALI lewat `AsyncLocalStorage`** (`apps/server/src/konteks-permintaan.ts`), bukan diteruskan ke ~20 pemanggil `recordAuditEvent`. Penanda yang harus diingat 20 kali akan terlupa yang ke-21, dan yang terlupa menisbatkan tindakan support kepada OWNER MERCHANT secara pribadi — tuduhan yang diam. Bentuk kegagalan yang sama dengan yang membuat penjaga peran pindah ke satu hook. ⛔ `enterWith` dipanggil **sinkron** di hook `onRequest` paling awal, dalam hook tersendiri: dipanggil dari dalam hook async (yang menunggu verifikasi token lebih dulu), storenya hilang sebelum handler. Terukur — penandanya mendarat `null`.
- ⛔ **`support_session_id` adalah KOLOM, bukan jenis peristiwa tersendiri.** Tindakan selama sesi support adalah tindakan yang SAMA (`item_updated` tetap `item_updated`); memberinya nama lain membuat setiap laporan yang menyaring per jenis diam-diam melewatkan yang dilakukan support. **`actor_user_id` tetap owner yang menyetujui** — kolomnya `NOT NULL` ber-FK ke `"user"`, dan staf kami tidak punya baris di sana.
- ⛔ **`admin_label`, bukan `admin_user_id` yang `spec-f:405` tulis.** Kolom itu mengandaikan tabel pengguna STAF yang tidak ada — batas yang sama dengan `tools/naikkan-tahap.mjs`. Yang mengotentikasi `token_hash` (SHA-256), bukan labelnya.
- ⛔ **Sesi support TETAP tunduk RBAC** — ia meminjam peran owner yang menyetujui, dan melewatinya akan membuat akses support satu-satunya jalan di sistem ini yang tidak tunduk RBAC. Diuji lewat owner yang diturunkan menjadi kasir SESUDAH sesi dibuat.
- ⛔ **Mutasi diputuskan dari METODE HTTP**, bukan dari peta operasi RBAC: peta itu tidak mencakup setiap rute, dan yang tidak ada di sana lolos gerbang tulis diam-diam.
- ⛔ **Kedaluwarsa dihitung SAAT DIBACA**, bukan lewat pekerjaan terjadwal — job pembersih yang tidak berjalan membiarkan akses hidup melewati batas yang merchant setujui, tanpa siapa pun melihatnya. Dijawab **403 `SUPPORT_SESSION_EXPIRED`**, bukan 401: yang menerima 401 menyimpulkan tokennya salah dan meminta merchant mengulang seluruh prosesnya.
- ⛔ **Read-only BAWAAN** (`spec-f:403`), konsekuensinya dinyatakan sebelum owner memilihnya. **Sesi aktif menolak yang baru (409)** — dua token hidup berarti mengakhiri sesi di layar tidak benar-benar memutus akses. **Owner yang dinonaktifkan mencabut sesi yang ia beri.**
- ⛔ **`GET /support-sessions` TIDAK dijaga peran**, dan banner dirender di `App.tsx` di atas `children` `AppShell`. `spec-f:401` menuntut "terlihat di SELURUH layar"; banner yang hanya terlihat owner tidak memenuhinya, dan banner yang dipasang per layar hilang di layar berikutnya.
- ⛔ **Token TIDAK masuk audit** dan tidak pernah dapat dibaca kembali. Jejak audit bertahan lima tahun.
- **Batas yang dinyatakan:** petugas support tidak punya akun (token diserahkan owner di luar sistem — permukaan otentikasi staf tidak ada di produk ini) · tidak ada notifikasi ke merchant saat sesi dimulai · sesi tidak dapat diperpanjang, yang habis digantikan sesi baru dengan persetujuan baru.

- ⛔ **`hlc: 0n` adalah nilai yang JUJUR, bukan placeholder.** HLC menyatakan urutan kausal terhadap peristiwa perangkat; perubahan back-office tidak punya perangkat dan tidak berhak mengklaim posisi di dalamnya. Mengarangnya dari jam server menempatkannya di antara dua peristiwa kasir yang tidak pernah melihatnya.
- ⛔ **`price_changed` meresolusi harga lama SEBELUM baris baru ditulis** — baris baru menang di tangga resolusi begitu ia tertulis, jadi meresolusi sesudahnya membuat `before` sama dengan `after`. Dan yang diresolusi harga yang **berlaku** pada `effective_from` baris baru, bukan baris `price_history` sebelumnya: tangga tiga tingkat berarti baris terakhir yang ditulis belum tentu yang sedang berlaku.
- ⛔ **Arsip dan pemulihan memancarkan peristiwa yang SAMA**, dibedakan `before`/`after`. `spec-f:294` hanya menyebut `item_archived`; memancarkan `item_restored` yang tidak ada di daftar berarti kosakata yang tidak dapat dibandingkan dengan spec-nya. Varian dicatat pada ITEM-nya, alasan yang sama.
- ⛔ **`stock_adjusted` mencatat DELTA, bukan stok akhir** — stok adalah `SUM(stock_movement.delta)` dan tidak punya kolom; stok akhir di audit adalah angka kedua yang harus dijaga sepakat dengan ledger-nya. **`stocktake_completed` mencatat JUMLAH baris, bukan barisnya** — opname menyentuh ratusan varian, dan menyalin semuanya menenggelamkan peristiwa lain. **`sold_out_toggled` mencatat ARAHNYA.**
- ⛔ **Test memanggil ENDPOINT-nya, bukan `catatPerubahanServer`.** Test yang memanggil fungsinya langsung membuktikan fungsinya menulis, bukan bahwa handler-nya memanggilnya — kelas yang sama dengan pelajaran transport perangkat 21 Agustus. Dan `before` diuji ISINYA: audit yang menjawab "diubah dari apa" dengan nilai barunya sendiri lolos setiap test yang hanya memeriksa bahwa kolomnya terisi.
- ⛔ **Sepuluh assertion `audit_event` yang lama menghitung SELURUH baris tabel.** Nol benar karena alasan yang salah — tidak ada endpoint katalog yang menulis audit, jadi satu-satunya baris yang mungkin memang milik void. Bentuk yang sama persis dengan 18 test `stock_movement` yang F3 temukan. Kini disaring per `event_type`.
- ⛔ **Tidak ada `login_failed`**, dan `audit_event.actor_user_id` yang `NOT NULL` ber-FK adalah alasannya: login gagal sering memakai email yang tidak menunjuk siapa pun. `after` login memuat PERAN, bukan email — trail bertahan lima tahun, jadi setiap field masuk untuk lima tahun.
- ⛔ **`cash_variance_approved` peristiwa TERSENDIRI**, bukan `approver_user_id` yang kadang terisi pada `shift_closed`: laporan "siapa menyetujui selisih siapa" harus dapat dijawab dengan menyaring satu jenis, tanpa pembacanya perlu tahu bahwa satu kolom bermakna berbeda tergantung jenis barisnya.
- ⛔ **`data_exported` ditulis pada endpoint GET.** Ekspor tidak mengubah apa pun; yang berubah adalah **di mana datanya berada**. Yang dicatat LINGKUPNYA — menyalin CSV-nya ke `after` menggandakan setiap angka penjualan ke tabel berumur lima tahun.
- ⛔ **`shift_count_attempt` TIDAK dapat dibangun sekarang:** percobaan yang ditolak dilempar sebelum `UPDATE` dan ikut ter-rollback, dan justru percobaan yang gagal itulah yang `spec-d` ingin buktikan tidak dapat diulang diam-diam.

**Peran dapat DIUBAH sejak 24 Agustus 2026 (`user_role_changed`, lubang 9 → 8).** Sebelumnya `createUser` menerima `roles` dan `updateUser` tidak — merchant yang menaikkan kasirnya menjadi manajer outlet tidak punya jalan apa pun kecuali membuat pengguna KEDUA dengan nama orang yang sama, yang memecah setiap laporan per kasir menjadi dua baris. Gap PRODUK, ditemukan saat mencari endpoint untuk peristiwa auditnya.

- ⛔ **Peran LAMA target ikut diperiksa `assertBolehKelola`.** `createUser` tidak perlu — pengguna yang belum ada belum berperan apa pun. Di jalur ubah, mengabaikannya membiarkan Manajer Outlet (yang matriks izinkan mengelola *kasir saja*) menurunkan seorang **Owner** menjadi kasir, lalu mengelolanya dengan bebas.
- ⛔ **Owner terakhir tidak dapat DICABUT PERANNYA**, bukan hanya tidak dapat dinonaktifkan. Keduanya meninggalkan tenant tanpa siapa pun yang dapat mengurus billing; penjaga yang menutup satu dari dua jalan ke keadaan yang sama bukan penjaga.
- ⛔ **Cakupan diperiksa terhadap gabungan yang AKAN berlaku**, bukan terhadap yang dikirim: mengubah peran saja menjadi Kasir sementara pengguna sudah di dua outlet menghasilkan tepat keadaan yang `spec-f:32` larang, dan tidak ada apa pun di permintaan itu yang terlihat salah.
- ⛔ **`user_role` DIHAPUS lalu ditulis ulang** — pengecualian yang dinyatakan terhadap invariant #2, yang menjaga data finansial dan katalog. `user_role` tidak ditunjuk riwayat transaksi mana pun; yang menjaga riwayat perannya adalah `audit_event`, dan itulah kenapa `user_role_changed` wajib.
- ⛔ **Aturan cakupan klien hidup di `buatMuatanPeran`, dipakai form tambah DAN form ubah.** Testnya menjalankan keduanya atas masukan yang sama dan membandingkan hasilnya, bukan membaca kodenya.

- ⛔ **Ejaan KODE yang dibekukan, bukan ejaan spec.** `spec-f:292` menulis `order_voided`, kode menulis `order.voided`; keduanya sudah ada di database merchant dan `audit_event` tidak pernah di-`UPDATE` (invariant #2). Menyeragamkan berarti dua ejaan untuk satu peristiwa selamanya. `PETA_EJAAN_SPEC` menyatakan padanannya.
- ⛔ **Paginasi keyset dengan perbandingan BARIS `(occurred_at, id)`.** Lima baris audit pada detik yang sama persis adalah keadaan normal — satu penjualan menulis beberapa dalam satu transaksi; kursor yang hanya membandingkan waktu melewati empat di antaranya. Testnya membuktikan bahwa **menyusuri seluruh halaman mengembalikan setiap baris tepat satu kali**, bukan sekadar bahwa halaman kedua ada.
- ⛔ **Jenis peristiwa asing ditolak 400, bukan dijawab nol baris.** Nol baris terlihat persis seperti "tidak ada yang melakukannya".
- ⛔ **`before`/`after` tidak dikembalikan** — muatan bebas yang pada `item_updated` akan memuat `cost` (FR-F5). Himpunan peran `report_exception` kebetulan sama persis dengan `view_margin` hari ini; kebetulan bukan penjaga.
- ⛔ **Saringan yang aktif ikut di respons DAN disebutkan di atas tabel.** Daftar audit yang tidak menyebut apa yang disaring terbaca seperti daftar lengkap.
- ⛔ **RBAC `report_exception`, `[ASUMSI]` yang dinyatakan.** Matriks `spec-f:38-53` tidak punya baris untuk audit trail; himpunan peran operasi itu sama dengan minimum `IA:201`, dan isi trail adalah superset dari X1 yang matriks sudah berikan kepada keempatnya. Operasi baru `audit_view` sengaja tidak dibuat — matriks yang mengandung baris karangan berhenti dapat dibaca berdampingan dengan spec-nya.
**B-26 Ambang Otorisasi, 24 Agustus 2026 (`threshold_changed`, lubang 8 → 7).** Ketiga ambang keputusan 1 Agustus kini dapat disetel per outlet: diskon (`0031`), selisih kas dan no-sale (`0033`). Resolusinya `ambangBerlaku` di `packages/domain/src/ambang.ts`.

- ⛔ **Setelan dibaca di EMPAT tempat, bukan satu**: `closeShift` dan `recordNoSale` di server, `tutupKas` dan `rencanaNoSaleLokal` di klien. Kedua kolom **turun ke perangkat** — K-12 dan K-16 berjalan tanpa jaringan, dan perangkat yang memakai bawaan sementara server memakai angka merchant menghasilkan *kasir yang sama, shift yang sama, jawaban berbeda*. Layar pengaturan yang menyimpan benar dan tidak mengubah apa pun adalah kegagalan tanpa satu pun error.
- ⛔ **`null` BERBEDA dari nol.** `null` = pakai bawaan; `0` = **setiap** kejadian menuntut otorisasi. `0n || bawaan` membuangnya — `ambangBerlaku` memakai `??`.
- ⛔ **TIDAK ADA nilai yang berarti "tidak pernah menuntut otorisasi".** Kontrol yang dapat dimatikan hilang pada hari seseorang membutuhkannya, dan yang mematikannya adalah orang yang paling ingin ia mati. Yang menginginkan praktis tanpa PIN menyetel angkanya tinggi — terlihat, dan tercatat. Penjaganya BENTUK datanya: tidak ada bidang boolean.
- ⛔ **RBAC `threshold_settings` = {owner, area_manager}**, diturunkan dari `IA:205`. Manajer Outlet sengaja di luar: ambang inilah yang memutuskan kapan persetujuannya dituntut. MEMBACA tidak dijaga — kasir yang ditolak PIN-nya berhak tahu ambang mana yang menolaknya.
- ⛔ **`PUT`, bukan `PATCH`**; respons membawa `tersimpan` DAN `berlaku`; audit mencatat `tersimpan`. Layar yang menebak `tersimpan` dari `berlaku` menuliskan bawaan sebagai pilihan pada penyimpanan berikutnya, dan sejak itu outlet berhenti mengikuti perubahan bawaan tanpa siapa pun memutuskannya.
- ⛔ **AJV meng-koersi `number` → `string`** sebelum handler melihatnya, bentuk yang sama dengan temuan telemetri (`null` → `0`). Kontrak bertipe string tidak dapat menolak `number` di handler; yang menjaganya adalah klien. Yang masih dapat dijaga: rupiah tanpa desimal.

**B-24 Profil Vertikal, 24 Agustus 2026 (`vertical_profile_changed`, lubang 7 → 6). Seluruh 26 layar back-office kini ada.** OQ-09 diputuskan 1 Agustus dan sampai sekarang hanya dapat dijalankan lewat SQL.

- ⛔ **Lima dari enam kolom perilaku TIDAK dibuka di layar** — `default_channel`, `requires_barcode_flow`, `default_tax_type`, `modules_enabled`, dan `name` untuk retail tidak dibaca satu baris kode pun di luar pendaftaran tenant. Membukanya adalah setelan yang tersimpan benar dan tidak mengubah apa pun. Yang dibuka hanya `allow_negative_stock` (FR-E4), dan ia menentukan sesuatu **di perangkat, offline**.
- ⛔ **`retail` DITOLAK `VERTICAL_NOT_AVAILABLE`, dan dinyatakan di layar.** UI-nya ada di daftar "jangan bangun" (v1.1+); merchant yang dapat menekannya mendapat aplikasi kasir F&B dengan label yang mengatakan sebaliknya. Pilihan yang hilang tanpa penjelasan terbaca sebagai layar yang rusak.
- ⛔ **Bawaan tenant tidak dapat DIKOSONGKAN, hanya DIPINDAHKAN.** `resolusiProfil` punya bawaan keras; mencabutnya membuat setiap outlet ber-override NULL jatuh ke aturan yang tidak seorang pun pilih. Menetapkan bawaan baru MENCABUT yang lama di transaksi yang sama — `ux_vertical_profile_tenant_default` adalah index unik parsial, dan tanpanya jawabannya 500 dengan nama index di pesannya.
- ⛔ **TIGA keadaan outlet, bukan dua**: memilih sendiri · mengikuti bawaan tenant · memakai bawaan keras sistem. Ketiganya menampilkan aturan yang sama; hanya yang ketiga tidak dipilih siapa pun, dan hanya yang ketiga menuntut tindakan. Audit mencatat `null` sebagai null, bukan diresolusi.
- ⛔ **Resolusi dihitung di SERVER lewat `resolusiProfil` yang perangkat pakai.** Layar yang menghitungnya sendiri menampilkan aturan yang berbeda dari yang kasirnya alami.

- ⛔ **`RentangTanggal` punya prop `sumbu`.** Ia menyatakan "tanggal bisnis" di setiap layar yang memakainya; benar sepuluh kali dan salah sekali — B-22 menyaring `occurred_at`, karena sebagian besar peristiwa audit tidak menempel pada order mana pun.

---

Urutan fase F0→F6 ada di `product/ARCH-lumi-pos-v1.md` § 14. Estimasi v1: ±18–24 minggu penuh waktu.

---

## Temuan F1: FK PostgreSQL tidak tunduk RLS

Ditemukan empiris saat membangun modul Katalog, bukan dari dokumentasi: sebelum diperbaiki, `createItem` menerima dan **benar-benar menyimpan** item yang mereferensi `category` milik tenant lain, lalu mengembalikan `201`. Foreign key constraint PostgreSQL dicek dengan privilese owner tabel yang direferensikan — **tidak tunduk `FORCE ROW LEVEL SECURITY`**. Constraint FK hanya membuktikan baris itu ada di *suatu* tenant, bukan tenant yang benar.

**Konsekuensi:** setiap FK yang nilainya disuplai klien ke tabel ber-`tenant_id` wajib divalidasi lewat `SELECT` yang tunduk RLS sebelum dipercaya. Modul Katalog menegakkannya lewat `assertCategoryVisible` (`apps/server/src/modules/catalog/handlers/items.ts`), `fetchModifierListOrThrow` (`modifier-lists.ts`), kedua guard di `item-modifier-lists.ts`, dan `assertOutletVisible`/`assertUserVisible` di `prices.ts`. Modul B, C, dan E akan punya paparan yang sama (`order_line.variation_id`, `payment.order_id`, `stock_movement.variation_id`, dst) — cek ini di setiap FK klien-suplai baru.

**Dikonfirmasi ulang 2 Agustus 2026 di `price_history.outlet_id`,** lewat sabotase yang disengaja: `assertOutletVisible` dinonaktifkan, request yang menunjuk outlet tenant lain mengembalikan `201` dan barisnya benar-benar tersimpan. FK ke `outlet(id)` tidak menghentikannya. Ini bukan pengulangan bug yang sama — ini FK yang berbeda, di tabel yang berbeda, di modul yang berbeda. Polanya berulang setiap kali FK klien-suplai baru muncul.

**Dikonfirmasi keempat kalinya di `order.shift_id`** (Modul B): `assertShiftOpen` dinonaktifkan, dan satu order **utuh** — order + check + seluruh baris — tersimpan menunjuk shift milik tenant lain, `201`. Empat kali, empat FK berbeda, empat modul berbeda. Berhenti menganggap ini kejadian; ini sifat PostgreSQL. **Anggap setiap FK klien-suplai baru terpapar sampai kamu membuktikan sebaliknya lewat sabotase.**

**Bentuk kelima, ditemukan 7 Agustus 2026 saat membangun refund: guard yang tidak dapat DIBEDAKAN dari luar adalah guard yang tidak teruji.** Penyetuju refund divalidasi dua kali — sekali eksplisit di jalur refund, sekali lagi di dalam `recordAuditEvent`. Karena keduanya menjawab dengan status dan kode yang sama persis, guard pertama bisa **dimatikan sepenuhnya** tanpa satu test pun merah. Perbaikannya bukan menghapus salah satunya (`refund.approved_by` ditulis sebelum audit berjalan, dan kolom itu tanpa FK), melainkan memisahkan pesannya: `assertApproverVisible` dengan kode `APPROVER_NOT_FOUND`. Itu sekaligus menutup cacat yang lebih nyata — manajer yang penyetujuannya ditolak sebelumnya diberi tahu bahwa **kasir**-nya yang tidak ditemukan.

**Kasus yang lebih buruk: kolom tanpa FK sama sekali.** `price_history.changed_by` adalah `text NOT NULL` tanpa FK ke `"user"` — database tidak akan menangkap id karangan apa pun. Kolom audit finansial yang isinya tidak dijamin siapa-siapa lebih berbahaya daripada FK yang tidak tunduk RLS, karena tidak ada apa pun yang terlihat menjaganya. `assertUserVisible` adalah satu-satunya yang berdiri di sana.

**Batas temuan ini:** suite isolasi 189 test (invariant #8) menguji akses tabel langsung dan itu tetap benar dan hijau — RLS bekerja sesuai spesifikasi. Yang tidak diuji suite itu adalah kelas ini: aplikasi menulis ke tabelnya sendiri, dengan `tenant_id` sendiri, lewat RLS yang berjalan benar, sambil menunjuk baris tenant lain lewat FK. RLS tidak pernah dilanggar di sini — FK-lah pintunya.

---

## Open question yang masih terbuka

Jangan menebak jawabannya — tanyakan atau catat sebagai asumsi bertanda.

| # | Pertanyaan | Memblokir |
|---|---|---|
| OQ-14 | Prototipe Tauri Android — printer Bluetooth + scanner HID | Rencana mobile |


### ⛔ Docker: daemon BISA menyala, tarik image DIBLOKIR

Diukur 2 September 2026, dan ini mengoreksi catatan lama yang menyatakan Docker
tidak tersedia — **klaim keadaan yang sudah basi**.

- `docker` ADA (29.3.1) dan `dockerd` **berhasil dinyalakan** lewat `sudo`.
- Tarik image **gagal**: `production.cloudfront.docker.com` menjawab
  **403 Forbidden** lewat proxy egress, juga sesudah daemon dikonfigurasi
  memakai proxy itu.

⛔ Konsekuensinya untuk stack PowerSync di `prototypes/05`: ia tetap **tidak
dapat dijalankan di sini**, tapi sebabnya berbeda dari yang tercatat
sebelumnya. Yang dibutuhkan bukan Docker — melainkan allowlist untuk registry
Docker, atau image yang sudah ditarik lebih dulu.

### ⛔ "Nol baris, bukan error" — kelas kegagalan, bukan insiden

Lima kejadian dalam satu minggu, mekanismenya identik: sesuatu gagal dan yang muncul adalah **kekosongan yang terlihat sah**, bukan galat. Katalog kosong, antrean sehat, daftar exception bersih — nol adalah jawaban SAH untuk ketiga pertanyaan itu, jadi tidak ada assertion wajar yang menolaknya.

Daftar lengkap beserta mekanisme dan penjaganya: `docs/verifikasi/KELAS-GAGAL.md`. Survei kandidat berikutnya ada di sana juga — **angkanya batas atas populasi yang perlu dipilah, bukan jumlah cacat.**

⛔ **Bentuk penjaga yang bekerja, dan ia bukan "assert lebih banyak":** bandingkan **dua sumber yang tidak ada apa pun menyatukannya** — sync rules ↔ DDL, sync rules ↔ `tokens.ts`, `var(--x)` ↔ definisi token. Ditambah satu syarat yang mudah terlupa: penjaga wajib membuktikan ia **memindai sesuatu**, karena penjaga yang memeriksa nol berkas hijau selamanya dan hijaunya adalah bentuk kekosongan yang sama.

### ⛔ K-06/K-07 tidak boleh dinyatakan selesai tanpa tiga fixture ini

Keputusan user 2 September 2026, diambil setelah audit monokultur. Ketiganya
**mengikat**, dan ditulis di sini alih-alih diingat saat sampai ke sana.

| # | Fixture yang WAJIB ada | Kenapa |
|---|---|---|
| 1 | `tax_rate.type = 'ppn'` **11%** | `TaxCalculator` belum pernah dijalankan dengan jenis pajak yang paling banyak dipakai merchant Indonesia. Fixture memakai `pbjt` saja — `ppn` **nol di seluruh repo**. ⛔ Kalau ternyata ia tidak menanganinya, itu **bug uang: laporkan, jangan tambal diam** |
| 2 | `service_charge_amount != 0` **dan** `channel = 'dine_in'` | 3 berkas lawan 48 di produk F&B — yang paling khas LumiPOS justru yang paling sedikit diuji. Kanal memutuskan tarif pajak di sebagian yurisdiksi (`spec-c`) |
| 3 | `qris_static` + `card_edc` di jalur **TAMPILAN** | Keduanya sudah teruji di jalur DATA (4 berkas: penjualan, tutup-kas, tutup-kas-refund, laporan-harian) dan TIDAK di jalur tampilan — persis lubang yang meloloskan peta metode keempat yang memuat `card` dan tidak memuat `qris_static` |

⛔ **K1 (27 dari 42 empty state) dan K2 (~19 endpoint tanpa penyebut) SENGAJA
tidak dipilah sekarang** (keputusan user). Keduanya batas atas populasi, bukan
cacat; apakah nol di suatu layar sah atau tidak hanya dapat diputuskan **saat
menyentuh layar itu**. Pemilahan massal akan menghasilkan tebakan bervolume.

Audit monokultur fixture: `docs/verifikasi/MONOKULTUR-FIXTURE.md`. ⛔ Temuan terbesarnya bukan metode pembayaran melainkan **`tax_rate.type = 'ppn'` yang NOL di seluruh fixture** — PPN adalah pajak nasional 11%, dan `TaxCalculator` berdiri di atas satu jenis pajak saja (`pbjt`).

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

  Ini bukan catatan tentang gambar; ia yang paling kuat di antara alasan pencabutan `bytea` dan berlaku jauh di luarnya. Versi `bytea` hanya dapat dibuktikan dengan menjalankan PostgreSQL + PowerSync sungguhan — dan di repo ini itu berarti **tidak pernah dibuktikan sama sekali** (`Docker: daemon BISA menyala, tarik image DIBLOKIR`). Versi base64 dibuktikan `node --test` di atas SQLite yang sudah ada di setiap run: byte per byte, termasuk `0x00`, `0xFF`, dan urutan bukan-UTF-8.

  Yang menentukan bukan seberapa aman jalurnya di atas kertas, melainkan **seberapa sering kebenarannya diperiksa ulang**. Jalur yang lebih aman tetapi hanya dapat diuji di lingkungan yang tidak ada berhenti diperiksa setelah hari ia ditulis, dan sejak itu ia dipercaya berdasarkan ingatan. Representasi yang sedikit lebih mahal tetapi diperiksa pada setiap commit menang atas keduanya.

  Ia juga menjelaskan kenapa `KOLOM_BELUM_DIUKUR` boleh ada: kolom yang tipenya menyimpang dan tidak dapat diuji di sini **dinyatakan belum diukur**, bukan dianggap benar.
- **Tandai asumsi.** Pakai `[ASUMSI]` seperti di dokumen riset, jangan selundupkan sebagai fakta.
- **Lapisan sync ditulis dengan waktu, keacakan, dan I/O di-inject** sebagai dependensi — prasyarat DST, dan retrofitnya mahal. Harness referensi ada di `prototypes/02-dst-sinkronisasi/sim.py`.
