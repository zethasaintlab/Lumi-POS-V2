# ⛔ "Nol baris, bukan error" — satu kelas kegagalan, bukan lima insiden

Ditulis 2 September 2026, setelah kemunculan **kelima** dalam satu minggu — dan diperbarui hari itu juga dengan yang **keenam**, yang saya lakukan sendiri.

Bentuknya selalu sama: sesuatu gagal, dan yang muncul bukan pesan galat
melainkan **kekosongan yang terlihat sah**. Nol produk terlihat persis seperti
katalog yang memang kosong. Nol baris audit terlihat persis seperti tidak ada
yang melakukannya. Daftar kosong terlihat persis seperti pembebasan.

Kekosongan tidak pernah menuntut siapa pun memeriksanya. Itu yang membuat kelas
ini bertahan berhari-hari di kode yang sudah lolos review dan lolos gate.

---

## 1. Lima kejadian

| # | Kejadian | Mekanisme | Yang SEHARUSNYA menangkapnya |
|---|---|---|---|
| 1 | **Stream `riwayat`, 7 kolom karangan** (2 Sep) | Sync rules menyebut `order.service_charge`, `check.name`, `payment.reference`, … — tidak ada di PostgreSQL. Stream gagal; perangkat menerima nol baris | Penjaga kolom-ada-di-skema. **Tidak ada** sampai hari itu; sembilan test sync-rules memeriksa tenant, klaim, dan `cost` — tidak satu pun bertanya apakah kolomnya ada |
| 2 | **Klaim JWT salah tempat** (8 Agu) | `tenant_id` di dalam objek `parameters`, sementara `auth.parameter('x')` membaca `payload.x`. Cocok dengan `undefined` → katalog kosong permanen | Penjaga silang sync-rules ↔ `tokens.ts`. **Ada sekarang** (`tests/identity/device-token.test.js`), lahir dari kejadian ini |
| 3 | **Delapan token CSS hantu** (31 Agu) | `var(--x)` tanpa definisi. CSS membuang deklarasinya diam-diam — tanpa warning konsol, tanpa fallback | `tests/runtime/token-css-ada.test.js`. **Tidak ada** sampai hari itu; oxlint tidak membaca berkas CSS sama sekali |
| 4 | **Delapan layar menggantung di "memuat"** (31 Agu) | `useDbLokal()` melempar saat render; React membongkar pohonnya. Layar putih, konsol bersih | Galeri komponen dengan keadaan `error` sebagai sel tersendiri. **Ada sekarang** |
| 5 | **K-14 daftar gagal** (1 Sep) | Query agregat lewat `DbLokal` palsu yang tidak mengenal `SUM(CASE …)` → nol, dan indikator melaporkan antrean SEHAT saat ia tidak sehat | Fake yang gagal keras pada SQL yang tidak dikenalnya, alih-alih menjawab nol. **Belum ada** |
| 6 | **Migrasi yang saya laporkan JALAN padahal tidak** (2 Sep) | `npm run db:reset` dijalankan dengan keluaran dibuang; exit code 0 dibaca sebagai sukses. Skripnya sebenarnya berkata *"Database lumi tidak ada — tidak ada yang dibuang"* dan tidak melakukan apa pun | Membaca keluarannya. **Tidak ada penjaga yang mungkin** — ini disiplin, bukan kode |

### ⛔ Kejadian keenam adalah KEJADIAN SAYA SENDIRI, dan bentuknya sedikit berbeda

Kelima yang pertama adalah kekosongan yang dihasilkan MESIN. Yang keenam
dihasilkan **pembacaan**: sebuah perintah selesai tanpa error, keluarannya
tidak dibaca, dan ketiadaan error dikutip sebagai bukti keberhasilan.

Ia sekelas karena mekanismenya identik — **sukses yang diasumsikan dari
ketiadaan error** — dan karena akibatnya sama: laporan yang terdengar
meyakinkan tentang sesuatu yang tidak terjadi. Saya menulis "Migrasi jalan"
di dalam sesi yang seluruhnya tentang mengaudit klaim yang tidak terukur.

### Aturan yang lahir darinya

> **Exit code 0 dengan keluaran dibuang bukan bukti.**
>
> Perintah yang hasilnya akan dikutip wajib dibaca keluarannya, atau
> hasilnya diverifikasi lewat sumber KEDUA — dan yang kedua itulah yang
> dipercaya. Untuk migrasi: bukan "skripnya berhasil", melainkan "tabelnya
> ada di `information_schema`".

Ia bersaudara dengan aturan sabotase yang sudah berlaku sejak 2 September:
**sabotase yang hijau harus dibuktikan benar-benar teraplikasi sebelum
hijaunya dipercaya.** Keduanya satu kalimat: *ketiadaan sinyal bukan
sinyal.*

