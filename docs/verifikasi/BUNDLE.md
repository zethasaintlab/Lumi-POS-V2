# Inventaris `/ds-bundle` — apa yang dikirim, apa yang dipakai

Dibuat 1 September 2026 setelah `.stepper` menjadi **kali kelima dalam satu
hari** sebuah komponen bundle ditemukan sudah ada, sudah dirancang lebih baik,
dan tidak pernah dipakai — lalu ditulis ulang lebih miskin atau tidak ditulis
sama sekali.

Kelimanya: `.product-card` · `.chip` · `<Icon>` · `--shadow-card` · `.stepper`.
Yang keenam ditemukan saat menulis dokumen ini: `<CartRow>`.

**Regenerasi:** hitungannya dari pemindaian sumber; lihat § Cara menghitung.

---

## 1. Komponen React

Angka = **berapa berkas sumber** yang merender komponen itu.

| Komponen | kasir | back-office | hp | Catatan |
|---|---:|---:|---:|---|
| `EmptyState` | 12 | 30 | 0 | dipakai luas |
| `Card` | 2 | 29 | 4 | dipakai luas |
| `Icon` | **3** | **30** | **0** | ⛔ timpang: 37 ikon tersedia |
| `Badge` | **1** | 28 | 0 | ⛔ kasir hampir tidak memakainya |
| `Table` | **1** | 27 | 0 | |
| `Modal` | **0** | 3 | 0 | ⛔ kasir menulis 7 dialog sendiri |
| `Button` | 1 | 1 | 1 | lewat pembungkus `Tombol.tsx` per app |
| `Field` | 1 | 1 | 1 | lewat pembungkus `Bidang.tsx` per app |
| `SyncIndicator` | 1 | 0 | 0 | |
| `StatCard` | 0 | 1 | 0 | hanya B-01 |
| `AppShell` | 0 | 1 | 0 | kasir sengaja tidak (`IA:2.1`) |
| `Tabs` | 0 | 1 | 0 | |
| **`Stepper`** | **0** | **0** | **0** | ⛔ tidak pernah dipakai |
| **`Switch`** | **0** | **0** | **0** | ⛔ tidak pernah dipakai |
| **`SegmentedControl`** | **0** | **0** | **0** | ⛔ tidak pernah dipakai |
| **`Chip`** | **0** | **0** | **0** | ⛔ tidak pernah dipakai |
| **`CartRow`** | **0** | **0** | **0** | ⛔ tidak pernah dipakai — lihat §3 |
| **`ProductCard`** | **0** | **0** | **0** | ⛔ tidak pernah dipakai — lihat §3 |
| **`ConfirmDialog`** | **0** | **0** | **0** | ⛔ tidak pernah dipakai |
| **`Avatar`** | **0** | **0** | **0** | tidak pernah dipakai |
| `Ticket` | 0 | 0 | 0 | KDS — non-goal v1, wajar nol |

**Sepuluh dari 21 komponen tidak pernah dirender satu kali pun.**

## 2. Kelas CSS yang ditulis langsung oleh kode aplikasi

Kelas yang dipakai LEWAT komponen tidak dihitung di sini — memakai `<Table>`
berarti kamu tidak menulis `.table`, dan itu benar.

| Kelas | kasir | back-office | hp |
|---|---:|---:|---:|
| `btn` | 7 | 0 | 0 |
| `card-pad` | 0 | 28 | 4 |
| `label` | 1 | 25 | 1 |
| `field` | 1 | 2 | 3 |
| `field-error` | 0 | 3 | 1 |
| `btn-ghost` | 3 | 0 | 0 |
| `chip` | 2 | 0 | 0 | ← baru 1 Sep |
| `product-card` | 2 | 0 | 0 | ← baru 1 Sep |
| `stepper` | 1 | 0 | 0 | ← baru 1 Sep |
| `badge` · `badge-neutral` | 0 | 1 | 0 |
| `sync` · `dot` | 1 | 0 | 0 |
| `shell` · `shell-nav` | 0 | 1 | 0 |

**Nol di ketiga aplikasi:** `avatar` · `cart-row` · `dialog*` · `empty` ·
`field-lg` · `field-invalid` · `overlay` · `segmented` · `stat` ·
`tabs` · `tabs-underline` · `ticket*` · seluruh varian `badge-*` berwarna ·
seluruh `shell-*` bagian dalam.

⛔ **Batas pengukuran yang dinyatakan:** `btn-primary`, `btn-secondary`, dan
`btn-critical` terhitung **nol** padahal DIPAKAI — ketiganya dibangun dinamis
(`` `btn-${varian}` `` di `Tombol.tsx`), dan pemindai hanya melihat token
literal. Angka nol di tabel ini berarti "tidak ditemukan sebagai token
literal", bukan selalu "tidak dipakai". Kelas yang dibangun dari template
literal harus diperiksa manual.

