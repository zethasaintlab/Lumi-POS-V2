# Penyelidikan Inventori — B-12 (Stok) & B-13 (Penyesuaian)

**16 Agustus 2026** · branch `g1-penyelidikan-b12-b13-inventori` · tidak ada kode yang diubah.

---

## Ringkasan eksekutif

| Pertanyaan | Jawaban |
|---|---|
| Desainnya append-only? | ✅ **Ya, dan bersih.** Tidak ada kolom `quantity` di mana pun |
| Ada `UPDATE` pada catatan stok? | ✅ **Tidak ada satu pun** |
| Stok dihitung bagaimana? | `SUM(delta)` — pola snapshot ADA di skema tapi **kosong di server** |
| Penjualan memicu movement? | ✅ Ya, di transaksi yang sama |
| `GET /inventory/stocks` | ❌ **tidak ada** |
| `POST /inventory/movements` | ❌ **tidak ada** |

⛔ **Temuan terbesar, dan tidak terlihat dari skema:** dari delapan tipe movement, server hanya pernah menulis **tiga** — `sale`, `void`, `refund`. Kelimanya yang lain tidak punya satu pun penulis di seluruh repo.

Artinya **stok hanya dapat TURUN.** Tidak ada jalan memasukkan barang ke rak. Setiap variation yang dilacak mulai dari nol dan langsung negatif pada penjualan pertama.

Tidak ada cacat arsitektur yang perlu dilaporkan. Yang ada adalah **separuh sistem yang belum dibangun**, dan separuh itu persis B-12 dan B-13.

---

## 1. Desainnya benar — event-sourced, append-only

`db/migrations/0010_inventory.sql` menuliskannya eksplisit:

```sql
-- Tidak ada tabel `stock`/kolom quantity_on_hand — stok = SUM(delta) per
-- (outlet_id, variation_id) (ERD §8).
CREATE TABLE stock_movement (
  id            text NOT NULL,
  ...
  type          text NOT NULL CHECK (type IN ('sale','void','refund','receipt',
                  'adjustment','stocktake','transfer_in','transfer_out')),
  delta         bigint NOT NULL,  -- x1000, bertanda
  ...
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
```

Diperiksa dan tidak ditemukan:

- Tidak ada kolom `quantity_on_hand`, `stock`, maupun sejenisnya di tabel mana pun (FR-E1 ✅).
- **Tidak ada satu pun `UPDATE stock_movement`** di seluruh `apps/` maupun `packages/`.
- Kuantitas `bigint` ×1000 bertanda — bukan float, dan bukan dua kolom masuk/keluar.

Ini bukan tabel `stock` yang di-`UPDATE`. Kekhawatiran di instruksimu tidak terbukti — dan memang tidak seharusnya, karena `CLAUDE.md` sudah menegakkannya sebagai konvensi data.

### 1.1 Snapshot ada di skema, tapi kosong di server

`stock_snapshot` (`tenant_id, outlet_id, variation_id, balance, checkpoint_hlc`) ada di migrasi `0010`, lengkap dengan index `ix_mv_hlc` yang komentarnya menyebut *"wajib untuk pola snapshot delta (ERD §16) — tanpanya snapshot tidak berguna (117,7 ms → 111,6 ms saja)"*.

**Diukur: 0 baris.** Tidak ada satu pun kode server yang membaca maupun menulisnya.

Yang benar-benar memakai pola snapshot adalah **aplikasi kasir** (`apps/kasir/src/inventori/stok.ts`), tempat ia dibangun ulang saat tutup shift. Di server, tabelnya berdiri kosong menunggu pemakainya.

Itu bukan cacat — server belum punya satu pun pembaca stok, jadi belum ada yang butuh dipercepat. Ia menjadi relevan tepat saat B-12 dibangun.

---

## 2. Penjualan memang memicu movement — dan waktunya penting

`orders.ts:552` menulis movement `sale` **di transaksi yang sama** dengan penjualannya (FR-E3 ✅, `spec-e:112`: *"kegagalan menulis movement me-rollback seluruh penjualan"*).

