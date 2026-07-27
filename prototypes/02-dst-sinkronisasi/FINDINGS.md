# Temuan Prototipe 02 — Deterministic Simulation Testing untuk Sinkronisasi

**Tanggal:** 27 Juli 2026 · **Menjawab:** R1 (risiko fatal di PRD) + validasi KEP-16, KEP-17, FR-H1…H5
**Skrip:** `sim.py` (harness + 5 mode cacat) · `stress.py` (validasi jaringan buruk)

> **Mengapa DST.** `/product/ARCH-lumi-pos-v1.md` § 11 menyatakan waktu, keacakan, dan I/O harus di-inject sebagai dependensi **sebelum** kode sinkronisasi ditulis. Prototipe ini membuktikan pendekatan itu bekerja dan sekaligus menemukan bahwa daftar invariant awal saya **tidak lengkap**.

---

## Ringkasan

| Temuan | Dampak |
|---|---|
| **Protokol yang didokumentasikan lolos 2.000 iterasi** dan bertahan pada jaringan "bencana" (70% request hilang, 65% respons hilang, 50% duplikat, 8 device) | Desain sinkronisasi di spec H valid pada level protokol |
| **Daftar invariant awal saya hanya menangkap 1 dari 5 cacat** | Invariant I1–I5 tidak cukup; butuh I6 (offline), I7 (immutabilitas), I8 (higienis idempotency) |
| **`server_idem_after_tx` selamat berkat ULID client-generated** | Membuktikan KEP-16 benar: dua mekanisme, bukan salah satu |
| **DST menemukan cacat dengan seed yang mereproduksinya persis** | Debugging tidak menjadi arkeologi |

---

## 1. Yang dimodelkan

Protokol dari `/product/specs/spec-h-sinkronisasi.md`:

- `outbox_local` persisten dengan **idempotency key di-generate saat item dibuat**, bukan saat dikirim
- Server dedup lewat tabel `idempotency_key`: key sama + body sama → kembalikan respons asli; key sama + body beda → `422`
- ULID **client-generated** sebagai primary key (jaring pengaman kedua)
- Transaksi append-only; void = record baru, bukan mutasi
- Nomor struk `K{device}-{tanggal}-{urutan}` dengan counter **lokal**

**Fault yang diinjeksikan setiap tick:** request hilang · respons hilang setelah server sukses · request duplikat · perangkat putus/sambung acak · aplikasi crash · void transaksi lama.

Seluruh keacakan dikendalikan satu seed.

---

## 2. Hasil — protokol yang benar

```
mode=none    iterasi=2000    GAGAL=0    lolos=2000
```

**Stress test pada kondisi jaringan yang jauh lebih buruk:**

| Jaringan | Request hilang | Respons hilang | Duplikat | Device | Iterasi | Gagal |
|---|---:|---:|---:|---:|---:|---:|
| Normal | 15% | 12% | 8% | 3 | 300 | **0** |
| Buruk | 35% | 30% | 20% | 3 | 300 | **0** |
| Ekstrem | 55% | 50% | 35% | 5 | 300 | **0** |
| Bencana | 70% | 65% | 50% | 8 | 300 | **0** |

Pada skenario "bencana", tujuh dari sepuluh request tidak pernah sampai dan dua pertiga respons hilang — protokol tetap konvergen tanpa kehilangan atau menggandakan satu transaksi pun.

---

## 3. Temuan utama — invariant awal tidak lengkap

Ini hasil yang paling berharga dari prototipe ini.

Menjalankan lima mode cacat terhadap invariant awal (I1 konservasi, I2 duplikasi, I3 konvergensi, I4 monotonisitas, I5 uang):

| Mode cacat | Terdeteksi? |
|---|---|
| `outbox_in_memory` — antrean hilang saat crash | ✅ ya |
| `regen_idem_on_retry` — klien buat key baru tiap retry | ❌ **lolos** |
| `server_idem_after_tx` — key ditulis di transaksi terpisah | ❌ **lolos** |
| `seq_from_server` — nomor struk diminta ke server | ❌ **lolos** |
| `void_as_update` — void mengubah record, bukan append | ❌ **lolos** |

**Empat dari lima cacat lolos.** Kalau harness ini dipakai apa adanya untuk memvalidasi kode produksi, ia akan memberi rasa aman palsu.

### Mengapa lolos — dan apa yang ditambahkan

| Cacat | Mengapa lolos | Invariant yang ditambahkan |
|---|---|---|
| `regen_idem_on_retry` | ULID PK mencegah duplikasi, jadi I1–I5 bersih. Tapi tabel idempotency membengkak dan deteksi `422` rusak | **I8 higienis idempotency** — satu order tidak boleh punya >1 key |
| `seq_from_server` | Perangkat sekadar **tidak berjualan** saat offline. Tidak ada invariant yang dilanggar — tapi bisnisnya gagal | **I6 kemampuan jual offline** — penjualan tidak boleh gagal karena tidak ada koneksi |
| `void_as_update` | Mutasi tidak terdeteksi karena tidak ada yang membandingkan record dengan tulisan pertamanya | **I7 immutabilitas** — snapshot saat tulis pertama, verifikasi tidak pernah berubah |
| `server_idem_after_tx` | Diselamatkan ULID PK — **bukan cacat yang berbahaya** | (lihat § 4) |