### Dua sifat yang membuat kelima-limanya sama

**Nol adalah jawaban yang SAH untuk pertanyaan itu.** Katalog boleh kosong.
Antrean boleh kosong. Daftar exception boleh kosong. Karena itu tidak ada
assertion yang wajar yang akan menolaknya.

**Test hijau tidak membuktikan apa pun di sini.** Setiap kejadian punya suite
hijau di atasnya, dan hijaunya benar: test memeriksa hal yang memang benar,
lalu berhenti sebelum pertanyaan yang salah.

### Bentuk penjaga yang bekerja

Ketiga penjaga yang berhasil punya bentuk yang sama, dan ia bukan "assert lebih
banyak":

> **Bandingkan dua sumber yang tidak ada apa pun menyatukannya.**
> Sync rules ↔ DDL. Sync rules ↔ `tokens.ts`. `var(--x)` ↔ definisi token.

Ditambah satu syarat yang mudah dilupakan: **penjaga harus membuktikan ia
memindai sesuatu.** Penjaga yang memeriksa nol berkas hijau selamanya, dan
hijaunya adalah bentuk kekosongan yang sama.

---

## 2. Di mana lagi kegagalan menyamar jadi kekosongan

Disurvei 2 September 2026. **Ini daftar kandidat dengan ukurannya, bukan daftar
cacat** — tidak satu pun diperbaiki, dan sebagian mungkin ternyata aman.

### K1 — Empty state yang tidak dapat membedakan "tidak ada" dari "belum sampai"

**Ukuran: 27 dari 42 berkas ber-`<EmptyState>`** tidak menyebut sinkronisasi
sama sekali (15 menyebut).

Merchant yang membuka laporan dan melihat "Tidak ada transaksi" tidak dapat
tahu apakah outletnya sepi atau perangkatnya belum mengirim. B-21 sudah
menyelesaikan ini lewat `pesanLaporan`, dan alasannya tercatat: *"kegagalan
jaringan yang terbaca sebagai pembebasan orang yang namanya tidak muncul."*
Pola itu belum menyebar ke 27 layar lain.

⛔ **Bukan seluruh 27 perlu diperbaiki.** Layar yang datanya murni lokal
(K-03 katalog di perangkat, dialog) tidak punya masalah ini. Yang perlu dipilah
adalah layar yang datanya melintasi antrean.

### K2 — Endpoint laporan tanpa penyebut

**Ukuran: 1 dari ~20 endpoint laporan** mengembalikan berapa banyak yang
diperiksa (`harga-perangkat.jumlahDiperiksa`).

"Tidak ada yang tertinggal" dari NOL perangkat berarti hal yang sangat berbeda
dari yang sama dari sepuluh perangkat — alasan yang sudah tertulis untuk
FR-A7 dan tidak pernah digeneralisasi. Laporan dengan `outlet_id` yang tidak
cocok mengembalikan nol baris yang tidak dapat dibedakan dari periode sepi.

### K3 — `catch` yang menelan menjadi kekosongan

**Ukuran: 6 di `apps/kasir`, dan 5 di antaranya DINYATAKAN** dengan alasan dan
arahnya (`fitur/baca.ts`, `kas/tutup.ts`, `App.tsx`, `keranjang-simpan.ts`,
`telemetri/kirim.ts`). Itu bukan cacat — itu keputusan yang ditulis.

Satu yang **tidak dinyatakan**: `apps/kasir/src/riwayat/baca.ts:359` —
`modifier_snapshot` yang gagal di-parse menjadi `[]`, dan baris tanpa modifier
terlihat persis sama dengan baris yang modifiernya tidak terbaca. Di layar yang
dipakai memutuskan refund.

⛔ **86 pemanggilan `getAll` lainnya TIDAK termasuk kandidat**: yang melempar
akan muncul sebagai keadaan error, dan itu perilaku yang benar. Angka besar di
sini akan menyesatkan.

### K4 — Stream sync rules SELAIN `riwayat`

**Ukuran: nol kandidat tersisa.** Ketiga stream (`katalog`, `riwayat`,
`identitas`) kini dilewati penjaga kolom yang sama, dan ketiganya hijau. Klaim
yang dipakai (`tenant_id`, `outlet_id`, `device_id`) dijaga penjaga silang
terhadap `tokens.ts`.

Yang **tetap tidak terjaga** adalah lapisan di bawah nama kolom: tipe yang
berbeda antara PostgreSQL dan SQLite lokal. Dua kolom masih di
`KOLOM_BELUM_DIUKUR` (`modifier_snapshot`, `is_tax_inclusive`), dan stream ini
belum pernah dijalankan terhadap PowerSync sungguhan.

### K5 — Raw table yang belum dibangun