Dua aturan yang sudah benar dan tidak boleh dirusak B-12/B-13:

- Hanya variation ber-`track_stock = true` yang menghasilkan movement, dan nilainya dibaca dari snapshot katalog — bukan `SELECT` langsung ke `item_variation` (invariant #4).
- **Modifier tidak menghasilkan movement** (KEP-04) — ia tidak punya SKU.

### 2.1 ⛔ Stok berkurang saat order DIBUAT, bukan saat DIBAYAR

Diukur lewat API sungguhan, bukan dibaca:

| Langkah | `SUM(delta)` | Catatan |
|---|---:|---|
| saldo awal | `0` | |
| order dibuat (`status = open`) | **`-3000`** | belum dibayar sama sekali |
| order dibayar | `-3000` | pembayaran **tidak** mengurangi lagi — benar |
| order kedua dibuat, tidak dibayar, tidak di-void | `-5000` | |
| order ketiga dibuat | `-6000` | |
| order ketiga di-void | `-5000` | dikembalikan **persis** (FR-E2 AC keempat ✅) |

Per tipe: `sale` ×3 = `-6000`, `void` ×1 = `+1000`.

Pengurangan pada saat pembuatan adalah bacaan yang benar atas `spec-e:101` (*"saat penjualan tersimpan"*) — barang memang sudah keluar dari rak saat pesanan dibuat, sebelum uangnya diterima.

**Tapi ada konsekuensi yang belum punya jalan keluar:** order yang dibuat lalu **ditinggalkan** — tidak dibayar, tidak di-void — memegang stok itu **selamanya**. Terlihat di baris keempat tabel: `-2000` yang tidak akan pernah kembali.

Ini menyambung ke dua hal yang sudah tercatat:

- `CLAUDE.md`: keranjang K-03 hanya ada di memori, dan *"order `open` yang tidak pernah dibayar akan muncul di laporan dan harus punya jalan penutupan"*.
- Keputusanmu di B-02: keranjang `open` **disembunyikan** dari daftar transaksi. Jadi stok dapat berkurang karena order yang **tidak dapat dilihat siapa pun** di back-office.

Status `abandoned` ada di CHECK constraint dan di state machine, tapi **tidak punya satu pun penulis** — sama seperti lima tipe movement di §3. Jalan keluarnya belum ada.

---

## 3. ⛔ Lima dari delapan tipe movement tidak punya penulis

`FR-E2` mendefinisikan enam tipe (plus dua transfer di skema). Yang benar-benar ditulis kode:

| Tipe | Delta | Penulis | Status |
|---|---|---|---|
| `sale` | negatif | `orders.ts:552` | ✅ ada |
| `void` | positif | `cancel.ts:727` | ✅ ada |
| `refund` | positif | `cancel.ts:519` | ✅ ada |
| `receipt` | positif | — | ❌ **tidak ada** |
| `adjustment` | bertanda | — | ❌ **tidak ada** |
| `stocktake` | bertanda | — | ❌ **tidak ada** |
| `transfer_in` / `transfer_out` | — | — | ❌ (ditunda ke v1.1 per PRD) |

Dicari di seluruh `apps/` dan `packages/`. Kemunculan kata `'receipt'` di `navigasi.ts`, `Detail.tsx`, dan `Riwayat.tsx` adalah **nama ikon**, bukan tipe movement; kemunculan di `inventory/index.ts` adalah deklarasi union tipenya. `'adjustment'` di `packages/domain/src/buku-kas.ts` adalah tipe **cash movement** — domain lain.

Aplikasi kasir menulis `sale`, `void`, dan `refund` secara lokal. Tidak lebih.

**Akibatnya, sistem stok hari ini hanya dapat mengurangi.** Merchant tidak punya cara memberi tahu sistem bahwa ia menerima 10 kg kopi. Setiap variation ber-`track_stock` mulai dari nol dan negatif sejak penjualan pertama — dan oversell terdeteksi (FR-E6 berjalan) untuk keadaan yang sebenarnya normal.

---

## 4. Permukaan REST: nol

**Tidak ada satu pun rute inventori di `openapi.yaml`.** Bukan `GET /inventory/stocks`, bukan `POST /inventory/movements`, bukan apa pun.

Modul `inventory` di server berisi **satu berkas**, `index.ts`, dengan dua fungsi yang keduanya bukan endpoint:

| Fungsi | Dipakai oleh |
|---|---|
| `recordStockMovements` | `ordering` (sale, void, refund) |
| `detectOversell` | `ordering` (FR-E6) |

Ia lahir sebagai irisan minimal untuk melayani void/refund (`modules/README.md`), dan tidak pernah tumbuh.

⛔ **Server tidak punya satu pun pembaca stok.** Satu-satunya `SUM(delta)` di kode server ada di `cancel.ts:317`, dan itu menghitung batas refund — bukan saldo stok.

---

## 5. Pekerjaan yang harus dibuat

### 5.1 Backend (prasyarat kedua layar)

| # | Pekerjaan | FR | Catatan |
|---|---|---|---|
| **1** | `GET /inventory/stocks?outlet_id&...` — saldo per variation | FR-E1 | Rumah modulnya perlu diputuskan: `inventory` atau `reporting` (butuh nama produk dari `catalog`) |
| **2** | `POST /inventory/movements` — `receipt` dan `adjustment` | FR-E2 | ⛔ `adjustment` **wajib** `reason_code` — ini AC eksplisit, bukan preferensi |
| **3** | Otorisasi manajer untuk keduanya | FR-E2 | `stock_adjust` sudah ada di matriks `spec-f`, diberikan ke owner/area_manager/outlet_manager |

### 5.2 Pertanyaan yang harus kamu jawab sebelum kode ditulis

| # | Pertanyaan | Kenapa aku tidak memutuskannya sendiri |
|---|---|---|
| **A** | **Rumah `GET /inventory/stocks`** — modul `inventory` (butuh nama produk, tapi `catalog` milik modul lain) atau modul `reporting` (sudah punya izin baca lintas domain)? | Ini keputusan arsitektur yang sama bentuknya dengan B-03, dan jawabannya menentukan apakah `inventory` ikut menjadi agregator |
| **B** | **Snapshot dipakai atau `SUM(delta)` langsung?** | Skemanya sudah ada dan kosong. `SUM(delta)` lebih sederhana dan pasti benar; snapshot lebih cepat tapi menambah keadaan yang dapat basi. Aku menyarankan `SUM(delta)` dulu — belum ada angka yang menunjukkan ia lambat, dan kita baru saja sepakat tidak melakukan optimasi prematur |
| **C** | **Order `open` yang ditinggalkan** — apakah B-13 menjadi jalan keluarnya (koreksi manual), atau butuh mekanisme penutupan order sendiri? | Ia utang yang sudah tercatat dua kali, dan sekarang terbukti menahan stok. Menjawabnya lewat `adjustment` berarti merchant memperbaiki angka tanpa sistem tahu sebabnya |
| **D** | **B-14 (Opname) dan B-15 (Perlu diperiksa)** ikut sekarang atau menyusul? | `stocktake` dan `stocktake_line` sudah ada di skema; `oversell_event` sudah terisi oleh `detectOversell`. B-15 mungkin lebih murah daripada terlihat |

### 5.3 Yang TIDAK perlu dibangun

- Migrasi skema — seluruh tabel yang B-12/B-13 butuhkan sudah ada sejak `0010`.
- Perubahan pada jalur penjualan — `sale`/`void`/`refund` sudah benar dan sudah teruji.
- Kolom `quantity` di mana pun. Selamanya.

---

## 6. Yang tidak saya sentuh

- Tidak ada UI, endpoint, migrasi, maupun perubahan kode apa pun.
- Alat ukur sementara dihapus setelah angkanya masuk dokumen ini.
- `product/`, `research/`, dan `docs/superpowers/specs/` tidak disentuh.
