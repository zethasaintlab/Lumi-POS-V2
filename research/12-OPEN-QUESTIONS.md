# 12 — Open Questions

> Fase 12 dari 12. Tanggal riset: 27 Juli 2026.
> Pertanyaan yang **harus dijawab manusia** sebelum PRD ditulis atau implementasi dimulai. Diurut berdasarkan dampak: menjawabnya salah atau menundanya akan mengubah arsitektur, bukan hanya fitur.

---

## Cara membaca

| Kolom | Arti |
|---|---|
| **Dampak** | Apa yang berubah kalau jawabannya berbeda |
| **Blocker untuk** | Dokumen atau pekerjaan yang tidak boleh dimulai sebelum ini terjawab |
| **Cara menjawab** | Langkah konkret, bukan "riset lebih lanjut" |

---

> ## ✅ Status per 27 Juli 2026 — enam pertanyaan sudah diputuskan
>
> **OQ-01, OQ-02, OQ-03, OQ-04, OQ-05, dan OQ-06 tidak lagi memblokir apa pun.** Keputusan lengkap beserta alasan, konsekuensi, dan tindakan lanjutan ada di **`13-DECISION-LOG.md`**.
>
> | # | Keputusan singkat |
> |---|---|
> | OQ-01 | **Terima batas** — satu device = satu unit otonom; KDS/table management/hub lokal keluar dari v1 |
> | OQ-02 | **On-premise ditunda** sampai ada pelanggan bayar di muka; enam aturan arsitektur tetap mengikat |
> | OQ-03 | **Terselesaikan dari teks lisensi** — PowerSync bebas dipakai untuk SaaS; satu email konfirmasi sebelum on-prem pertama |
> | OQ-04 | **Tanpa integrasi Coretax di v1**; ekspor rekapitulasi + `SigningHook` no-op. Verifikasi hukum → checklist pra-rilis |
> | OQ-05 | **Channel jadi dimensi `TaxRate`**, default `all`. Desain menyerap jawaban hukum apa pun |
> | OQ-06 | **Aggregator tidak di v1**; proses partner dimulai sekarang, integrasi v1.1 |
>
> **Sepuluh pertanyaan sisanya (OQ-07 s.d. OQ-16) masih terbuka**, tetapi tidak ada yang memblokir penulisan PRD.

---

## Prioritas 1 — Blocker arsitektur. ~~Jawab sebelum menulis PRD.~~ ✅ **Semua sudah diputuskan** — lihat `13-DECISION-LOG.md`.

### OQ-01 — Apakah ambisi "offline penuh lintas device" dipertahankan?

**Konteks:** `[FAKTA]` Toast, dengan sumber daya yang jauh melampaui proyek ini, secara eksplisit **tidak** membagi order antar POS device saat offline — bahkan pada mode "local sync" dengan hub device di LAN. Mereka merekomendasikan setiap karyawan memilih satu device dan hanya memakai device itu. Lightspeed memilih menjual appliance fisik (Lightserver) daripada membangun mesh.
*(Fase 5 § 2, sumber: [Offline mode with local sync — Toast Platform Guide](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html))*

**Pertanyaan:** Menerima batasan ini (v1: satu device = satu unit otonom, tanpa berbagi order antar POS device saat offline), atau menganggarkan 10–16 minggu tambahan untuk mencoba melampaui apa yang dipilih Toast?

**Dampak:** Menentukan bentuk seluruh lapisan sinkronisasi, apakah ada komponen hub lokal, dan apakah resto dine-in bisa menjadi target v1.

**Blocker untuk:** PRD (spesifikasi kemampuan offline), technical architecture, dan penentuan segmen target.

**Cara menjawab:** Keputusan pemilik produk berdasarkan rekomendasi Fase 5 (KEP-20 merekomendasikan menerima batasan, dengan hub lokal untuk KDS di v1.1). Jika ragu, wawancarai 5 merchant multi-terminal: tanyakan apa yang mereka lakukan saat ini ketika internet mati.

---

### OQ-02 — Apakah opsi self-hosted/on-premise tetap ada di rencana?

**Konteks:** Fase 9 memperkirakan **8–14 minggu kerja awal + 15–25% overhead permanen pada setiap rilis**. Rentang waktu yang sama dengan membangun KDS + table management + hub lokal, yang melayani segmen yang sudah terbukti ada. Rekomendasi KEP-33: siapkan arsitekturnya, jangan bangun paketnya sampai ada pelanggan yang membayar di muka.

