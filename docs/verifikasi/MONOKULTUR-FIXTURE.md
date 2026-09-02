# Audit monokultur fixture — gerbang K-06/K-07

Dijalankan 2 September 2026. Pertanyaannya satu: **dimensi mana yang punya
beberapa nilai sah, tetapi fixture-nya hanya pernah memakai satu?**

Kelasnya sama dengan sembilan test sync-rules yang hijau tanpa pernah memeriksa
apakah kolomnya ada: suite besar yang hijau karena tidak pernah menanyakan
pertanyaan yang salah.

---

## ⛔ Koreksi terhadap kalimat yang memicu audit ini

`apps/kasir/src/layar/TutupKas.tsx` menulis:

> Tidak satu pun dari seluruh test kasir merah karenanya: **semuanya memakai
> `cash`**, dan `cash` adalah satu-satunya kunci yang keempat salinan sepakati.

**Terukur: itu terlalu luas.** Yang benar: peta nama metode yang menyimpang
hanya pernah DIPANGGIL dengan `cash` di test — bukan bahwa seluruh test kasir
memakai `cash`. Empat berkas kasir memang memproduksi metode non-tunai.

Perbedaannya penting, karena versi luasnya menyarankan lubang yang jauh lebih
besar daripada yang ada, dan lubang yang dibesar-besarkan akan diabaikan.

---

## 1. Metode pembayaran — dimensi yang menjadi gerbang

| Nilai | Kemunculan di `tests/kasir` | Berkas |
|---|---:|---:|
| `cash` | 37 | banyak |
| `qris_static` | 18 | 4 |
| `qris_dynamic` | 9 | 4 |
| `card_edc` | 4 | 4 |
| `other` | 0 | 0 |

**4 dari 47 berkas test kasir** pernah menyentuh metode non-tunai:
`penjualan` · `tutup-kas` · `tutup-kas-refund` · `laporan-harian`.

⛔ **Keempatnya adalah jalur yang paling penting** — penulisan penjualan,
penutupan kas, dan laporan harian. Jadi monokulturnya BUKAN "tidak pernah
diuji"; ia "diuji di jalur data, tidak diuji di jalur TAMPILAN".

Itu persis bentuk cacat yang galeri temukan: peta nama metode keempat yang
memuat `card` (kode yang tidak ada di skema mana pun) dan **tidak** memuat
`qris_static` maupun `card_edc`. Datanya benar sepanjang jalan; yang salah
adalah kata yang kasir baca di layar tutup kas.

**`other` nol, dan itu keputusan yang belum pernah dinyatakan.** Ia ada di
CHECK constraint `payment.method` dan tidak ada satu pun jalan di UI untuk
memilihnya.

---

## 2. Dimensi lain — nilai yang tidak pernah muncul di fixture

Hanya nilai enum **distingtif** yang diukur; nilai yang juga kata biasa
(`cash`, `sale`, `refund`, `void`, `open`, `paid`, `owner`, `item`) tidak dapat
dihitung murah dan **sengaja tidak dilaporkan berangka** — aturan yang sama
dengan "52 layar" dan "414 AC".

| Dimensi | Nilai | Kemunculan | Berkas |
|---|---|---:|---:|
| `tax_rate.type` | `pbjt` | 12 | 9 |
| | **`ppn`** | **0** | **0** |
| | **`service_charge`** | **0** | **0** |
| `order.channel` | `takeaway` | 71 | 48 |
| | **`dine_in`** | **4** | **3** |
| `cash_movement.type` | `paid_in` / `paid_out` | 6 / 6 | 5 / 5 |
| | `bank_deposit` | 5 | 3 |
| | `opening_float` | 7 | 6 |
| `order.status` | `voided` | 41 | 17 |
| | `abandoned` | 16 | 8 |
| | `refunded` | 12 | 4 |
| peran | `outlet_manager` | 33 | 16 |
| | `accountant` | 26 | 12 |
| | `area_manager` | 17 | 7 |
| `stock_movement.type` | `stocktake` | 6 | 5 |
| | `transfer_in` / `transfer_out` | 2 / 1 | 2 / 1 |
| `vertical_profile` | `fnb` | 7 | 6 |
| | `retail` | 2 | 1 |

### ⛔ Temuan terbesar, dan ia bukan metode pembayaran

**`ppn` tidak pernah muncul di satu pun fixture. Nol.**

`tax_rate.type` punya empat nilai (`pbjt`, `ppn`, `service_charge`, `none`) dan
hanya `pbjt` yang pernah diuji. PPN adalah **pajak nasional 11%** — jenis pajak
yang paling mungkin dipakai merchant di luar daerah yang memungut PBJT, dan
seluruh `TaxCalculator` berdiri di atas satu jenis saja.

⛔ Ini bukan gerbang K-06/K-07, tapi ia lebih dalam di jalur uang daripada
yang gerbangnya jaga. `service_charge` sebagai `tax_rate.type` juga nol —
sejalan dengan `service_charge_amount` yang masih selalu ditulis `0`.

### Yang nol dengan alasan yang sah

- `retail` (1 berkas) — UI retail adalah non-goal v1, dan endpointnya menolak
  `VERTICAL_NOT_AVAILABLE`. Cakupan segitu memang cukup.
- `transfer_in`/`transfer_out` — transfer stok antar outlet ada di daftar
  "jangan bangun".

### Yang timpang dan belum punya alasan tertulis

- **`dine_in`: 3 berkas lawan 48.** Kanal memutuskan tarif pajak di sebagian
  yurisdiksi (`spec-c`), dan F&B dine-in adalah keadaan normal, bukan tepian.

---

## 3. Putusan gerbang

**Gerbang K-06/K-07 LEWAT**, dengan dua lubang yang dinyatakan:

1. Metode non-tunai teruji di jalur DATA, tidak di jalur TAMPILAN. K-06/K-07
   adalah layar tampilan — jadi setiap perubahan di sana wajib membawa fixture
   ber-`qris_static` dan ber-`card_edc`, bukan `cash` saja.
2. `other` tidak pernah diuji dan tidak dapat dipilih di UI mana pun.

**Dua temuan DI LUAR gerbang, dilaporkan bukan diperbaiki:** `ppn` nol dan
`dine_in` hampir nol. Keduanya di jalur pajak, dan keduanya lebih dalam
daripada lubang yang gerbang ini jaga.

---

## Cara menghitung

Kemunculan literal `'nilai'` di `tests/**/*.js`, dibatasi pada nilai enum yang
**tidak ambigu sebagai kata biasa**. Hitungan per-field (`method: 'x'`) dicoba
lebih dulu dan dibuang: sebagian besar fixture memakai `INSERT … VALUES` dengan
bind posisional, jadi pemindai per-field hanya melihat sebagian kecil dan
melaporkan angka yang terlalu kecil — versi pertama audit ini melaporkan
`qris_static` **nol** karena itu.
