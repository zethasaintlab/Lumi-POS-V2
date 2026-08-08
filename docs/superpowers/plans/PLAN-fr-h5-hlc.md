# PLAN — FR-H5: HLC di bawah jam yang melenceng

**Status:** SELESAI 8 Agustus 2026 — dikerjakan atas instruksi "lanjutkan"
**Fase:** F2 · **Spec:** `product/specs/spec-h-sinkronisasi.md` FR-H5 (baris 149–174) dan §H.5

---

## 1. Kenapa ini yang dikerjakan

Modul F ada di **F3** menurut `ARCH:§14`; menariknya ke sini memperluas fase. Yang dicari karena itu pekerjaan F2 yang **tidak** terhalang identitas perangkat — dan `spec-h:336` menyebut satu:

> **Urutan kausal** — HLC menjaga urutan meskipun jam melenceng *(belum divalidasi prototipe)*

Satu-satunya baris di daftar invariant H.5 yang masih bertanda begitu.

Alasannya terlihat begitu harness dibaca: **seluruh perangkat berbagi SATU jam.** `jalankanSatuIterasi` membuat satu `createClock` dan mengopernya ke ketiga perangkat. Tidak ada skew, tidak ada jam mundur, dan **tidak ada satu pun dari I1–I8 yang membaca `order.hlc`.** Nilainya dihitung, disimpan, lalu diabaikan.

`spec-h:351` mendaftarkan "Jam device mundur/maju" sebagai fault yang **wajib** diinjeksikan. Ia tidak pernah diinjeksikan sama sekali.

---

## 2. Yang dibangun

**Jam per perangkat.** Masing-masing punya `createClock` sendiri dengan offset yang mengelilingi ambang 5 menit di `spec-h:173` — ada yang di bawahnya, ada yang jauh di atas. Ketiganya maju bersama tiap langkah; sesekali salah satu **mundur**, kadang 1 detik, kadang satu hari penuh.

**Server mengembalikan HLC-nya.** `spec-h:157` menuntut perangkat memperbarui HLC "setiap kali menerima HLC yang lebih besar dari server". Sampai sekarang server tidak mengembalikan apa pun, jadi kalimat itu tidak dapat dipenuhi siapa pun. Sekarang ia menyerap HLC tiap record yang masuk dan mengembalikan yang tertinggi; perangkat memanggil `hlc.update()`.

**Dua invariant baru.**

- **I9 — urutan kausal.** Apa pun yang perangkat BUAT setelah ia MELIHAT keadaan server harus mengurutkan sesudah keadaan itu. Ini definisi happens-before paling langsung yang dapat diperiksa tanpa melacak seluruh graf kausal, dan ia cukup: satu-satunya jalan informasi masuk ke perangkat adalah respons server.
- **I10 — monotonisitas per perangkat.** Satu perangkat tidak pernah menghasilkan HLC yang tidak naik, apa pun yang terjadi pada jam dindingnya. Inilah yang membedakan HLC dari timestamp.

**Dua mode cacat**, tinggal permanen seperti kelima mode sebelumnya:

- `hlc_dari_jam` — HLC diambil mentah dari jam dinding tanpa counter logis. Persis yang dilakukan orang yang mengira "HLC" hanyalah timestamp, dan ia bekerja sempurna sampai jam mundur.
- `abaikan_hlc_server` — perangkat MELIHAT HLC server (ia ada di respons) tapi tidak menggabungkannya.

---

## 3. Yang tidak dikerjakan

- **AC ketiga FR-H5** — "Selisih jam > 5 menit menghasilkan audit event" — spec sendiri menunjuk Modul F (FR-F8). Ambang skew-nya sudah diinjeksikan di harness; yang belum ada adalah tempat audit event itu ditulis.
- **`owned_by_device_id` pada order `OPEN`** (AC resolusi konflik ketiga) — kolomnya ada di skema sejak F0, tapi tidak ada order `OPEN` lintas-perangkat di harness karena berbagi order antar device saat offline ada di daftar "jangan bangun".
- **Property test konvergensi** (AC keempat resolusi konflik) — I3 sudah memeriksa konvergensi himpunan transaksi; yang belum ada adalah konvergensi data mutable ber-LWW, dan katalog belum pernah ditulis dari perangkat.

---

## 4. Bukti

### Suite DST

```
✔ protokol bertahan 10000 iterasi fault injection (943 ms)   ← gate F2, kini dengan skew + jam mundur
✔ seed yang sama menghasilkan hasil yang sama persis
✔ I9 & I10 menyala di gate: jam tiap perangkat berbeda dan sesekali mundur
✔ cacat hlc_dari_jam tertangkap I10
✔ cacat abaikan_hlc_server tertangkap I9
✔ cacat HLC tidak terlihat oleh I1-I8 -- itu alasan I9 dan I10 ada
14 test, 0 gagal
```

Gate 10.000 iterasi tetap hijau **setelah** skew dan jam mundur ditambahkan — itu hasil yang tidak dijamin sebelumnya, karena sebelumnya tidak ada yang melenceng.

### Sabotase

| Yang dimatikan | Akibat |
|---|---|
| `offsetJamMs` dipaksa 0 (tidak ada skew) | test jangkar merah: "jam perangkat tidak saling geser" |
| jam tidak pernah mundur | test jangkar merah: "tidak ada jam yang pernah mundur -- I10 tidak diuji" |
| I9 dilumpuhkan | `abaikan_hlc_server` lolos — membuktikan hanya I9 yang melihatnya |

Dua sabotase pertama menyerang **jangkar**-nya, bukan invariantnya: harness yang tidak benar-benar melencengkan jam akan membuat I9 dan I10 hijau tanpa menguji apa pun.

---

## 5. Yang perlu kamu putuskan

`spec-h:336` masih menandai urutan kausal "belum divalidasi prototipe", dan daftar invariant H.5 belum memuat I9/I10. **Penyuntingan `product/specs/` bukan kewenangan agent** — kalau kamu setuju baris itu sekarang tertutup, itu suntinganmu.