**Pertanyaan:** Menerima rekomendasi ini, atau ada alasan komersial yang belum diketahui riset yang membuat on-premise harus ada di v1?

**Dampak:** Jika dipertahankan di v1, semua estimasi jadwal harus dinaikkan dan setiap fitur harus diuji dua kali. Jika ditunda, harus dinyatakan sebagai roadmap bersyarat di materi penjualan agar tidak menciptakan ekspektasi yang salah.

**Blocker untuk:** Roadmap, PRD (non-goals), dan komitmen penjualan.

**Cara menjawab:** Keputusan pemilik produk. Uji dengan pertanyaan: apakah ada calon pelanggan konkret yang sudah menyatakan bahwa SaaS tidak bisa diterima?

---

### OQ-03 — Verifikasi Functional Source License PowerSync

**Konteks:** `[FAKTA]` PowerSync Open Edition self-hosted gratis di bawah FSL (client SDK Apache-2.0). `[FAKTA]` Sentry memakai FSL yang sama dengan larangan: tidak boleh menjual deployment self-hosted Sentry sebagai penawaran, dan tidak boleh menjadi kompetitor langsung Sentry; lisensi **menjadi Apache 2.0 setelah 2 tahun**.
*(Fase 3 § 9, Fase 9 § 3.2)*

**Pertanyaan:** Apakah teks FSL PowerSync yang sebenarnya mengizinkan menyertakan PowerSync sebagai komponen dalam produk POS komersial, termasuk dalam paket on-premise ke pelanggan enterprise?

**Dampak:** Jika tidak, lapisan sinkronisasi turun harus dibangun sendiri (~4–8 minggu tambahan). Arsitektur hybrid yang direkomendasikan di KEP-22 sengaja membatasi kerugiannya, tapi tetap material.

**Blocker untuk:** Technical architecture (keputusan sync engine final), dan setiap kode yang mengintegrasikan PowerSync.