### Hasil setelah invariant diperkuat

```
mode=none                   iterasi=300   GAGAL=0     lolos=300
mode=regen_idem_on_retry    iterasi=300   GAGAL=300   ← I8
mode=server_idem_after_tx   iterasi=300   GAGAL=0     ← selamat, lihat §4
mode=outbox_in_memory       iterasi=300   GAGAL=300   ← I1 + I5
mode=seq_from_server        iterasi=300   GAGAL=300   ← I6
mode=void_as_update         iterasi=300   GAGAL=300   ← I5 + I7
```

**Delapan invariant final:**

| # | Invariant | Menangkap |
|---|---|---|
| I1 | Konservasi — setiap order perangkat ada di server | Kehilangan data |
| I2 | Tanpa duplikasi — satu nomor struk = satu order server | Duplikasi |
| I3 | Konvergensi — himpunan server = gabungan perangkat | Divergensi |
| I4 | Monotonisitas — nomor struk berurutan rapat per device/tanggal | Penomoran rusak |
| I5 | Konservasi uang — total perangkat = total server | Uang hilang/muncul |
| **I6** | **Kemampuan jual offline** — nol penjualan gagal karena offline | Regresi offline-first |
| **I7** | **Immutabilitas** — record server tidak berubah setelah tulis pertama | Pelanggaran append-only |
| **I8** | **Higienis idempotency** — satu order ≤ 1 idempotency key | Dedup yang bergantung pada PK saja |

---

## 4. `server_idem_after_tx` selamat — dan itu temuan, bukan kelalaian

Mode ini mensimulasikan cacat nyata: server menulis order, lalu **crash sebelum menulis idempotency key** (karena keduanya di transaksi terpisah). Retry berikutnya membawa key yang sama, tetapi server tidak mengenalinya.

Yang menyelamatkan: **ULID di-generate klien dan menjadi primary key**. Saat retry tiba, server menemukan `order_id` sudah ada, mencatat key-nya, dan mengembalikan respons "replayed" — tanpa duplikasi.

**Ini memvalidasi KEP-16 secara empiris.** Dokumen menyatakan idempotency key **dan** client-generated ID dipakai bersama, "bukan salah satu". Prototipe menunjukkan mengapa: masing-masing menutup lubang yang tidak ditutup yang lain.

> ⚠️ **Bukan izin untuk menulis key di transaksi terpisah.** Perlindungan PK mencegah duplikasi *record*, tetapi klien tetap tidak menerima respons asli dan akan retry berulang. Aturan "key dan penjualan dalam satu transaksi" tetap berlaku; yang dibuktikan adalah bahwa pertahanan berlapis bekerja saat aturan itu dilanggar.

---

## 5. Batasan prototipe ini

| Belum dimodelkan | Mengapa penting |
|---|---|
| **Clock skew dan HLC** | FR-H5 belum diuji; pengurutan di bawah jam yang melenceng belum diverifikasi |
| **Jalur turun (replikasi katalog)** | Hanya jalur naik yang dimodelkan |
| **Konflik LWW pada data mutable** | Katalog/harga/pengaturan belum disimulasikan |
| **Kepemilikan order `open`** | Model kepemilikan device (KEP-21) belum diuji |
| **Stok dan deteksi oversell** | Konsekuensi CAP belum disimulasikan |
| **Storage penuh** | Salah satu fault yang disebut ARCH § 11 |
| **Sinkronisasi parsial** | Sebagian tabel berhasil, sebagian gagal |
| **Transaksi database nyata** | Ini simulasi protokol, bukan uji implementasi |

**Yang paling mendesak ditambahkan:** clock skew + HLC, karena FR-H5 adalah satu-satunya mekanisme yang menjaga pengurutan dan belum diverifikasi sama sekali.

---

## 6. Implikasi untuk dokumen

| Dokumen | Perubahan |
|---|---|
| `ARCH-lumi-pos-v1.md` § 11 | Daftar invariant dari 7 → **8**, tambahkan I6, I7, I8 dengan nama yang dipakai harness |
| `spec-h-sinkronisasi.md` § H.5 | Ganti daftar invariant dengan delapan yang sudah tervalidasi; tambahkan catatan bahwa I1–I5 saja tidak cukup |
| `spec-h-sinkronisasi.md` § H.5 | Ambang "10.000 iterasi sebelum rilis F2" — pertahankan; baseline saat ini 2.000 lolos |
| `PRD-lumi-pos-v1.md` § 12 R1 | Mitigasi R1 kini punya bukti awal, bukan hanya rencana |

---

## 7. Cara menjalankan

```bash
python3 sim.py none 2000            # validasi protokol yang benar
python3 sim.py regen_idem_on_retry  # buktikan I8 menangkap
python3 sim.py outbox_in_memory     # buktikan I1+I5 menangkap
python3 sim.py seq_from_server      # buktikan I6 menangkap
python3 sim.py void_as_update       # buktikan I7 menangkap
python3 stress.py                   # jaringan normal → bencana
```

Setiap kegagalan melaporkan **seed** yang mereproduksinya persis — inilah yang membedakan DST dari fuzzing biasa, dan alasan teknik ini layak dipakai untuk lapisan yang membawa uang.

---

*Prototipe 02 · Lumi POS · 27 Juli 2026*
