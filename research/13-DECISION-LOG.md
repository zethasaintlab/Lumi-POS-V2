# 13 — Decision Log

> Catatan keputusan atas open question. Ditambahkan setelah paket riset selesai.
> Tanggal: 27 Juli 2026.
> Penanda: `[FAKTA]` = bersumber · `[INFERENSI]` = kesimpulan dari beberapa fakta · `[ASUMSI]` = diisi sendiri.

---

## Status enam open question

| # | Pertanyaan | Status | Diputuskan oleh |
|---|---|---|---|
| OQ-01 | Ambisi offline lintas device | ✅ **Terima batas** | Pemilik produk |
| OQ-02 | On-premise di v1 | ✅ **Ditunda, arsitektur disiapkan** | Pemilik produk |
| OQ-03 | Lisensi FSL PowerSync | ✅ **Terselesaikan dari teks lisensi** | Riset (sumber primer) |
| OQ-04 | Kewajiban fiskal pasca-Coretax | ⚠️ **Keputusan rekayasa diambil; verifikasi hukum tetap wajib** | Riset (sisi rekayasa) |
| OQ-05 | Pajak dine-in vs takeaway | ⚠️ **Keputusan rekayasa diambil; verifikasi hukum tetap wajib** | Riset (sisi rekayasa) |
| OQ-06 | Integrasi aggregator di v1 | ✅ **Tidak di v1; proses partner dimulai sekarang** | Riset (cakupan produk) |

**Cara membaca tanda ⚠️:** OQ-04 dan OQ-05 adalah pertanyaan **hukum**, dan riset ini tidak bisa menjawabnya — tidak ada nasihat pajak yang diberikan di sini. Yang diputuskan adalah **desain yang hasilnya sama benar apa pun jawaban hukumnya**, sehingga verifikasi ke konsultan pajak berpindah dari *blocker arsitektur* menjadi *item checklist sebelum rilis*. Bedanya besar: yang pertama menghentikan pekerjaan, yang kedua tidak.

---

## OQ-01 — Ambisi offline lintas device: **TERIMA BATAS**

**Keputusan:** v1 mengadopsi model **satu device = satu unit otonom penuh**. Tidak ada berbagi order antar POS device saat offline.

**Konsekuensi yang sekarang mengikat:**

| Area | Dampak |
|---|---|
| Cakupan v1 | KDS, table management, dan hub lokal **keluar dari v1**, masuk v1.1 sebagai satu paket (semuanya butuh transport lokal-outlet yang sama) |
| Segmen | **Kafe takeaway dan retail** adalah target v1. Resto dine-in dengan banyak terminal **bukan** target v1 — ini harus tertulis di kualifikasi lead, bukan ditemukan saat demo |
| Arsitektur | Tidak ada leader election, tidak ada discovery LAN, tidak ada protokol partisi jaringan di v1. Menghapus kelas bug terbesar dari cakupan awal |
| Materi penjualan | Batas ini **ditulis di depan**, bukan di FAQ. Contoh kalimat: "Setiap kasir bekerja penuh tanpa internet. Saat offline, pesanan tidak berpindah antar mesin kasir — sama seperti Toast." |
| Estimasi | Menghemat ~10–16 minggu dari jalur kritis v1 |

**Yang tetap dijanjikan penuh** (dari KEP-23): buka shift offline · jual · refund · update stok lokal · cetak · tutup kas — semuanya tanpa internet, tanpa batas durasi untuk pembayaran tunai.

**Kapan ditinjau ulang:** saat merchant dine-in menjadi porsi signifikan pipeline, atau saat permintaan KDS offline berulang. Pada titik itu bangun hub lokal dengan cakupan sempit (hub → KDS saja).

---

## OQ-02 — On-premise: **DITUNDA, ARSITEKTUR DISIAPKAN**

**Keputusan:** paket on-premise **tidak dibangun** sampai ada pelanggan yang membayar biaya implementasi di muka. Disiplin arsitektur yang membuatnya tetap mungkin **tetap ditegakkan sejak hari pertama**.

