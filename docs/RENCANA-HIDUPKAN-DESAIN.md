# Rencana kampanye: Hidupkan desain LumiPOS apa adanya

Keputusan user, 26 September 2026. Berkas ini adalah satu-satunya tempat
keputusan kampanye ditulis, dan sekaligus cermin ledger SDD
(`.superpowers/sdd/progress.md` di-ignore git). Alurnya ada di `CLAUDE.md`
§ Workflow Superpowers.

## Arah produk

LumiPOS harus menjadi desain di `docs/referensi-visual/sumber/design-explorer.html`,
apa adanya. Alasannya, kata user: *"aku ingin menghidupkan desain LumiPOS
menjadi nyata seperti apa adanya."*

Untuk **tampilan**, mockup adalah sumber kebenaran: palet, aksen, font, skala
teks, radius, bayangan, spasi, komponen, tata letak, struktur navigasi, dan
layar-layarnya.

Untuk **perilaku** yang memindahkan uang, mengontrol kas, atau menyinkronkan
data, spec dan test tetap menang.

Prinsipnya: **identik secara tampilan, aman secara perilaku.**

## Yang berubah mengikuti mockup

Menggantikan aturan lama di `CLAUDE.md` yang bertentangan:

- **Palet** — nilai mockup. Pengecualian: status netral dinaikkan minimal dari
  4,37 ke 4,5 supaya lolos AA.
- **Aksen** — nilai mockup. Aturan "aksen tidak disentuh" diganti.
- **Font** — Nunito Sans, di-self-host sesuai kebijakan repo sejak F0.
- **Skala teks** — skala mockup. § Skala teks final ditulis ulang, termasuk
  nasib `--t-metric`.
- **Radius, bayangan, spasi, komponen** — nilai mockup.
- **Header satu baris**, navigasi berikon.
- **Chip kategori netral**, satu warna aksen untuk yang aktif.
- **Toolbar kasir delapan tombol.** Setiap tombol harus bekerja; fungsi yang
  belum ada dibangun. Tidak ada tombol mati.
- **Kartu pembayaran bertoggle** dengan empat metode termasuk **Transfer**, QR
  tampil di dalam kartu.
- **Keranjang tanpa stepper.** Qty diubah lewat menyentuh baris, yang membuka
  layar Edit Item.
- **Layar pratinjau struk** dibangun.
- **Seluruh layar back-office** mockup.
- **Aplikasi pelanggan** mockup.

`PR #60` ditutup tanpa di-merge. Alat penjaga kontras dan perbaikan sentinel
`warna-tombol` di dalamnya dipakai ulang untuk palet mockup.

## Perilaku yang dijaga di balik tampilan yang identik

- **QRIS dinamis** hanya terkonfirmasi dari gateway. Tombol "Konfirmasi bayar"
  tampil persis mockup, tapi untuk QRIS dinamis ia menunggu gateway dan
  berlabel menunggu pembayaran. Selama QRIS menunggu, toggle metode dan
  keranjang terkunci.
- **Pembulatan FR-C9** hanya di `simpanPenjualan`. **Total** dari
  `totals.total`.
- **Target sentuh:** elemen yang di mockup lebih kecil dari 44px tampil persis
  ukuran mockup, dengan area sentuh diperluas tanpa terlihat ke 44px, dan
  56px untuk aksi uang.
- **Status sinkron:** "Tersinkron" tidak pernah tampil saat antrean tidak
  diketahui sehat.

## Keputusan bawaan — dapat diganti user

1. **K-12:** tata letak persis mockup, saldo seharusnya tampil sesudah
   hitungan fisik diisi.
2. **Tombol Pajak:** membuka pilihan tarif outlet yang sudah terdefinisi,
   bukan input persentase bebas.
3. **Nomor transaksi:** format `K1-YYYYMMDD-NNNN` tetap, posisi dan gaya
   mengikuti mockup.
4. **Pembayaran campuran:** tetap tersedia lewat tautan kecil di kartu
   pembayaran, tidak di tampilan bawaan.
5. **Label pajak:** baris berlabel "Pajak" dengan nama tarif di sampingnya.

## Invarian yang tetap berlaku

- Perilaku di atas
- K-03 minimal 12 kartu pada 1024x768 (IA:62). Kalau ukuran mockup tidak
  memenuhinya, laporkan.
- Posisi Bayar sama untuk 0, 3, dan 20 item
- K-14 minimal 3 baris tabel
- Tinggi bilah nav sama di semua layar
- Nol hex hardcoded di komponen
- Ratchet `test:schema`
- Suite PostgreSQL berurutan

## Penjaga yang memaku nilai lama

Diubah dalam commit tersendiri yang menyebut keputusan kampanye ini, tidak
pernah dicampur dengan kode yang membuatnya merah.

## Sub-proyek

1. **Fondasi desain** — palet, aksen, font, skala teks, token, kulit komponen.
   **Gerbang visual: tidak di-merge sebelum user menyetujui preview-nya.**