**Ukuran: 1, dan sudah tertulis di `CLAUDE.md`** — bukan temuan baru.
`waitForFirstSync()` selesai dalam 0 ms dan **melaporkan sukses** setelah raw
table dibangun ulang, sementara katalog kosong permanen. Penawarnya
(`disconnectAndClear()`) sudah dipasang; yang tidak ada adalah penjaga yang
menolak migrasi raw table tanpanya.

### K6 — Pencarian katalog

**Ukuran: nol kandidat.** `cariItem` menyaring array yang sudah di tangan dan
`q === ''` mengembalikan seluruh daftar; pencarian yang tidak menemukan apa pun
memang berarti tidak ada yang cocok. Cabang `category_id IS NULL` di sisi server
(`TANPA_KATEGORI`) adalah kejadian kelas ini yang **sudah diperbaiki** dan
tercatat di `CLAUDE.md`.

⛔ `cariBarcode` sengaja **tidak memilih siapa pun** saat barcode ganda — itu
kekosongan yang BENAR, dan menebak di sana jauh lebih berbahaya.

---

## 3. Ringkasan ukuran

| Kandidat | Ukuran | Perlu diperiksa? |
|---|---|---|
| K1 empty state tanpa konteks antrean | 27 berkas | sebagian — perlu dipilah |
| K2 endpoint laporan tanpa penyebut | ~19 endpoint | ya |
| K3 `catch` menelan tanpa dinyatakan | **1** | ya, kecil |
| K4 stream sync rules lain | 0 tersisa | tidak |
| K5 raw table belum dibangun | 1, sudah tertulis | penjaganya belum ada |
| K6 pencarian katalog | 0 | tidak |

Yang paling besar (K1, K2) juga yang paling **tidak seragam** — sebagian
anggotanya bukan cacat sama sekali. Angka di kolom "ukuran" adalah **batas
atas populasi yang perlu dipilah**, bukan jumlah cacat. Membacanya sebagai
jumlah cacat akan mengulangi kesalahan yang audit klaim berangka baru saja
tunjukkan.


---

## 4. Registri klaim — penjaga untuk kelas "catatan yang membusuk"

`tests/runtime/klaim-registri.test.js`, dibuat 2 September 2026.

Kelas ini adalah saudara dekat "nol baris, bukan error": catatan berangka yang
benar saat ditulis, lalu membusuk diam-diam, lalu **dikutip sebagai
pengukuran**. Itu terjadi — "delapan salinan pemformat rupiah" dikutip dari
catatan 24 Agustus yang utangnya sudah lunas.

Registri menyimpan, per klaim: berkas tempat kalimatnya hidup, **frasa
persisnya**, nilai yang ditulis, dan **fungsi yang mengukur ulang**. Ia
memeriksa DUA arah:

| Arah | Yang ditangkap |
|---|---|
| `ukur() == harap` | kode menjauh dari klaimnya |
| `frasa` masih ada di `berkas` | kalimatnya disunting tanpa registrinya ikut — entri yang menjaga hantu |

Arah kedua yang mudah dilupakan, dan tanpanya penjaganya hijau selamanya
setelah kalimat pertama disunting.

### ⛔ Aturan masuk, dan ia SEMPIT

Hanya klaim yang pengukurnya **murah dan kokoh**. Klaim yang menuntut
penghitung rapuh **tidak masuk registri — dan karena itu tidak boleh punya
angka sama sekali** di prosa mana pun. "52 layar" dan "414 acceptance criteria"
adalah contohnya: regex atas dokumen produk menjawab 53 dan 415, dan selisih
satu itu jauh lebih mungkin salah pola daripada salah dokumen.

### Yang registri temukan pada menit pertamanya

Tiga, dan **dua di antaranya cacat pengukurnya sendiri** — diperbaiki sebelum
satu pun dilaporkan sebagai temuan:

1. `35 berkas mengimpornya` → terukur 36. **Pengukurnya yang salah:** ia
   memakai `includes('uang-tampilan')`, dan yang ke-36 adalah
   `packages/ds/index.ts` yang MENYEBUTNYA di komentar tanpa mengimpor apa pun.
   Klaimnya berbunyi "mengimpornya", jadi pengukurnya harus mengukur impor.
2. `ppn` nol → terukur 1. **Yang satu itu ada di dalam pengukurnya sendiri.**
   Penjaga yang mengukur dirinya sendiri melaporkan dunia yang ia ciptakan.
3. `4 dari 47 berkas test kasir` → terukur 4/48. **Drift NYATA**, dari berkas
   test yang ditambahkan hari itu juga. Dokumennya diperbaiki.

Dua dari tiga temuan pertama adalah penjaganya sendiri yang salah. Itu bukan
kebetulan: penghitung selalu lebih rapuh daripada yang menulisnya kira, dan
itulah kenapa aturan masuknya sempit.
