# Penyelidikan — paginasi & pencarian katalog sisi server

Tanggal 21 Agustus 2026. Ditulis sebelum satu baris kode pun.

Utang G1: *"Paginasi + pencarian sisi server untuk Katalog (B-06/B-08/B-09/B-10).
Keempat layarnya ada dan berjalan. Penyelidikan #37 menemukan bahwa keduanya
belum ada di backend katalog, dan keputusan user adalah **tidak melakukan
optimasi prematur**. Ia akan menggigit pada katalog besar, bukan sekarang."*

---

## 1. Apa yang sebenarnya terjadi hari ini

`GET /items` mengembalikan **seluruh** item tenant dalam satu respons, dan
untuk setiap item ia menjalankan satu query varian:

```ts
for (const row of rows) {
  result.push(toItem(row, await fetchVariations(client, row.id), …));
}
```

Komentar `FIX 5` di berkas itu sudah menyebut modifier list sebagai N+1 yang
sudah diperbaiki — dan pada baris berikutnya meninggalkan N+1 kedua yang belum,
dengan catatan "pre-existing, out of scope to fix here per brief".

Jadi katalog 5.000 produk (kuota tier `standard`) menghasilkan **5.001 query**
dalam satu transaksi, dan respons yang memuat seluruh katalog beserta seluruh
variannya.

## 2. ⛔ Yang menentukan bentuk paginasi di sini BUKAN yang sama dengan riwayat

`CLAUDE.md` menuliskan aturan keras untuk riwayat transaksi:

> **Paginasi riwayat wajib keyset, bukan offset.** Perangkat offline
> menyisipkan baris ber-`business_date` historis di tengah urutan; offset akan
> melewatkan atau menggandakan baris tepat saat antrean terkuras.

Alasannya adalah **penyisipan di tengah urutan**. Katalog tidak punya sifat
itu: urutannya `(sort_order, id)`, dan tidak ada perangkat yang menyisipkan
item di tengah katalog secara diam-diam — item baru ditulis dari back-office,
satu per satu, oleh orang yang sedang menatap layarnya.

Meski begitu **keyset tetap dipilih**, dan alasannya berbeda: `OFFSET n`
menyuruh PostgreSQL memindai lalu membuang `n` baris. Pada halaman ke-50 dari
katalog 5.000 produk itu berarti membaca 5.000 baris untuk mengembalikan 100.
Keyset membaca 100.

Konsekuensi yang harus dinyatakan: **keyset tidak dapat melompat ke halaman
17.** Untuk katalog itu bukan kehilangan — B-06 adalah daftar yang di-scroll
dan dicari, bukan buku bernomor halaman.

## 3. ⛔ Pencarian: `ILIKE`, dan kenapa BUKAN full-text

`to_tsvector` menang telak pada teks panjang berbahasa Inggris. Nama produk
kafe adalah dua sampai empat kata Indonesia, dan yang merchant ketik adalah
**potongan kata** — "kop" untuk "Kopi Susu". Full-text search tidak mencocokkan
awalan tanpa konfigurasi tambahan; `ILIKE '%kop%'` mencocokkannya apa adanya.

Biayanya: `ILIKE '%…%'` tidak dapat memakai index B-tree biasa. Untuk 5.000
baris per tenant itu sequential scan atas beberapa ratus kilobyte — di bawah
ambang yang terukur. `pg_trgm` adalah jawaban bila kelak tidak cukup, dan ia
**tidak** dipasang sekarang: extension baru adalah keputusan operasional, dan
angka yang membenarkannya belum ada.

⛔ **`[ASUMSI]`**: bahwa sequential scan atas katalog satu tenant cukup cepat.
Belum diukur. Yang membuatnya aman untuk sekarang adalah batas kuota: tier
tertinggi yang punya angka adalah `pro` dengan 20.000 produk.

## 4. ⛔ N+1 varian harus ikut, bukan dikerjakan belakangan

Paginasi tanpa memperbaiki N+1 memindahkan masalahnya, tidak menghapusnya:
halaman 100 item tetap menjalankan 101 query. Dan setelah paginasi mendarat,
N+1-nya menjadi **lebih sulit terlihat** — 101 query terasa wajar, 5.001 tidak.

Pola perbaikannya sudah ada di berkas yang sama:
`fetchModifierListsForItems(client, ids)` mengambil seluruhnya dalam jumlah
query TETAP. Varian mendapat perlakuan yang sama.

## 5. Kompatibilitas klien N-1

`ARCH` menuntutnya, dan di sini ia murah: parameter `q`, `limit`, dan `after`
semuanya **opsional**. Klien lama yang tidak mengirimnya mendapat perilaku
lama — kecuali satu hal yang berubah untuk semua orang: **respons memperoleh
field baru**. Field tambahan tidak merusak klien mana pun.

⛔ Yang TIDAK boleh: menjadikan `limit` punya nilai bawaan yang memotong
respons. Klien lama yang mengirim tanpa `limit` lalu menerima 100 dari 5.000
produk akan menampilkan katalog yang terpotong **tanpa satu pun error** — dan
kasir yang tidak menemukan produknya akan menyalahkan katalognya, bukan
aplikasinya.

Karena itu: **tanpa `limit`, seluruh baris dikembalikan** seperti sebelumnya.
Paginasi adalah sesuatu yang klien MINTA, bukan yang server paksakan.

## 6. Urutan

1. `GET /items`: `q`, `limit`, `after` + `nextCursor` di respons
2. N+1 varian dibatch dalam query tetap
3. `GET /categories` dan `GET /modifier-lists`: `q` saja — keduanya jauh lebih
   kecil dan tidak punya kuota
4. B-06 memakai `q` sisi server; sisanya menyusul bila terukur perlu