**Enam aturan arsitektur yang sekarang mengikat** (dari KEP-33):

1. Tidak ada managed service proprietary tanpa padanan self-hosted.
2. Satu `docker-compose.yml` yang sama untuk SaaS dan on-premise; perbedaan hanya lewat environment variable.
3. Seluruh konfigurasi lewat env — tanpa hardcode host, region, atau endpoint.
4. Migrasi skema idempoten dan aman untuk instalasi yang tertinggal beberapa versi.
5. Tidak ada asumsi bahwa server bisa menjangkau internet keluar.
6. **Tidak ada `if (isOnPrem)` di kode aplikasi.** Kemunculannya adalah item review yang ditolak.

**Konsekuensi komersial:** dalam percakapan enterprise, jawabannya menjadi *"tersedia sebagai on-premise dengan biaya implementasi di muka, siap Y minggu setelah kontrak"* — yang sekaligus mengkualifikasi calon pelanggan. Yang menolak membayar di muka, kebutuhan on-premise-nya tidak nyata.

**Yang dihemat:** 8–14 minggu kerja awal + 15–25% overhead permanen setiap rilis.

---

## OQ-03 — Lisensi FSL PowerSync: **TERSELESAIKAN**

Ini satu-satunya dari enam yang bisa dijawab tuntas dari sumber primer, dan hasilnya **lebih baik dari perkiraan awal riset**.

### Teks lisensi yang menentukan

`[FAKTA]` PowerSync Open Edition berada di bawah **FSL-1.1-ALv2**, Copyright 2023-2026 Journey Mobile, Inc. Klausa yang menentukan:

> **Permitted Purpose.** A Permitted Purpose is any purpose other than a Competing Use. A **Competing Use** means making the Software available to others in a commercial product or service that:
> 1. substitutes for the Software;
> 2. substitutes for any other product or service we offer using the Software that exists as of the date we make the Software available; or
> 3. offers the same or substantially similar functionality as the Software.
>
> Permitted Purposes **specifically include** using the Software:
> 1. **for your internal use and access**; …

`[FAKTA]` **Redistribusi diizinkan secara eksplisit**, dengan syarat: *"If you redistribute any copies, modifications or derivatives of the Software, you must include a copy of or a link to these Terms and Conditions and not remove any copyright notices."*

`[FAKTA]` **Grant of Future License:** *"We hereby irrevocably grant you an additional license to use the Software under the Apache License, Version 2.0 that is effective on the second anniversary of the date we make the Software available."* Jangka dua tahun berlaku **per versi** yang dirilis.

`[FAKTA]` **Client SDK berlisensi Apache-2.0** (open source penuh), terpisah dari PowerSync Service.