2. **Aplikasi kasir** — setiap layar kasir mockup.
3. **Back-office** — setiap layar back-office mockup. Spec-nya menetapkan cara
   merender untuk penjaga dan preview.
4. **Aplikasi pelanggan** — butuh sisi server. Spec-nya dibrainstorm bersama
   user; plan tidak dimulai sebelum spec disetujui.

Sub-proyek 2 dan 3 dimulai sesudah 1 di-merge. Sub-proyek 4 sesudah spec-nya
disetujui.

## Keputusan produk tertunda

- **"Item manual" sebagai item berharga bebas di luar katalog** (P4, keputusan
  user 28 September 2026, issue #76 komentar `5862870577`). Sub-proyek 2
  membangun "Item manual" sebagai masukan kode barcode/SKU (P4(a)). Di Kasir
  Pintar, "barang custom" berarti item berharga bebas di luar katalog, jadi
  itu kemungkinan arti sebenarnya di mockup. Butuh FR sendiri (harga manual,
  pajak, `cost_at_sale`, audit), tidak dibangun sekarang.

## Keputusan otonom

Keputusan kelas 2 (`docs/PROTOKOL-OTONOM.md` § 1): dapat dibalik, memakai bawaan yang wajar, diambil tanpa berhenti. User meninjau semuanya di gerbang berikutnya. Format satu baris per keputusan: apa · bawaan yang dipakai · alasan · cara membalik.

- **Bobot 500 bundle dirender 600 di semua pemakainya** (sub-proyek 1, Task 4) · bawaan: `--weight-medium: var(--font-weight-semibold)` · alasan: mockup dan subset font tidak punya 500; selain `t-body-md` (keputusan user) ikut menebal `.label`, `.field-error`, `.sync`, `.tabs`, `.avatar`, `.shell-link` aktif, `.stepper span`, `.segmented button` aktif, `.btn`, chip kategori · cara membalik: timpa bobot per kelas di `packages/ds/lumi.css`, atau arahkan `--weight-medium` ke 400
- **Kartu produk K-03 tanpa foto tetap bergradien tipis** (sub-proyek 1, Task 9) · bawaan: gradien `--surface` → `--surface-sunk` dari Task 2 dipertahankan, warna kategori dicabut · alasan: mockup `ProductCard.jsx` datar `--card`, tapi selisihnya ≤ 4% di tepi bawah kartu, tidak memakai warna baru, dan tata letak kartu K-03 milik sub-proyek 2 · cara membalik: hapus aturan gradien `.product-card` di bagian Kedalaman `packages/ds/lumi.css`; demo datar di halaman fondasi sudah menunjukkan versi mockup untuk dibandingkan
  ⛔ **DIBALIK oleh user di gerbang visual, 27 September 2026.** Kartu produk K-03 tanpa foto kini FLAT `--card`, tanpa gradien — aturan `.product-card.kasir-kartu` dihapus dari bagian Kedalaman `packages/ds/lumi.css` (bundle sudah memakai `--surface`/`--accent-soft` sendiri untuk keadaan normal/hover/aktif). `tests/kasir-dom/kulit-komponen.test.js` Step 0 memeriksa `backgroundColor`/`backgroundImage` LANGSUNG pada kartu K-03 sungguhan, bukan hanya demo swatch.
- **Indikator sinkron di header, bukan pil di toolbar** (sub-proyek 2, Task 3) · bawaan: FR-H2 di setiap layar · alasan: toolbar hanya ada di K-03 · cara membalik: tambahkan pil toolbar dan sembunyikan indikator header di K-03
- **Outlet · perangkat di tombol pengguna** (sub-proyek 2, Task 3) · bawaan: baris kedua 13 px · alasan: header satu baris, prefiks struk tetap terbaca · cara membalik: pindahkan ke sebelah wordmark
- **Avatar tombol pengguna 32px, BUKAN 28px mockup** (sub-proyek 2, Task 3) · bawaan: 32px (nilai lama `.kasir-staf`) · alasan: `Avatar` bundle mengetik `fontSize: Math.round(size * 0.4)` (`Avatar.jsx`) — 28px → 11px, bukan salah satu dari EMPAT ukuran skala teks final (32/20/15/13); `tests/kasir-dom/skala-teks.test.js` (G-LH) adalah invariant "wajib hijau tanpa disunting" (spec § 11), jadi elemen mockup DITOLAK, bukan dipilih diam-diam — 32px → 13px, genap token `--text-small` · cara membalik: kembalikan `size={28}` di `MenuPengguna.tsx` HANYA bila `Avatar.jsx` (vendor) diubah agar tidak lagi menurunkan ukuran font dari `size`, atau bila token skala teks final berubah
- **Urutkan produk tetap ada** (sub-proyek 2, Task 5) · bawaan: segmented ringkas di kanan field cari, satu baris 44 px, tanpa label terlihat · alasan: fungsi yang sudah ada tidak dibuang; mockup tidak punya kontrol urut · cara membalik: hapus kontrolnya
- **Bilah toolbar 68 px mockup DITOLAK; bilah natural ~44 px** (sub-proyek 2, Task 5, R1-c) · bawaan: tanpa `height`/`flex-shrink` pada `.kasir-toolbar`; ukuran TOMBOL (min 70×44, ikon 17 di atas label 13/600) tetap mockup · alasan: `.kasir-grid-panel` selalu kelebihan konten, jadi bilah sudah menyusut ke 44 px di kode lama; memaksanya 68 px membuat G-IA62-PITA merah (1024×768 `gambar-antrean` 8/12 kartu, sisa −18 px), invarian "wajib hijau tanpa disunting" · cara membalik: `height: 68px; flex-shrink: 0` di `.kasir-toolbar` HANYA bila pita/header/kontrol lain dikurangi ≥ 18 px lebih dulu
- **`?matikan=<kunci>` di galeri dan barcode fixture `8992761111017`** (sub-proyek 2, Task 5) · bawaan: `OpsiDbPalsu.matikanFitur` + `KODE_BARCODE_FIXTURE` pada "Kopi Tubruk ORIGEN" · alasan: membuktikan Diskon hilang dan jalur scan tanpa menambah keadaan galeri (yang melipatgandakan kombinasi di penjaga lain) · cara membalik: hapus opsi dan literal di `k03-toolbar.test.js`
- **Rute audit Batalkan di modul `cash`, bukan `audit`** (sub-proyek 2, Task 5B) · bawaan: `POST /shifts/{shiftId}/cart-cleared` di `apps/server/src/modules/cash/handlers/keranjang-batal.ts`, memanggil `recordAuditEvent` lewat `audit/index.ts` · alasan: `cash_drawer_shift` milik `cash` dan peristiwanya menempel pada shift (pola no-sale/count-attempts); modul `audit` tidak punya jalur tulis perangkat · cara membalik: pindahkan handler dan rute, `entity_type` outbox tetap
- **Konfirmasi Batalkan menghitung ulang total lewat `hitungKeranjang` saat dikonfirmasi** (sub-proyek 2, Task 5B) · bawaan: bukan memakai state `hitungan` layar · alasan: state itu dapat tertinggal satu ketukan di belakang keranjang; fungsi yang sama dipanggil lagi, bukan aritmetika kedua · cara membalik: teruskan `hitungan?.totals.total`
- **"N item" di konfirmasi = jumlah kuantitas seluruh baris** (sub-proyek 2, Task 5B) · bawaan: `tampilkanKuantitas(SUM(quantityMilli))`; audit menyimpan keduanya (`line_count`, `quantity_milli`) · alasan: itu yang pelanggan hitung sebagai "item" · cara membalik: pakai `baris.length`
- **Variation yang tak lagi ada di katalog: Edit Item tetap terbuka, dianggap tidak dilacak dan tanpa modifier** (sub-proyek 2, Task 6) · bawaan: fail-open pada stok · alasan: menolak membuka baris yang sudah di keranjang mengunci pesanan berjalan; oversell memang tidak dicegah (non-goal) · cara membalik: `lacakStok: true` bila tak ditemukan
- **Jenis `cart_line_reduced` dan rute SAUDARA `POST /shifts/{shiftId}/cart-line-reduced`, bukan berbagi `cart-cleared`** (sub-proyek 2, Task 5C) · bawaan: satu jenis untuk penurunan qty dan penghapusan baris (`quantity_after_milli` 0 = dihapus), modul `cash`, handler `keranjang-baris.ts` · alasan: bentuk muatan berbeda (satu baris vs ringkasan keranjang), dan satu rute untuk dua bentuk berarti validasi dan hash bersyarat; pola handler, `sesi.ts`, RBAC, idempotensi, dan shift tertutup tetap diterima identik dengan `cart-cleared` · cara membalik: gabungkan ke `cart-cleared` dengan pembeda `jenis`
- **Yang dicatat = qty DRAF < qty tersimpan; `gantiModifier` (penggabungan) bukan penghapusan** (sub-proyek 2, Task 5C) · bawaan: keputusan memakai qty draf baris yang diedit, bukan bentuk keranjang hasil akhir; harga = `satuanKeranjang` baris SEBELUM diedit (modifier ikut); Edit Item yang menaikkan qty atau hanya mengubah modifier tidak menulis apa pun · alasan: penggabungan menjumlahkan qty (total tidak turun) · cara membalik: bandingkan qty total per variation
- **`reducedValue` dihitung ulang di server: terima, tandai, laporkan** (sub-proyek 2, Task 5C, fix round 1) · bawaan: bigint `unitPrice × selisih / 1000` disimpan sebagai `after.reduced_value`; nilai klien yang berbeda tetap diterima, ditandai `reduced_value_client` + `variance_amount` dan audit `calculation_variance` (pola `spec-h:93`) · alasan: server memegang seluruh masukannya, jadi nilai tak terverifikasi adalah sumber kedua di jejak anti-fraud · cara membalik: simpan nilai klien apa adanya (ditolak reviewer)
- **Shift tidak terbuka pada penurunan qty: tolak dan jelaskan** (sub-proyek 2, Task 5C) · bawaan: dialog menahan dengan "Shift sudah tidak terbuka. Perubahan TIDAK disimpan."; kenaikan qty/modifier tetap tanpa pemeriksaan shift (tidak ada jejak yang ditulis) · alasan: sama dengan Batalkan (5B) · cara membalik: izinkan tanpa jejak (ditolak: keranjang berkurang tanpa jejak)
- **Simpan tanpa perubahan = Batal; modifier baris yang sudah diarsipkan dipertahankan** (sub-proyek 2, Task 6) · bawaan: tidak menulis keranjang, modifier "yatim" ikut tersimpan · alasan: menulis data yang sama itu bising; membuang modifier diam-diam menurunkan harga baris tanpa tanda · cara membalik: hapus `tanpaPerubahan` / `yatim` di `DialogEditItem.tsx`
- **`?editItem=1` di galeri + pencatat `window.__galeriKeranjangSet`** (sub-proyek 2, Task 6) · bawaan: fixture 4 baris (stok 2, habis, bermodifier, kembaran) dan penghitung panggilan `setelKeranjang` · alasan: penulisan `keranjang_lokal` tidak membuktikan "satu kali" (React menggabung pembaruan sinkron) · cara membalik: hapus opsi dan efek di `Galeri.tsx`
- **Pengimpor `uang-tampilan` 35 → 37** (sub-proyek 2, Task 6) · bawaan: `CLAUDE.md` § Pemformat rupiah dan `klaim-registri.test.js` diperbarui (`DialogEditItem`, `PemilihModifier`) · alasan: penjaga registri mewajibkan kalimat dan angka sepakat · cara membalik: mustahil tanpa membuang salah satu berkas
- **Laci kas: arah bawaan tetap "Kas keluar", urutan toggle Kas masuk · Kas keluar (mockup)** (sub-proyek 2, Task 4) · bawaan: perilaku dialog lama (bawaan keluar) dipertahankan, urutan tombol mengikuti mockup · alasan: bawaan tidak diputuskan spec; mengubahnya adalah keputusan produk, urutan adalah tampilan · cara membalik: `useState<ArahKas>('keluar')` di `FormKasManual.tsx`
- **"Buka laci tanpa transaksi" 44 px (bukan `kritis` 56)** (sub-proyek 2, Task 4) · bawaan: tombol sekunder biasa; konfirmasi di `DialogNoSale` tetap 56 px · alasan: no-sale tidak memindahkan uang (tanpa `cash_movement`) dan kartu kiri harus muat 1024×768 tanpa gulir · cara membalik: `kritis` pada tombol di `LaciKas.tsx` dan hemat 12 px di tempat lain
- **Galeri: `?tanpaKasManual=1`, `window.__galeriTabel`, kas manual net-nol di fixture** (sub-proyek 2, Task 4) · bawaan: tiga baris kas manual (+37.500 −25.000 −12.500) supaya saldo K-12 galeri tetap Rp 670.500; skenario `kosong` = perangkat belum terdaftar, jadi riwayat kosong lewat parameter URL · alasan: `k12-hitungan.test.js` memaku 670.500, dan fixture yang menggesernya membuat penjaga K-12 merah karena data uji · cara membalik: hapus opsi `tanpaKasManual` dan baris `cm-manual-*` di `db-palsu.ts`
- **Pengimpor `uang-tampilan` 37 → 38; berkas ber-`<EmptyState>` 28/42 → 29/43** (sub-proyek 2, Task 4) · bawaan: `CLAUDE.md`, `KELAS-GAGAL.md`, dan `klaim-registri.test.js` diperbarui (`LaciKas`) · alasan: penjaga registri mewajibkan kalimat dan angka sepakat · cara membalik: mustahil tanpa membuang berkasnya

## Kondisi berhenti

- Test yang sudah ada merah dan sebabnya bukan perubahan kampanye ini
- Penjaga hampa yang tidak dapat diperbaiki
- Mockup hanya dapat diwujudkan dengan melanggar perilaku yang dijaga
- Invarian tidak dapat dipenuhi oleh ukuran mockup
- BLOCKED dari implementer yang tidak dapat diselesaikan
- Keadaan repo atau branch tidak seperti yang diharapkan

## Utang yang dicatat

- **`apps/hp` tanpa satu pun penjaga DOM** (keputusan user, 26 September 2026). `apps/hp` adalah aplikasi owner. Ia tidak masuk sub-proyek mana pun dan tidak punya layar di mockup; "Lumi-Order" di mockup adalah aplikasi pelanggan, bukan `apps/hp`. Fondasi desain mengubah tampilannya lewat token dan wordmark, dan buktinya hanya pengukuran dari dev server (`scrollWidth <= 390` di layar masuk), bukan test CI. Harness DOM-nya belum dibangun.
- **Kulit `.shell-link` mockup belum diikuti.** `packages/ds/lumi.css` hanya menyentuh tinggi (`min-height: 44px`, target sentuh); warna TIDAK aktif (`--muted-foreground-strong`) dan latar hover (`--background`) masih bawaan bundle (`--ink-muted`/`--surface-alt`). Ditunda ke sub-proyek 3 — `.shell-link` dipakai navigasi sidebar back-office, layar yang sub-proyek 3 kerjakan, bukan token/kulit komponen generik milik sub-proyek 1.
- **Nama ganda `AppShell` disembunyikan CSS, belum ada penjaga CI** (Task 8, `--shell-brand > .wordmark + .t-body-md.truncate`). `AppShell` bundle merender `brand.logo` DAN `brand.name` sebagai teks terpisah tanpa syarat; span kedua disembunyikan lewat selektor CSS supaya nama "LumiPOS" tidak tampil dua kali di sidebar. Diperiksa manual di DOM saat Task 8, tapi belum ada test yang menegakkannya di CI — akan dijaga oleh harness DOM back-office sub-proyek 3, yang sudah membuka layar bersidebar untuk keperluan lain.

## Ledger

Cerminan `.superpowers/sdd/progress.md`, diisi per task. Satu baris per task:
sub-proyek, task, status, commit, reviewer, sabotase.

| Sub-proyek | Task | Status | Commit | Tinjauan | Sabotase |
|---|---|---|---|---|---|
| 1 Fondasi | Task 1 — token mockup + koreksi AA | selesai | `a0cf333` | Sonnet 5: bersih, 2 minor ditunda | implementer: 3/3 merah |
| 1 Fondasi | Task 2 — pengarahan token bundle, halaman fondasi, nol hex | selesai | `133e966`, `d41a769`, `9fd0298` | Sonnet 5: bersih; tinjauan ulang putaran 1 bersih | implementer 3 sabotase; independen Opus 14 (6 celah ditutup di putaran 1, S9 diparkir) |
| 1 Fondasi | Task 3 — Nunito Sans di-self-host | selesai | `0392513` | Sonnet 5: bersih, 2 minor ditunda | implementer: 2/2 merah; penjaga hampa `document.fonts.check()` ditemukan implementer dan diganti |
| 1 Fondasi | Task 4 — skala 32/20/15/13, bobot mockup, `--t-metric` dihapus | selesai | `d53a6c0`, `9b1f4ff` | Sonnet 5: bersih, 1 minor ditunda | implementer: 1/1 merah; reviewer mengulang sabotase 12 px, merah di 8 layar |
| 1 Fondasi | Task 5 — radius, bayangan, area sentuh tak terlihat + tidak bertumpuk | selesai | `5530f1c`, `0615b5a`, `981bdc6` | Sonnet 5: 1 Important (pembantu potong demo-only) ditutup putaran 1; tinjauan ulang putaran 2 bersih | implementer 2/2; independen Opus 14 (3 celah: elemen non-demo, keadaan keranjang penuh, sampel ±2 px — ditutup putaran 2) |
| 1 Fondasi | Task 6 — set ikon Lucide 0.468.0 disalin, 50 mockup + 48 nama bundle | selesai | `2896a76` | Sonnet 5: bersih, 2 minor ditunda; 79 entri dicocokkan ulang byte demi byte dengan paket segar | implementer 1/1 merah (`circle-alert`) |
| 1 Fondasi | Task 7 — plugin Vite `ikonLumi()` mengalihkan ikon internal bundel ke set Lucide | selesai | `365400f` | Sonnet 5: bersih, nol temuan; reviewer mengulang ketiga sabotase | implementer 3/3 merah (config tanpa plugin, pembaca langsung `Icon.jsx`, `resolveId` dimatikan) |
| 1 Fondasi | Task 8 — wordmark LumiPOS di ketiga aplikasi | selesai | `15a5b1d` | Sonnet 5: bersih, 1 minor ditunda (nama ganda `AppShell` disembunyikan CSS, belum ada penjaga CI) | implementer 1/1 merah; reviewer mengulang sabotase, merah di 7 layar |
| 1 Fondasi | Task 9 — kulit komponen, chip kategori netral | selesai | `edb828e` | Sonnet 5: bersih, 1 minor (narasi laporan); kontras alasan Bayar 4,94 | implementer: radius `.btn`, `.badge-neutral`, `.card` di bagian komponen, semua merah; reviewer mengulang ketiganya |
| 1 Fondasi | Task 10 — dokumen mengikuti keputusan kampanye | selesai | `fb4c4b1` + perbaikan urutan otoritas | Sonnet 5: 1 Important (urutan otoritas `CLAUDE.md` masih menaruh token di atas mockup), ditutup controller | — (dokumen; `test:runtime` 50/50) |
| 1 Fondasi | Tinjauan akhir satu branch | selesai | `1c12669`..`400e622`, `4dc7c88` | Opus 5.5: FIXES_REQUIRED (3 Important: penjaga token buta tambahan, chip K-03 belum ikut mockup, lencana bertepi) → ditutup; tinjauan ulang Opus: READY_FOR_PR | Opus mengulang sabotase ketiga Important; celah aturan bersarang di `:root` ditutup controller (penjaga lama hijau, baru merah) |
| 1 Fondasi | Gerbang visual putaran 1 (chip 36/12 + `.sentuh`, kartu flat, bayangan modal) | selesai, menunggu persetujuan user | `c6178ca`..`e1c951c`, `812db10` | Opus 5.5: FIXES_REQUIRED (2 Important: tumpang-tindih area sentuh chip tak dijaga CI, nilai `--shadow-modal` tak dipaku) → ditutup `812db10` (`k03-area-chip.test.js`, k07 memaku rgba(20,112,107,.2) 0 18px 50px) | Tampilan terukur benar di peramban; bobot 600 (poin 3) menunggu pilihan user |
| 2 Kasir (PR 2A) | Task 1 — tinggi baris empat token, G-LH, G-IA62-PITA | **BLOCKED** — R1-a: `gambar-antrean` 1024×768 hanya 8/12 kartu (batas 1013, baris-3 1017, sisa −4) begitu kartu berfoto DAN pita FR-H8 tampil bersamaan; tanpa pita 12/12 (sisa 57–111). Kondisi berhenti IA:62 (indeks § "Titik ukur R1") — bukan disesuaikan/diselamatkan | belum ditinjau | implementer: G-LH 1/1 merah (`.t-caption`→1,5); G-IA62-PITA sabotase (2) merah benar (pita tidak ditemukan) setelah selektor `[role="status"]` diganti `.kasir-pita` (hampa: cocok `SyncIndicator`); sabotase (3) tidak dapat dibuktikan — assertion kartu sudah merah tanpa sabotase |
| 2 Kasir (PR 2A) | Task 2 — hapus `.pita-kategori` (CSS mati) | selesai | `ed626af`, `625f614` | belum ditinjau (self-review implementer, subagen tidak dikirim) | implementer: 1/1 merah — kembalikan aturan `.pita-kategori` di `lumi.css` (cp, bukan `git checkout`) → penjaga baru `token-css-ada.test.js` merah, pesan menyebut `lumi.css` |
| 2 Kasir (PR 2A) | Task 3 — header satu baris 68 px, menu pengguna + Keluar, lonceng (P7), pita setinggi banner, label cari `sr-only`, R1-b hijau | selesai + fix round 1 | `5309617` (penjaga lama), `e4b977f` (implementasi), `2ca3427` (bugfix truncate R2), `72712fb` (fix round 1: komentar `MenuPengguna` sesuai kode, tanpa perubahan perilaku), `20d743b` (fix round 1: `.badge` kembali 1,5 — regresi Task 1, penjaga `kulit-komponen` menang atas Step 6 Task 1) | belum ditinjau (self-review implementer, subagen tidak dikirim); fix round 1 dari tinjauan (1 Important) + ruling controller (1 regresi Task 1) | implementer 6/6 merah karena alasan yang benar: (1) `flex-wrap` header → "header MEMBUNGKUS"; (2) Keluar memanggil "hapus sesi" langsung → pesan FR-H4 tidak tampil; (3) **naskah "padding lama" TIDAK cukup** (padding vertikal `--space-2` sama di kedua versi, hanya horizontal berubah) — sabotase diperluas ke kontributor tinggi SUNGGUHAN (`font: inherit` pada tautan pita menimpa `.t-caption`) → 40px > 36px; (4) `angkaDapatDipercaya` dipaksa `true` → `k14-keadaan.test.js` (b) DAN (d) merah (dua penjaga lama, bukan satu); (5) label diberi `display:none` → penjaga header merah, **`bidang-label.test.js` TETAP HIJAU** (sabotase disengaja hanya lewat prop `labelTersembunyi`, dan tidak ada Bidang K-06 yang memakainya — beda dari naskah, dicatat); (6) sabotase Task 1 tertunda (`padding-top:40px` `.kasir-konten`) → G-IA62-PITA merah pada JUMLAH KARTU (8/12), bukan pita hilang. Fix round 1: `.badge` dikembalikan ke `--leading-small` (1,4) → `kulit-komponen.test.js` merah, pesan identik dengan regresi asli (26.1875px vs harap ~27,5px) |
| 2 Kasir (PR 2A) | Task 5 — toolbar K-03: Item manual (dialog kode → `dipindai`), Diskon (`calculator`, alasan nonaktif), G-TOMBOL-HIDUP, R1-c hijau (12/12 kartu di 1024/1280 × normal/gambar/gambar-antrean; `gambar-antrean` 1024 sisa 6 px) | **selesai** — 9 tombol nonaktif pra-ada diberi alasan `aria-describedby` (fix round 0, keputusan controller; Keypad, Paginasi, BukaShift, TutupKas, StatusSinkronisasi, Perangkat), `tombol-hidup` 2/2 hijau. **Elemen mockup DITOLAK: bilah toolbar 68 px** (IA:62 menang; bilah natural 44 px, keputusan controller). Cakupan klik (2/2) dipersempit = minor tertunda ke tinjauan akhir | `9ce2c65` (penjaga lama), `423e61a` | belum ditinjau (self-review implementer) | implementer 4/4 merah karena alasan yang benar: (1) Item manual `onClick={() => {}}` → G-TOMBOL-HIDUP (2/2) menyebut K-03/Keranjang penuh/"Item manual"; (2) `keterangan` dicabut dari Diskon → "Diskon nonaktif tanpa aria-describedby"; (3) Diskon disabled alih-alih hilang → "harus HILANG, bukan nonaktif"; (4) Item manual memanggil `tambah` langsung → "baris keranjang bertambah untuk kode yang seharusnya tidak dikenal". Penjaga hampa ditemukan dan diperbaiki saat menulis (2/2): klik bilah galeri lewat locator jatuh ke dialog layar-penuh (sapuan diam-diam menguji K-03 berulang), diganti `element.click()`; deteksi hanya `location.search` melewatkan `pushState` `navigasi()` |
| 2 Kasir (PR 2A) | Task 5B **U** — Batalkan keranjang dengan jejak `audit_event` `cart_cleared`: konfirmasi "Kosongkan keranjang? N item", satu transaksi lokal (audit + outbox + hapus `keranjang_lokal`), `POST /shifts/{id}/cart-cleared` (modul `cash`, OpenAPI, `sesi.ts`, `rbac-rute.ts`), ikon tempat sampah kepala keranjang; R1 tidak berubah (`gambar-antrean` 1024 sisa 6 px, 12/12) | **selesai** (menunggu sabotase independen Opus) — 4 penjaga lama lain ikut disesuaikan karena ditemukan merah: `k03-chrome` (isi toolbar), `k03-kepadatan` (selektor h2), `status.test` (rute `tools/pulihkan-antrean.mjs`), `b22` (label peristiwa) | `f2eec94` | belum ditinjau | implementer 6/6 merah karena alasan yang benar: (1) DELETE keranjang_lokal dipindah sebelum transaksi → "keranjang hilang tanpa jejak"; (2) total dihitung ulang dari harga×qty → "total audit 455000 != Total yang tampil 505050"; (3) rute dicabut dari `sesi.ts` → 401 SESSION_INVALID (server + relay); (4) handler menolak shift closed → SHIFT_NOT_OPEN; (5) idempotensi dimatikan → INTERNAL_ERROR pada retry; (6) handler tanpa `batalkanKeranjang` → "harus TEPAT satu audit_event; ada 0" |
| 2 Kasir (PR 2A) | Task 6 **U** — keranjang tanpa stepper (baris satu tombol 58 px, lencana qty, "Rp X per item" via `satuanKeranjang`) + Edit Item (draf qty/modifier, Simpan satu hasil akhir, qty 0 → "Hapus dari keranjang" danger); `periksaTambahStok` satu jalur FR-E4/E5 untuk kartu dan tombol +; `gantiModifier` menggabung kembaran; `PemilihModifier` diekstrak; R1 tidak berubah (`gambar-antrean` 1024 sisa 6 px, 12/12) | **selesai** (menunggu tinjauan Opus dan sabotase independen Opus) | `a4970e5` (penjaga lama) + `0826248` | belum ditinjau | implementer merah karena alasan yang benar: (1) `+` tanpa `periksaTambahStok` → "kalimat FR-E4 berangka tidak muncul" / "kalimat habis (FR-E5)"; (2) `habis` dihapus → batas-stok "variation ditandai habis tetapi + diizinkan"; (3) `gantiModifier` tanpa gabung → "dua baris identik tidak digabung"; (4) `setelKeranjang` dua kali → HIJAU pada versi pertama (React menggabung; penjaga hampa), diperbaiki dengan pencatat `__galeriKeranjangSet` lalu merah; (5) `unitPrice` → "harga per item tidak memuat modifier"; tambahan: urutan qty/modifier terbalik → "qty gabungan bukan 3"; scanner tak dimatikan → merah |
| 2 Kasir (PR 2A) | Task 4 **U** — layar Laci kas K-18 `/laci` (tab ketiga; Tutup shift jadi keempat): form kas manual (`FormKasManual`, `bacaRupiah`, alasan tertutup, toggle 44 px + `.sentuh-uang` 56 px), "Buka laci tanpa transaksi" (kill switch `buka_laci_no_sale` → HILANG), riwayat kas manual shift (`bacaKasManualShift`, hanya `paid_in`/`paid_out`, jumlah positif); tanpa saldo laci (hitungan buta FR-D2); Buka laci + Kas masuk/keluar keluar dari toolbar K-03, `SEMENTARA` kosong; `product/IA-lumi-pos-v1.md` §2.2 K-18 + §7 `/laci` (satu commit, #76 komentar 5883887477); R1 tidak memburuk (1024 normal sisa 41, 1280 sisa 96, `gambar-antrean` 1024 sisa 6; 12/12) | **selesai** (menunggu tinjauan Opus dan sabotase independen Opus) | `9551ded` (penjaga lama) + `daca1d9` (penjaga baru) + `df013a6` (IA) + `9b814d4` | belum ditinjau | implementer merah karena alasan yang benar: (1) query tanpa filter `type` → "movement \"m-sale\" bocor ke riwayat kas manual" + DOM "riwayat menampilkan 10 baris; fixture punya 3"; (2) `jumlah: delta` → "paid_out delta −25000 harus jumlah 25000n, terbaca -25000"; (3) arah dari tanda → "tanda tak cocok tetap membawa jumlah positif"; (4) `rincianSaldo` di kartu kanan → "memuat saldo laci … \"670.500\""; (5) kill switch diabaikan → "buka_laci_no_sale MATI tetapi tombol Buka laci masih tampil"; (6) isian dikosongkan saat gagal → "isian jumlah hilang saat gagal"; (7) `sentuh-uang` dicabut / `::before` tanpa pointer → "area tekan toggle … kurang dari 56 px"; (8) nominal dibersihkan non-digit → "\"25.5\" diterima"; (9) penjaga `sibuk` dicabut → "dua klik menulis 2 movement" |
| 2 Kasir (PR 2A) | Task 5C **U** — Edit Item yang menurunkan qty atau menghapus baris meninggalkan jejak `cart_line_reduced` yang sampai ke server (issue #76 Q2): `kurangiBarisKeranjang` (satu transaksi lokal: `audit_event` + outbox + `keranjang_lokal` hasil edit), rute saudara `POST /shifts/{id}/cart-line-reduced` (modul `cash`, OpenAPI, `sesi.ts`, `rbac-rute.ts`, `http.ts`, `ENTITY_TYPES`, `pulihkan-antrean`, label B-22), RUNBOOK § 8.7.1; dialog menyatakan "tercatat di audit", menahan dengan galat saat jejak gagal atau shift tidak terbuka. Step 0: premis "audit_event tidak masuk outbox" SALAH sebagai generalisasi — setiap penulis `audit_event` lokal (6 titik) juga mengantre; tabel lokalnya memang dibuang rebuild (`TABEL_RAW` → `migrasi.ts:76`) tetapi `outbox_local` tidak, dan server menulis baris auditnya sendiri. Temuan di luar cakupan (tidak diperbaiki): komentar `db/local/001-initial.sql:657` mengklaim `audit_event` login/logout naik, tetapi tidak ada penulisnya di perangkat | **selesai** (menunggu tinjauan Opus dan sabotase independen Opus) | `4d243f5` | belum ditinjau | implementer: 58 sabotase, semua merah dengan pesan yang menyebut hal yang dijaga kecuali 3 yang hijau lalu DITUTUP (nilai `Number` di domain lolos karena nilai uji terwakili float → diganti 2^53+1; harga tanpa modifier di jalur layar → uji Kopi Susu+Extra shot; `setelKeranjang` dua kali → penghitung set) dan 2 hijau-redundan yang dinyatakan (regex uang handler di balik pola OpenAPI; entri `DIKECUALIKAN` di balik `RUTE_TERBUKA`); rincian `.superpowers/sdd/2026-09-28-kasir-2a/task-5C-report.md` |

### Temuan Task 5C di luar cakupan (dicatat, tidak diperbaiki)

- **Ambang no-sale dibaca dari `audit_event` LOKAL** (`apps/kasir/src/kasir/no-sale.ts:50`, `SELECT count(*) FROM audit_event`): rebuild skema di tengah shift (`migrasi.ts:76` membuang `TABEL_RAW`) mereset hitungan "PIN di atas 3×/shift" dan ambang dapat terlewati. Jalur fraud sekeluarga; butuh keputusan (hitungan dari outbox/server atau tabel yang tidak dibuang).
- **Login/logout offline tidak meninggalkan jejak**: komentar `db/local/001-initial.sql:657` mengklaim `audit_event` login/logout naik, tetapi tidak ada penulisnya di `apps/kasir/src`; server hanya mencatat logout online (`identity/handlers/auth.ts:255`).
- **Melepas modifier berbayar bersamaan dengan penurunan qty hanya mencatat bagian qty** (RUNBOOK § 8.7.1); melepas modifier saja tidak dicatat (lingkup keputusan user).