---

## 3. ⛔ Temuan yang membalik kesimpulan mudah

"Pakai saja komponen bundle" **salah sebagai aturan menyeluruh**, dan sebabnya
uang.

| Komponen | Aman untuk jalur uang? |
|---|---|
| `CartRow` | ⛔ **TIDAK** — `unitPrice * qty` dengan `number` |
| `ProductCard` | ⛔ **TIDAK** — `rupiah()` sendiri atas `number` |
| 19 komponen lainnya | ✅ ya — tidak menyentuh angka uang |

Konvensi repo ini: **uang `bigint` rupiah utuh, tidak pernah float**. Kedua
komponen itu dirancang untuk basis kode yang memakai `number` untuk uang, dan
masing-masing membawa salinan pemformat rupiahnya sendiri — `CLAUDE.md` sudah
mencatat bahwa `apps/kasir` punya delapan salinan; ini calon kesembilan dan
kesepuluh.

**Aturan yang benar, dan ia lebih tajam daripada "pakai bundle":**

> Pakai **kelas CSS** bundle dengan bebas. Pakai **komponen React** bundle di
> mana pun ia tidak menyentuh angka uang. Untuk yang menyentuh uang, pakai
> KELASnya (`.cart-row`, `.product-card`) di atas markup kita sendiri yang
> memformat lewat `packages/domain/src/uang-tampilan.ts`.

Itu yang kebetulan sudah dilakukan untuk kartu produk pada 1 September — kelas
`.product-card` diadopsi, komponennya tidak.

⛔ `CartRow` tetap layak dicontek pada satu hal: **qty turun ke 0 memanggil
`onRemove`**. Itu menghapus kebutuhan tombol "Hapus" terpisah, dan sekaligus
menghapus risiko salah tekan yang kamu laporkan (A8) — bukan dengan menjauhkan
tombolnya, melainkan dengan meniadakannya.

---

## 4. Dua belas butir peninjauan vs inventaris

| Butir | Sudah ada di bundle? | Ongkos |
|---|---|---|
| A2 elemen & border | `.card`, `--shadow-card`, `.badge-*` | **turun** |
| A3 pencarian + sort by | `<Field>` + `<SegmentedControl>` | **turun** |
| A4 menu "…" | `<Tabs variant="underline">` | **turun** |
| A5 dialog variasi plain | `<SegmentedControl>` untuk ukuran, `<Chip>` | **turun banyak** |
| A6 pembayaran overlay | `<Modal>` — sudah dipakai 3× di back-office | **turun banyak** |
| A7 scroll keranjang | — | ✅ selesai |
| A8 tombol tambah | `.stepper` | ✅ selesai |
| B1 loading screen | ⛔ **TIDAK ADA** skeleton/spinner di bundle | **tetap** |
| C1 pagination katalog | ⛔ **TIDAK ADA** — `<Table>` tanpa paginasi | **tetap** |
| D1 K-08 detail transaksi | `<Table>` + `<Card>` + `<Badge>` | **turun** |
| D2 sort by riwayat | `<SegmentedControl>` | **turun** |
| D3 pagination riwayat | ⛔ **TIDAK ADA** | **tetap** |
| G1 K-15 rapi | `<Switch>` (nol dipakai), `<Field>`, `<Card>` | **turun banyak** |

**Sembilan dari dua belas ongkosnya turun** — dugaanmu benar untuk dialog
variasi dan untuk sort, dan ternyata berlaku lebih luas.

⛔ **Tiga yang TIDAK punya komponen** dan harus dibangun: paginasi (dua kali)
dan penanda memuat. `<Table>` bundle sama sekali tidak punya paginasi —
diperiksa di sumbernya, bukan diasumsikan dari namanya.

---

## Cara menghitung

- **Komponen**: berkas sumber yang cocok `<NamaKomponen[\s/>]`
- **Kelas**: token di dalam `className="…"` / `class="…"` (dipecah spasi), atau
  selektor `.nama` di berkas `.css`. Pencocokan kata biasa **tidak** dihitung —
  versi pertama pemindai ini menghitung kata kunci JS `switch`, kata `table` di
  dalam prosa, dan `.kasir-dialog` sebagai `dialog`. Angka yang digelembungkan
  lebih buruk daripada tidak ada angka.
- **Keamanan uang**: berkas komponen yang memuat `toLocaleString('id-ID')` atau
  literal `'Rp '`.