*Sumber: ⭐ [PowerSync Functional Source License (FSL)](https://www.powersync.com/legal/fsl) · ⭐ [PowerSync Licensing & Terms Overview](https://www.powersync.com/legal/licensing-terms) · ⭐ [FSL-1.1-ALv2 template — fsl.software](https://fsl.software/FSL-1.1-ALv2.template.md) · [FSL — Functional Source License](https://fsl.software/) (semua diakses 27 Jul 2026)*

### Analisis untuk dua skenario Lumi POS

**Skenario A — SaaS (PowerSync Service berjalan di infrastruktur Lumi POS).** `[INFERENSI]`

Merchant tidak menerima Software; mereka menerima POS. PowerSync Service berjalan sebagai infrastruktur internal. Ini jatuh langsung pada Permitted Purpose yang **disebut eksplisit**: *"for your internal use and access."* Ketiga uji Competing Use gagal terpenuhi — Lumi POS bukan pengganti PowerSync, bukan pengganti PowerSync Cloud, dan tidak menawarkan fungsi yang sama atau serupa (POS ≠ sync engine).

**→ Jelas diizinkan. Risiko rendah.**

**Skenario B — On-premise (PowerSync Service dikirim dalam paket ke server merchant).** `[INFERENSI]`

Di sini Lumi POS memang *"making the Software available to others in a commercial product"*, sehingga uji Competing Use berlaku:
- Uji 1 — apakah Lumi POS **menggantikan** PowerSync? Tidak.
- Uji 2 — apakah menggantikan produk lain PowerSync yang memakai Software? PowerSync menjual **Enterprise Self-Hosted Edition**. Pembacaan wajar: merchant membeli POS, bukan sync engine, sehingga tidak menggantikan. **Tapi inilah satu-satunya klausa dengan ambiguitas nyata.**
- Uji 3 — apakah menawarkan fungsi yang sama atau serupa? Tidak.

Klausa Redistribution justru mengantisipasi redistribusi dan mengizinkannya dengan syarat atribusi — artinya membundel bukan larangan per se, melainkan tunduk pada uji Permitted Purpose.

**→ Pembacaan wajar mengizinkan. Ambiguitas terbatas pada uji 2.**

### Keputusan

| Aspek | Keputusan |
|---|---|
| Untuk SaaS | **PowerSync Open Edition dipakai.** Tidak ada hambatan lisensi |
| Untuk on-premise | Pembacaan wajar mengizinkan, tapi **minta konfirmasi tertulis ke hello@powersync.com sebelum kontrak on-premise pertama.** Biayanya satu email; risikonya sengketa lisensi di depan pelanggan enterprise |
| Urgensi | **Tidak mendesak.** Karena OQ-02 menunda on-premise, klausa yang ambigu tidak menyentuh apa pun yang dibangun di 12+ bulan ke depan |
| Arsitektur | KEP-22 (hybrid: PowerSync untuk jalur turun, outbox sendiri untuk jalur naik) **dipertahankan**, sekarang dengan alasan tambahan — jalur yang membawa uang tetap bebas ketergantungan pihak ketiga |

**Jalan keluar permanen yang perlu diketahui** `[INFERENSI]`: karena setiap versi otomatis menjadi Apache 2.0 setelah dua tahun, selalu tersedia opsi mengunci ke versi berumur >2 tahun yang lisensinya open source penuh. Ini membuat risiko *vendor lock-in* jauh lebih kecil daripada lisensi proprietary biasa — dan menghilangkan skenario terburuk (PowerSync mengubah lisensi secara sepihak).

**Dua kekhawatiran awal riset yang terbantah:** (a) FSL bukan lisensi yang melarang penggunaan komersial — ia hanya melarang membangun kompetitor; (b) SDK klien Apache-2.0 berarti kode yang berjalan di perangkat merchant sepenuhnya open source.

---

## OQ-04 — Kewajiban fiskal pasca-Coretax: **KEPUTUSAN REKAYASA DIAMBIL**

> ⚠️ Ini **bukan** nasihat pajak. Yang diputuskan adalah desain sistem, bukan interpretasi hukum.

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Integrasi API Coretax di v1 | **Tidak.** Dinyatakan sebagai non-goal eksplisit di PRD |
| Yang dibangun sebagai gantinya | **Ekspor rekapitulasi penjualan** dalam format yang bisa dipakai merchant atau akuntannya untuk pelaporan |
| `SigningHook` (port penandatanganan transaksi) | **Port dibuat, implementasi no-op.** Ada tempatnya, tidak ada isinya |
| Status verifikasi hukum | Berpindah dari *blocker arsitektur* menjadi **item checklist sebelum rilis komersial** |

**Alasan** `[INFERENSI]`:

Riset tidak menemukan bukti bahwa Indonesia menerapkan *fiscalization real-time* — model Eropa di mana setiap struk harus disahkan pemerintah sebelum dicetak. Coretax adalah sistem administrasi perpajakan (pendaftaran, pelaporan SPT, pembayaran, pemeriksaan), bukan sistem pengesahan struk. `[FAKTA]` Yang berubah per Juli 2026 adalah berakhirnya DJP Online dan aplikasi desktop e-Faktur, dan itu menyentuh **wajib pajak**, bukan penyedia sistem POS.

Yang membuat keputusan ini aman diambil sekarang: **jika ternyata kewajiban semacam itu muncul, `SigningHook` sudah ada di tempat yang benar** — satu titik terpusat setelah commit transaksi dan sebelum cetak. Menambahkannya belakangan pada sistem yang logika cetaknya tersebar di banyak layar adalah pekerjaan berminggu-minggu; menambahkannya pada port yang sudah ada adalah satu adapter.

Ditambah, keputusan append-only (KEP-17) sudah memenuhi semangat persyaratan integritas data yang menjadi inti sertifikasi POS Eropa. Sistem yang bisa meng-`UPDATE` transaksi selesai akan gagal sertifikasi mana pun; sistem ini tidak bisa.

**Yang tetap harus dilakukan manusia:** verifikasi ke pajak.go.id dan konsultan pajak **sebelum merchant berbayar pertama**, dengan dua pertanyaan spesifik: (a) adakah kewajiban bagi penyedia sistem POS, (b) adakah rencana fiscalization real-time. Jawaban "tidak" pada keduanya mengonfirmasi keputusan ini; jawaban "ya" mengaktifkan `SigningHook` tanpa mengubah arsitektur.

---

## OQ-05 — Pajak dine-in vs takeaway: **KEPUTUSAN REKAYASA DIAMBIL**

> ⚠️ Sama seperti OQ-04 — desain sistem, bukan interpretasi hukum.

**Keputusan:** `TaxRate` memiliki **channel sebagai dimensi yang didukung** (`dine_in` / `takeaway` / `all`), **dengan default `all`** — tarif sama untuk keduanya sampai merchant atau verifikasi hukum menyatakan sebaliknya.

**Alasan** `[INFERENSI]` — ini keputusan asimetris, dan asimetrinya yang menentukan:

| Jika legal menjawab… | Dengan channel sebagai dimensi | Tanpa channel sebagai dimensi |
|---|---|---|
| "Sama, keduanya PBJT" | Default `all` sudah benar. **Nol pekerjaan** | Sudah benar. Nol pekerjaan |
| "Berbeda — takeaway kena PPN" | Ubah satu baris konfigurasi. **Nol migrasi** | **Migrasi seluruh model pajak** + audit ulang setiap transaksi historis |

Biaya membangun kapabilitasnya sekarang: satu kolom dan satu kondisi di `TaxCalculator`. Biaya tidak membangunnya, jika jawabannya "berbeda": migrasi model pajak pada sistem yang sudah punya data finansial pelanggan. Ketika satu sisi berbiaya satu kolom dan sisi lain berbiaya migrasi finansial, tidak ada alasan menunggu jawaban.

**Yang mendukung keputusan ini secara gratis:** design system sudah punya `SegmentedControl` untuk mode Dine In/Takeaway, artinya order **sudah** mencatat channel. Menjadikannya dimensi pajak tidak menambah data baru — hanya memakai yang sudah ada.

**Yang tetap harus dilakukan manusia:** tanyakan ke konsultan pajak **dan** ke 3 merchant kafe yang sudah beroperasi (apa yang mereka lakukan sekarang, apa yang diminta pemda mereka). Jawaban merchant sering lebih menentukan praktik daripada teori, karena merekalah yang berhadapan dengan pemda.

---

## OQ-06 — Integrasi GoFood/GrabFood/ShopeeFood: **TIDAK DI v1, PROSES PARTNER DIMULAI SEKARANG**

**Keputusan:**

| Aspek | Keputusan |
|---|---|
| Integrasi di v1 | **Tidak** |
| Proses onboarding partner | **Dimulai sekarang**, paralel dengan pembangunan v1 |
| Target integrasi | **v1.1**, atau kapan pun persetujuan partner turun — mana yang lebih lambat |
| Yang disiapkan di v1 | Boundary arsitektural: `Order` punya `source_channel` (`pos` / `gofood` / `grabfood` / `shopeefood`), dan batas "yang bisa offline" versus "yang butuh cloud" ditarik eksplisit |
| Urutan platform | **GoFood dan GrabFood dulu**, ShopeeFood menyusul |

**Alasan** `[INFERENSI]` — dua fakta yang menarik ke arah berlawanan, dan keputusannya menghormati keduanya:

**Fakta yang menarik ke "harus ada":** `[FAKTA]` ESB mencantumkan integrasi GoFood & GrabFood bahkan di paket **Basic (Rp0)**. Ini table stakes pasar, bukan fitur premium.

**Fakta yang menarik ke "tidak bisa di v1":** waktu persetujuan partner berada **di luar kendali** dan bisa melebihi waktu menulis kodenya. Memblokir rilis v1 pada persetujuan pihak ketiga adalah cara paling andal untuk tidak pernah merilis.

**Yang menyelesaikan ketegangan:** kedua fakta itu tidak menuntut hal yang sama. "Table stakes" menuntut *ada dalam waktu dekat*; "lead time eksternal" menuntut *dimulai lebih awal dari yang terasa perlu*. Keduanya dipenuhi dengan memulai proses administratif sekarang dan merilis v1 tanpa menunggunya.

**Dukungan tambahan dari riset:** `[FAKTA]` ESB sendiri men-tier ini — Basic hanya Grab & GoFood, Advanced baru ketiganya. Bahkan pemimpin pasar tidak memberikan ketiganya sekaligus di tier terendah. Ini menurunkan tekanan untuk mengirim ketiganya di rilis pertama.

**Konsekuensi go-to-market yang harus diterima secara sadar:** sebagian kafe akan menolak di percakapan pertama. Mitigasi: kualifikasi lead di awal (kafe dengan porsi aggregator kecil, kafe baru yang belum onboard aggregator, dan retail — yang tidak butuh sama sekali). Ini menyempitkan pipeline awal, dan itu memang konsekuensinya.

**Tindakan konkret minggu ini:** cari tahu persyaratan dan lini masa program partner/integrator ketiga platform. Ini pekerjaan administratif, bukan teknis, dan jam mulainya menentukan tanggal v1.1.

---

## Ringkasan dampak pada rencana

**Yang berubah dari paket riset:**

| Perubahan | Sumber |
|---|---|
| KDS, table management, hub lokal → **keluar dari v1**, masuk v1.1 sebagai satu paket | OQ-01 |
| Resto dine-in multi-terminal → **bukan segmen v1**; kafe takeaway + retail adalah target | OQ-01 |
| Paket on-premise → **tidak dibangun**; enam aturan arsitektur tetap mengikat | OQ-02 |
| PowerSync → **dipakai tanpa hambatan** untuk SaaS; satu email konfirmasi sebelum on-prem pertama | OQ-03 |
| `SigningHook` → **port dibuat, no-op**; ekspor rekapitulasi masuk v1 | OQ-04 |
| `TaxRate` → **channel sebagai dimensi**, default `all` | OQ-05 |
| Aggregator → **v1.1**; proses partner dimulai minggu ini; `source_channel` di v1 | OQ-06 |

**Estimasi v1 setelah keputusan:** `[ASUMSI]` turun dari 20–29 minggu menjadi **±18–24 minggu**, terutama karena KDS/table management/hub lokal keluar dari jalur kritis dan on-premise tidak dibangun.

**Yang sekarang tidak memblokir apa pun:** seluruh enam pertanyaan. PRD bisa ditulis.

**Yang tetap harus dikerjakan manusia, tanpa memblokir:**

| Tindakan | Kapan | Memblokir apa |
|---|---|---|
| Konsultan pajak: dua pertanyaan OQ-04 + OQ-05 | Sebelum merchant berbayar pertama | Rilis komersial, bukan pembangunan |
| Email konfirmasi lisensi ke PowerSync | Sebelum kontrak on-premise pertama | Kontrak on-prem, bukan v1 |
| Cek program partner aggregator | Minggu ini | Tanggal v1.1, bukan v1 |
| Prototipe SQLite sizing (OQ-07) | Sebelum menjanjikan refund offline 90 hari | Satu angka di PRD |
| Prototipe Tauri Android (OQ-14) | Sebelum desain mobile dikunci | Rencana mobile, bukan v1 |

---

*Dokumen ini bagian dari paket riset Lumi POS. Lihat `12-OPEN-QUESTIONS.md` untuk sepuluh pertanyaan yang belum diputuskan.*
