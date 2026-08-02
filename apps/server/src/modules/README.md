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

### Modul yang sudah punya kode

| Modul | Isi |
|---|---|
| `catalog` | Lengkap untuk sub-project 1–2: kategori, item/variation, modifier, harga (`price_history`) |
| `tenancy` | Hanya `assertOutletVisible` |
| `identity` | Hanya `assertUserVisible` |

`tenancy` dan `identity` lahir kecil dan disengaja demikian. `price_history.outlet_id` menunjuk `outlet` dan `changed_by` menunjuk `"user"` — keduanya milik modul lain, jadi aturan 2 melarang `catalog` meng-query mereka langsung. Guard itu diekspor lewat `index.ts` masing-masing, bukan diimpor dalam-dalam.

**Setiap guard semacam ini WAJIB berupa `SELECT` yang tunduk RLS di dalam transaksi pemanggil,** bukan mengandalkan foreign key. FK PostgreSQL dicek dengan privilese owner tabel yang direferensikan dan **tidak tunduk `FORCE ROW LEVEL SECURITY`** — ia hanya membuktikan baris itu ada di *suatu* tenant. Lihat `CLAUDE.md` § "Temuan F1", termasuk bukti sabotasenya.
4. Idealnya kepemilikan ditegakkan lewat **skema PostgreSQL terpisah per modul dengan grant terbatas**, sehingga pelanggaran gagal di runtime — bukan menunggu review.