**Cara menjawab:** Baca teks lisensi di [powersync.com/legal/licensing-terms](https://www.powersync.com/legal/licensing-terms) secara utuh. Jika ambigu, tanyakan langsung ke PowerSync lewat Discord/email — pertanyaan lisensi adalah pertanyaan yang mereka harapkan. Tingkat kekhawatiran diturunkan dari kritis ke penting setelah temuan analogi Sentry, tapi verifikasi tetap wajib.

---

### OQ-04 — Status kewajiban fiskal Indonesia pasca-Coretax

**Konteks:** `[FAKTA]` DJP menjadikan Coretax sistem inti seluruh administrasi perpajakan **mulai Juli 2026** — bulan yang sama dengan riset ini. Penggunaan DJP Online dan aplikasi desktop e-Faktur berakhir. Sumber yang dipakai bertanggal 13 Juli 2026.
*(Fase 6 § 7)*

**Pertanyaan:** (a) Apakah ada kewajiban baru bagi **penyedia sistem POS** (bukan hanya wajib pajak) akibat Coretax? (b) Apakah Indonesia bergerak menuju fiscalization real-time gaya Eropa, di mana struk harus disahkan pemerintah sebelum dicetak?

**Dampak:** Jika (b) benar, `SigningHook` (Fase 6 § 8) berubah dari titik ekstensi kosong menjadi fitur v1 wajib, dan seluruh alur cetak struk berubah.

**Blocker untuk:** Modul pajak, alur cetak struk, dan klaim kepatuhan dalam materi penjualan.

**Cara menjawab:** Verifikasi langsung ke pajak.go.id dan konsultasi dengan konsultan pajak Indonesia. **Jangan andalkan pemberitaan** — ini area yang berubah cepat dan konsekuensinya hukum.

---

### OQ-05 — Perlakuan pajak dine-in versus takeaway

**Konteks:** `[FAKTA]` DJP menyatakan makan di restoran tidak kena PPN; yang berlaku adalah PBJT (pajak daerah, maks 10%, ditetapkan perda). Tetapi status kopi kemasan yang dibawa pulang dari kafe, atau biji kopi kiloan yang dijual kafe, tidak jelas dari riset ini. Design system sudah punya `SegmentedControl` untuk mode Dine In/Takeaway — perbedaan ini sudah ada di UI.
*(Fase 6 § 1)*

**Pertanyaan:** Kapan transaksi kafe dikenai PBJT dan kapan PPN? Apakah bergantung pada jenis barang, cara penyajian, atau interpretasi daerah?

**Dampak:** Menentukan apakah `TaxRate` harus bisa dipilih **per channel** (dine-in/takeaway) selain per kategori produk. Salah menghitung pajak bukan bug — itu masalah hukum merchant.

**Blocker untuk:** Model pajak di ERD, alur kasir, dan format struk.

**Cara menjawab:** Konsultan pajak Indonesia + verifikasi dengan 3 merchant kafe yang sudah beroperasi (bagaimana mereka menanganinya sekarang, dan apa yang diminta pemda mereka).

---

## Prioritas 2 — Menentukan cakupan v1. Jawab sebelum roadmap dikunci.

### OQ-06 — Integrasi GoFood / GrabFood / ShopeeFood: masuk v1 atau tidak?

**Konteks:** `[FAKTA]` ESB mencantumkan integrasi GoFood & GrabFood bahkan di paket **Basic** (Rp0). Ini table stakes pasar F&B Indonesia, bukan fitur premium. Tetapi masing-masing platform punya API, model menu, aturan sinkronisasi stok, dan alur pembatalan sendiri — tiga proyek integrasi terpisah.
*(Fase 1 § 7 poin 11, Fase 2 § 10)*

**Pertanyaan:** Masuk v1, v1.1, atau ditunda dengan konsekuensi go-to-market yang diterima?

**Dampak:** Jika ditunda, sebagian besar kafe akan menolak di percakapan pertama. Jika masuk v1, menambah 6–12 minggu ke jadwal dan tiga ketergantungan eksternal dengan proses persetujuan partner.

**Blocker untuk:** Roadmap dan positioning penjualan.

**Cara menjawab:** Uji dengan 10 merchant target: apakah ketiadaan integrasi aggregator adalah blocker mutlak atau ketidaknyamanan yang bisa ditoleransi selama 6 bulan? Sekaligus, periksa proses onboarding partner ketiga platform — beberapa memerlukan persetujuan yang memakan waktu berbulan-bulan dan **itu harus dimulai lebih awal dari kodenya**.

---

### OQ-07 — Berapa lama riwayat transaksi direplikasi ke device?

**Konteks:** Fase 5 merekomendasikan 90 hari agar refund offline mungkin. Fase 5 juga mencatat `[ASUMSI]` bahwa 90 hari riwayat + katalog 5.000 SKU muat di bawah 500 MB — angka yang **belum diverifikasi dengan data nyata**.

**Pertanyaan:** Berapa jendela riwayat lokal, dan apakah kapasitas storage perangkat kasir tipikal Indonesia mendukungnya?

**Dampak:** Menentukan kemampuan refund offline — salah satu pembeda versus Shopify yang tidak mengizinkan refund offline sama sekali.

**Blocker untuk:** Spesifikasi kemampuan offline di PRD, dan requirement perangkat minimum.

**Cara menjawab:** Bangun prototipe skema SQLite, isi dengan data sintetis pada volume tenant menengah (30.000 transaksi/bulan), ukur. Ini pekerjaan setengah hari yang menghilangkan asumsi besar.

---

### OQ-08 — Batas kredensial offline versus janji offline tak terbatas

**Konteks:** Fase 8 merekomendasikan perangkat yang tidak terhubung > 30 hari harus diaktivasi ulang, untuk membatasi jendela penyalahgunaan perangkat curian. Fase 5 menjanjikan penjualan tunai offline **tidak terbatas**. Keduanya bertentangan.
*(Fase 8 § 5)*

**Pertanyaan:** Berapa batas kredensial offline, dan apa yang terjadi saat terlampaui?

**Dampak:** Menentukan trade-off antara keamanan perangkat hilang dan janji utama produk.

**Blocker untuk:** PRD (spesifikasi offline), modul identitas.

**Cara menjawab:** Keputusan pemilik produk. Kompromi yang direkomendasikan Fase 8: perangkat melewati batas tetap bisa **menyelesaikan transaksi berjalan dan menutup shift**, tapi tidak bisa membuka shift baru sampai terhubung. Uji apakah ini bisa diterima merchant dengan skenario nyata (outlet tutup 1 bulan saat renovasi).

---

### OQ-09 — Apakah profil vertikal berada di tingkat tenant atau outlet?

**Konteks:** KEP-05 menetapkan profil vertikal berdata sebagai mekanisme "mode" F&B/retail. Tetapi merchant dengan kafe (F&B) dan toko biji kopi (retail) di lokasi berbeda membutuhkan profil berbeda per outlet.
*(Fase 2 § 8)*

**Pertanyaan:** Satu profil per tenant, per outlet, atau bisa keduanya dengan override?

**Dampak:** Menentukan bentuk konfigurasi dan bagaimana katalog dibagi antar outlet dengan vertikal berbeda.

**Blocker untuk:** ERD, IA (di mana pengaturan ini berada).

**Cara menjawab:** Keputusan desain; rekomendasi riset adalah **per outlet dengan default dari tenant**, karena kasus "satu merchant dua vertikal" adalah justru celah pasar yang diincar (Fase 1 § 8, Celah 2). Verifikasi dengan 3 merchant apakah kasus ini nyata di segmen target.

---

## Prioritas 3 — Menyempurnakan keputusan. Jawab sebelum implementasi area terkait.

### OQ-10 — Verifikasi harga cloud regional Jakarta

**Konteks:** Fase 11 § 5 seluruhnya `[ASUMSI]` karena kuota riset habis. Fase 3 merekomendasikan cloud regional Jakarta karena latensi, tetapi **harganya tidak terverifikasi**. Verifikasi tambahan: Hetzner (opsi VPS murah) memiliki lokasi di Jerman, Finlandia, Singapura, dan AS — **tidak ada Jakarta**.
*(Sumber: [Hetzner Cloud](https://www.hetzner.com/cloud/), diakses 27 Jul 2026)*

**Pertanyaan:** Berapa biaya sebenarnya menjalankan stack di Jakarta (AWS/GCP/Alibaba Cloud ID/penyedia lokal), dan seberapa besar penalti latensi jika memakai Singapura?

**Dampak:** Model biaya di Fase 11 dan keputusan hosting di Fase 3.

**Cara menjawab:** Ambil harga dari kalkulator ketiga penyedia untuk konfigurasi target; ukur RTT Jakarta→Singapura versus Jakarta→Jakarta dari koneksi merchant nyata.

---

### OQ-11 — Validasi harga terhadap kemauan bayar

**Konteks:** Fase 11 merekomendasikan Rp349.000 / Rp699.000 per outlet per bulan berdasarkan posisi kompetitif (anchor Moka Rp299.000). Ini `[ASUMSI]` — tidak ada riset kemauan bayar yang dilakukan.

**Pertanyaan:** Apakah merchant 2–20 outlet bersedia membayar premium ~17% di atas Moka untuk keandalan offline dan multi-vertikal?

**Dampak:** Seluruh model pendapatan.

**Cara menjawab:** 30–50 percakapan penjualan nyata dengan harga disebutkan. Bukan survei — survei tentang harga selalu berbohong. Rekomendasi Fase 11 jika lebih dari separuh menolak: turunkan ke Rp299.000 **dan pindahkan sebagian fitur ke Pro**, jangan turunkan harga saja.

---

### OQ-12 — Lisensi open-source POS yang mungkin diperiksa

**Konteks:** Fase 1 mencatat uniCenta/Chromis/Floreant sebagai referensi domain model, dengan peringatan `[ASUMSI]` bahwa turunan Openbravo POS umumnya berlisensi GPL — yang menular ke produk komersial jika kodenya disalin.

**Pertanyaan:** Apakah ada niat memeriksa kode open-source POS mana pun? Jika ya, lisensinya apa?

**Dampak:** Risiko hukum yang tidak bisa diperbaiki setelah terjadi.

**Cara menjawab:** Rekomendasi paling aman: **jangan lihat kodenya sama sekali.** Skema database dan konsep domain sudah cukup diperoleh dari dokumentasi publik Square dan Lightspeed yang lisensinya tidak menular.

---

### OQ-13 — Apakah Firefox benar-benar bisa tidak didukung?

**Konteks:** `[FAKTA]` OPFS belum didukung Firefox, dan SQLite WASM+OPFS adalah pilihan database lokal (KEP-11). Konsekuensinya aplikasi kasir tidak berjalan di Firefox.
*(Fase 3 § 7)*

**Pertanyaan:** Apakah ada merchant di segmen target yang memakai Firefox sebagai browser utama, dan apakah dashboard owner (yang tidak butuh OPFS) cukup untuk mereka?

**Dampak:** Requirement sistem dan pesan penolakan yang harus ditampilkan.

**Cara menjawab:** Rendah risiko — kasir produksi memakai aplikasi desktop Tauri, bukan browser (Fase 7 KEP-27). Cukup pastikan dashboard owner berjalan di Firefox dan aplikasi kasir menampilkan pesan yang jelas, bukan gagal misterius.

---

### OQ-14 — Prototipe Tauri mobile

**Konteks:** KEP-12 merekomendasikan Tauri 2 untuk desktop dan mobile, dengan catatan bahwa **Tauri mobile lebih baru dan kurang terbukti** dibanding Tauri desktop. Rekomendasi: bangun web + desktop dulu, prototipe mobile untuk menilai kematangannya.
*(Fase 3 § 8)*

**Pertanyaan:** Apakah Tauri Android bisa mengakses printer USB/Bluetooth dan barcode scanner dengan andal?

**Dampak:** Jika gagal, mobile harus memakai Capacitor (dua toolchain wrapper) atau tetap PWA.

**Cara menjawab:** Prototipe 1–2 minggu: aplikasi Tauri Android minimal yang mencetak ke printer thermal Bluetooth dan menerima input scanner HID. Ini pekerjaan kecil yang menghilangkan risiko besar, dan sebaiknya dilakukan **sebelum** desain aplikasi mobile dikunci.

---

### OQ-15 — Metode pembayaran QRIS statis: didukung atau tidak?

**Konteks:** Fase 6 merekomendasikan mendukung "QRIS statis (konfirmasi manual)" untuk merchant yang memakai QR statis dari bank mereka. Ini alur nyata, tetapi menciptakan celah kontrol: kasir mengonfirmasi pembayaran secara manual tanpa verifikasi sistem.

**Pertanyaan:** Apakah risiko fraud (kasir menandai "sudah bayar" padahal belum, lalu mengambil tunai) sepadan dengan cakupan merchant yang didapat?

**Dampak:** Alur pembayaran dan laporan exception.

**Cara menjawab:** Keputusan pemilik produk. Mitigasi jika didukung: field referensi wajib, penanda jelas di struk dan laporan bahwa pembayaran dikonfirmasi manual, dan masuk laporan exception per kasir.

---

### OQ-16 — Clover dan DOKU tidak diriset

**Konteks:** Fase 1 mencatat Clover tidak diriset mendalam (tidak beroperasi di Indonesia, modelnya identik Square). Fase 6 mencatat DOKU sebagai payment gateway yang tidak diriset.

**Pertanyaan:** Apakah keduanya perlu diriset sebelum keputusan final?

**Dampak:** Rendah untuk Clover (dampaknya terhadap keputusan arsitektur mendekati nol). Sedang untuk DOKU — jika ia menawarkan kemampuan yang tidak ada di Midtrans/Xendit.

**Cara menjawab:** Lewati Clover. Untuk DOKU, cukup membaca dokumentasi API-nya sebelum menetapkan adapter kedua.

---

## Ringkasan: apa yang tersisa

Enam pertanyaan prioritas tertinggi **sudah diputuskan** (lihat `13-DECISION-LOG.md`). Yang tersisa dan paling berdampak:

1. **OQ-07 — Berapa lama riwayat transaksi direplikasi ke device?** Menentukan kemampuan refund offline, salah satu pembeda utama. Dijawab dengan prototipe setengah hari, bukan diskusi.

2. **OQ-14 — Prototipe Tauri Android.** Menentukan apakah rencana mobile bertahan atau harus pindah ke Capacitor. Prototipe 1–2 minggu, sebaiknya sebelum desain mobile dikunci.

3. **OQ-11 — Validasi harga terhadap kemauan bayar.** Rp349.000/Rp699.000 masih `[ASUMSI]`; hanya bisa diuji dengan 30–50 percakapan penjualan nyata, bukan survei.

Tiga tindakan manusia yang berjalan paralel tanpa memblokir pembangunan: konsultasi pajak (OQ-04/05), email konfirmasi lisensi PowerSync (OQ-03), dan pengecekan program partner aggregator (OQ-06).

---

*Dokumen ini bagian dari paket riset Lumi POS.*
