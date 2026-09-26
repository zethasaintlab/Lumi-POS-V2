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

## Keputusan otonom

Keputusan kelas 2 (`docs/PROTOKOL-OTONOM.md` § 1): dapat dibalik, memakai bawaan yang wajar, diambil tanpa berhenti. User meninjau semuanya di gerbang berikutnya. Format satu baris per keputusan: apa · bawaan yang dipakai · alasan · cara membalik.

## Kondisi berhenti

- Test yang sudah ada merah dan sebabnya bukan perubahan kampanye ini
- Penjaga hampa yang tidak dapat diperbaiki
- Mockup hanya dapat diwujudkan dengan melanggar perilaku yang dijaga
- Invarian tidak dapat dipenuhi oleh ukuran mockup
- BLOCKED dari implementer yang tidak dapat diselesaikan
- Keadaan repo atau branch tidak seperti yang diharapkan

## Utang yang dicatat

- **`apps/hp` tanpa satu pun penjaga DOM** (keputusan user, 26 September 2026). `apps/hp` adalah aplikasi owner. Ia tidak masuk sub-proyek mana pun dan tidak punya layar di mockup; "Lumi-Order" di mockup adalah aplikasi pelanggan, bukan `apps/hp`. Fondasi desain mengubah tampilannya lewat token dan wordmark, dan buktinya hanya pengukuran dari dev server (`scrollWidth <= 390` di layar masuk), bukan test CI. Harness DOM-nya belum dibangun.

## Ledger

Cerminan `.superpowers/sdd/progress.md`, diisi per task. Satu baris per task:
sub-proyek, task, status, commit, reviewer, sabotase.

| Sub-proyek | Task | Status | Commit | Tinjauan | Sabotase |
|---|---|---|---|---|---|
| 1 Fondasi | Task 1 — token mockup + koreksi AA | selesai | `a0cf333` | Sonnet 5: bersih, 2 minor ditunda | implementer: 3/3 merah |
