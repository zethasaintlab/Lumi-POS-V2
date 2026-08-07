# Modul server

Batas modul **ditegakkan**, bukan konvensi. Lihat `product/ARCH-lumi-pos-v1.md` § 3.

## Aturan

1. `index.ts` adalah **satu-satunya** permukaan publik tiap modul.
2. **Tidak ada query ke tabel milik modul lain.** Kepemilikan tabel:

| Modul | Tabel yang dimiliki |
|---|---|
| `tenancy` | `tenant`, `outlet`, `vertical_profile`, `subscription`, `usage_metric` |
| `identity` | `user`, `role`, `user_role`, `device`, `support_session` |
| `catalog` | `category`, `item`, `item_variation`, `modifier_list`, `modifier`, `item_modifier_list`, `price_history` |
| `ordering` | `order`, `check`, `order_line`, `order_line_modifier`, `refund` |
| `payment` | `payment`, `tax_rate` |
| `inventory` | `stock_movement`, `stock_snapshot`, `sold_out_flag`, `stocktake`, `stocktake_line`, `oversell_event` |
| `cash` | `cash_drawer_shift`, `cash_movement` |
| `reporting` | — (baca lewat view yang disediakan modul lain) |
| `sync` | `idempotency_key`, `outbox` |
| `peripheral` | `peripheral`, `printer_profile`, `print_job` |
| `audit` | `audit_event` |

3. Lint rule melarang import dalam-dalam antar modul.
4. Idealnya kepemilikan ditegakkan lewat **skema PostgreSQL terpisah per modul dengan grant terbatas**, sehingga pelanggaran gagal di runtime — bukan menunggu review.

## Modul yang sudah punya kode

| Modul | Isi | Permukaan publik |
|---|---|---|
| `catalog` | Kategori, item/variation, modifier, harga per outlet | 32 operasi REST · `resolvePrice` · `getVariationSnapshot` |
| `ordering` | Penulisan penjualan, void & refund | `POST /orders` · `GET /orders/{id}` · `POST /orders/{id}/cancel` |
| `identity` | Provisioning device (FR-B6) | `POST /devices` · `POST /devices/{id}/revoke` · `assertUserVisible` · `assertApproverVisible` · `assertDeviceVisible` |
| `cash` | Buka shift saja — tutup kas tetap F3 | `POST /shifts` · `assertShiftOpen` |
| `payment` | Tarif pajak dan pembayaran tunai | `POST /tax-rates` · `GET /tax-rates` · `POST /tax-rates/{id}/end` · `POST /orders/{id}/payments` · `fetchEffectiveTaxRates` |
| `tenancy` | Tidak punya endpoint | `assertOutletVisible` · `getOutletSettings` |
| `sync` | Tidak punya endpoint; worker relay `outbox` adalah F2 | `findIdempotencyKey` · `claimIdempotencyKey` · `completeIdempotencyKey` · `insertOutboxEvent` |
| `inventory` | Irisan minimal Modul E — hanya penulisan pergerakan stok | `recordStockMovements` |
| `audit` | Irisan minimal Modul F — hanya penulisan satu event | `recordAuditEvent` |

Belum ada kode: `reporting`, `peripheral`.

`inventory` dan `audit` lahir masing-masing dengan **satu fungsi**, dan itu bukan penundaan yang malas. Keputusan produk 1 Agustus 2026 menetapkan void berjalan **tanpa PIN manajer**, dengan syarat alasan daftar tertutup + audit + restock otomatis — jadi keduanya bukan pelengkap void, melainkan kontrol yang tersisa untuknya. Invariant #1 menuntut keduanya ditulis dalam transaksi yang sama, dan aturan 2 melarang `ordering` menyentuh `stock_movement` maupun `audit_event` langsung.

Perhitungan stok (`SUM(delta)`), stocktake, oversell, sold-out tetap Modul E penuh. RBAC, PIN, sesi, dan seluruh permukaan query/laporan audit tetap Modul F penuh.

## Kenapa modul-modul kecil itu ada

`tenancy`, `identity`, dan `sync` sebagian besar berisi satu-dua fungsi, dan itu disengaja. Aturan 2 melarang sebuah modul meng-query tabel milik modul lain, sementara jalur penjualan menunjuk ke mana-mana: `order.shift_id` → `cash`, `order.device_id` → `identity`, `order.outlet_id` → `tenancy`, `order_line.variation_id` → `catalog`, `idempotency_key` → `sync`.

Alternatifnya adalah `ordering` meng-query enam tabel milik lima modul lain. Fungsi kecil yang diekspor lewat `index.ts` adalah harga yang dibayar untuk menjaga batas itu tetap nyata, bukan sekadar tertulis.

## Guard lintas modul: SELECT, bukan foreign key

**Setiap guard semacam ini WAJIB berupa `SELECT` yang tunduk RLS di dalam transaksi pemanggil.** Foreign key tidak cukup.

FK PostgreSQL dicek dengan privilese owner tabel yang direferensikan dan **tidak tunduk `FORCE ROW LEVEL SECURITY`** — ia hanya membuktikan baris itu ada di *suatu* tenant, bukan tenant yang benar.

Ini bukan teori. Dibuktikan **empat kali** di repo ini lewat sabotase yang disengaja, tiap kali di FK berbeda dan modul berbeda: `item.category_id`, `price_history.outlet_id`, dan terakhir `order.shift_id` — semuanya menghasilkan `201` dengan baris yang **benar-benar tersimpan** menunjuk tenant lain. Rinciannya di `CLAUDE.md` § "Temuan F1".

Anggap setiap FK klien-suplai baru terpapar sampai kamu membuktikan sebaliknya.

### Dan guard yang tidak dapat DIBEDAKAN adalah guard yang tidak teruji

Ditemukan saat membangun refund (7 Agustus 2026). Penyetuju refund divalidasi di dua tempat: guard eksplisit di jalur refund, dan lagi di dalam `recordAuditEvent` beberapa langkah kemudian. Keduanya memakai pesan yang sama, jadi saat guard pertama **dimatikan sepenuhnya**, seluruh suite tetap hijau — yang kedua menjawab dengan status dan kode yang sama persis.

Perbaikannya bukan menghapus salah satunya: `refund.approved_by` ditulis **sebelum** audit berjalan, dan kolom itu tidak punya FK sama sekali. Yang diperbaiki adalah pesannya — `assertApproverVisible` lahir dengan kode `APPROVER_NOT_FOUND`, terpisah dari `ACTOR_NOT_FOUND`. Itu sekaligus memperbaiki cacat yang lebih nyata: manajer yang penyetujuannya ditolak sebelumnya diberi tahu bahwa **kasir**-nya yang tidak ditemukan.

Aturannya: bila dua lapisan menjaga hal yang sama, pastikan keduanya dapat dibedakan dari luar. Kalau tidak, salah satunya bisa hilang tanpa ada yang tahu.
