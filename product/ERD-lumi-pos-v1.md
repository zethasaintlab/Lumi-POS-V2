# ERD & Skema Data — Lumi POS v1

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 9 · **Spec modul:** `/product/specs/`

---

## 1. Aturan lintas-skema yang mengikat

Aturan ini berlaku untuk **setiap** tabel. Pelanggarannya adalah cacat, bukan preferensi.

| # | Aturan | Alasan |
|---|---|---|
| 1 | **Uang** = `bigint`, rupiah utuh. Tidak pernah `float`/`numeric` untuk uang | Design system menetapkan tanpa desimal; float mengakumulasi kesalahan pembulatan |
| 2 | **ID** = `ULID` (26 char) atau `UUIDv7`, **di-generate klien** | Auto-increment mustahil untuk penulisan offline; ULID terurut waktu menjaga lokalitas index |
| 3 | Setiap tabel punya **`tenant_id`** dengan kebijakan RLS untuk `SELECT`/`INSERT`/`UPDATE`/`DELETE` | Kebijakan yang hanya menutupi SELECT membiarkan penulisan lintas tenant |
| 4 | Tabel transaksional punya **`outlet_id`, `device_id`, `occurred_at`, `recorded_at`, `hlc`, `created_by`** | Sengketa selalu tentang "di mana, mesin mana, kapan, siapa" |
| 5 | **Enum sebagai text + CHECK constraint**, bukan integer | Integer enum membuat data mentah tidak terbaca saat debugging insiden |
| 6 | Transaksi selesai **tidak pernah `UPDATE`** | Koreksi = record baru (KEP-17) |
| 7 | Katalog **tidak pernah `DELETE`** — hanya `archived_at` | Menghapus produk merusak referensi pelaporan |
| 8 | **Tidak ada `ON DELETE CASCADE`** dari transaksi ke katalog | — |
| 9 | **Tidak ada kolom** untuk PAN, CVV, PIN kartu, atau data track | PCI DSS scope (KEP-29) |
| 10 | Tabel bervolume tinggi di-partisi by range bulanan sejak awal | `order_line`, `stock_movement`, `audit_event`, `payment` |

---

## 2. Diagram relasi

```
                          ┌──────────┐
                          │  Tenant  │
                          └────┬─────┘
                               │
   ┌───────────┬───────────┬───┴────┬────────────┬──────────────┐
   ▼           ▼           ▼        ▼            ▼              ▼
┌───────┐ ┌────────┐ ┌─────────┐ ┌──────┐ ┌───────────┐ ┌──────────────┐
│Outlet │ │  User  │ │ TaxRate │ │ Role │ │ Category  │ │ Subscription │
└───┬───┘ └───┬────┘ └────┬────┘ └──┬───┘ └─────┬─────┘ └──────────────┘
    │         │           │         │           │
    │         └──────┬────┘         │           ▼
    │                │              │     ┌──────────┐
    │           ┌────▼─────┐        │     │   Item   │
    │           │ UserRole │◄───────┘     └────┬─────┘
    │           └──────────┘                   │
    │                                    ┌─────┴──────────┐
    │                                    ▼                ▼
    │                          ┌──────────────────┐ ┌──────────────────┐
    │                          │  ItemVariation   │ │ ItemModifierList │
    │                          └────────┬─────────┘ └────────┬─────────┘
    │                                   │                    ▼
    │                                   ▼             ┌──────────────┐
    │                          ┌────────────────┐     │ ModifierList │
    │                          │  PriceHistory  │     └──────┬───────┘
    │                          └────────────────┘            ▼
    │                                                  ┌──────────┐
    │                                                  │ Modifier │
    │                                                  └──────────┘
    │
    ├──────────────┬──────────────┬───────────────┬──────────────┐
    ▼              ▼              ▼               ▼              ▼
┌────────┐  ┌──────────────┐ ┌──────────┐ ┌─────────────┐ ┌────────────┐
│ Device │  │VerticalProfile│ │  Order   │ │StockMovement│ │  Stocktake │
└───┬────┘  └──────────────┘ └────┬─────┘ └─────────────┘ └────────────┘
    │                             │
    ▼                    ┌────────┼────────┬──────────┐
┌───────────┐            ▼        ▼        ▼          ▼
│ Peripheral│      ┌─────────┐┌────────┐┌────────┐┌───────────┐
└─────┬─────┘      │  Check  ││Payment ││ Refund ││AuditEvent │
      ▼            └────┬────┘└────────┘└────────┘└───────────┘
┌──────────────┐        ▼
│PrinterProfile│  ┌───────────┐
└──────────────┘  │ OrderLine │
                  └─────┬─────┘
                        ▼
              ┌───────────────────┐
              │ OrderLineModifier │
              └───────────────────┘

┌──────────────────┐
│ CashDrawerShift  │──< CashMovement
└──────────────────┘

Server-only:  IdempotencyKey · Outbox · OversellEvent · UsageMetric
              SupportSession · SchemaMigration
Lokal-only:   OutboxLocal · DeviceConfig · SyncCheckpoint
```

---

## 3. Tenancy & identitas

### `tenant`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `name` | text | |
| `plan` | text | `free`·`standard`·`pro`·`enterprise` |
| `status` | text | `active`·`suspended`·`cancelled` |
| `deployment_mode` | text | `cloud`·`self_hosted` |
| `max_outlets`, `max_devices`, `max_users`, `max_products` | int | Kuota |
| `features` | jsonb | Feature gating komersial |
| `created_at`, `suspended_at` | timestamptz | |

### `outlet`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `tenant_id` | ulid FK | |
| `name`, `address` | text | |
| `timezone` | text | `Asia/Jakarta`·`Asia/Makassar`·`Asia/Jayapura` |
| `business_day_ends_at` | time | Default `04:00` — **tanggal bisnis, bukan tengah malam** |
| `rounding_increment` | int | Default `100` |
| `rounding_mode` | text | `half_up`·`up`·`down` |
| `service_charge_rate` | numeric(6,4) | Default `0` |
| `vertical_profile_id` | ulid FK | |
| `archived_at` | timestamptz | |

### `user`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `tenant_id` | ulid FK | |
| `name` | text | |
| `email` | text nullable | **Nullable** — kasir tidak wajib punya email. Wajib untuk peran yang mengakses back-office |
| `password_hash` | text nullable | Argon2id. **Hanya untuk back-office & owner mobile**; kasir tidak memilikinya |
| `pin_hash` | text nullable | Argon2id + salt. **6 digit.** Hanya untuk permukaan kasir |
| `pin_failed_attempts` | int | |
| `pin_locked_until` | timestamptz nullable | Persisten, bertahan restart |
| `pin_rotated_at` | timestamptz nullable | Untuk rotasi PIN manajer (default 90 hari) |
| `mfa_secret` | text nullable | TOTP; opsional v1, wajib Owner v1.1 |

**Pembagian kredensial per permukaan** — dua mekanisme, dipilih berdasarkan permukaan bukan berdasarkan pengguna:

| Permukaan | Kredensial | Kolom yang dipakai |
|---|---|---|
| Aplikasi kasir + otorisasi step-up | **PIN 6 digit** | `pin_hash` |
| Back-office, owner mobile | **Email + password** | `email`, `password_hash`, `mfa_secret` |

Satu pengguna dapat memiliki keduanya (mis. manajer outlet yang juga membuka laporan dari laptop). Kasir umumnya hanya memiliki `pin_hash`.
| `is_active` | bool | |
| `deactivated_at` | timestamptz | |

**Constraint:** `UNIQUE(outlet_id, pin_hash)` lewat tabel jembatan — PIN unik per outlet, bukan per tenant.

### `role`, `user_role`
`role`: `owner`·`area_manager`·`outlet_manager`·`cashier`·`accountant`.
`user_role`: `user_id`, `role`, `scope_type` (`tenant`·`outlet`), `scope_id`.

### `vertical_profile`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `tenant_id` | ulid FK | |
| `name` | text | `fnb`·`retail` |
| `modules_enabled` | jsonb | `["table","kds","recipe",...]` |
| `default_channel` | text | `dine_in`·`takeaway` |
| `allow_negative_stock` | bool | Default `true` untuk F&B |
| `requires_barcode_flow` | bool | Default `false` untuk F&B |
| `default_tax_type` | text | `pbjt`·`ppn` |

---

## 4. Katalog

### `category`
`id` · `tenant_id` · `name` · `parent_id` (nullable, **maks 1 tingkat**) · `sort_order` · `color_hint` · `archived_at`

**Constraint:** kategori yang punya `parent_id` tidak boleh menjadi parent — ditegakkan trigger atau CHECK pada level aplikasi + test.

### `item`
`id` · `tenant_id` · `name` · `category_id` · `description` · `image_url` · `sort_order` · `archived_at`
**Tanpa `price`, tanpa `sku`.**

### `item_variation`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `item_id` | ulid FK | |
| `name` | text | Default `"Regular"` |
| `sku`, `barcode` | text nullable | `UNIQUE(tenant_id, barcode)` |
| `price` | bigint | Harga default tenant |
| `cost` | bigint | HPP saat ini |
| `stocking_unit`, `selling_unit` | text | Default `pcs` |
| `conversion_factor` | numeric | Default `1` |
| `track_stock` | bool | Default `true` |
| `sort_order` | int | Maks 250 per item |
| `archived_at` | timestamptz | |

### `modifier_list`
`id` · `tenant_id` · `name` · `selection_type` (`single`·`multi`) · `min_selections` · `max_selections` · `allow_duplicate` · `is_required` · `archived_at`

### `modifier`
`id` · `modifier_list_id` · `name` · `price` (bigint) · `is_default` · `sort_order` · `archived_at`
**Tanpa `sku`, tanpa `track_stock`.**

### `item_modifier_list`
`item_id` · `modifier_list_id` · `sort_order` — relasi N:M.

### `price_history`
`id` · `tenant_id` · `variation_id` · `outlet_id` (nullable = default tenant) · `price` · `effective_from` · `changed_by` · `reason`

**Resolusi harga:** `(variation, outlet)` terbaru ≤ waktu transaksi → `(variation, NULL)` → `item_variation.price`.

---

## 5. Pajak

### `tax_rate`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `tenant_id`, `outlet_id` | ulid | `outlet_id` nullable = seluruh tenant |
| `name` | text | **Dicetak di struk** — `"PBJT 10%"` |
| `type` | text | `pbjt`·`ppn`·`service_charge`·`none` |
| `rate` | numeric(6,4) | |
| `is_inclusive` | bool | |
| `phase` | text | `subtotal`·`total` |
| `jurisdiction` | text nullable | Kode daerah |
| `channel` | text | `all`·`dine_in`·`takeaway` — **default `all`** |
| `applies_to` | text | `all_items`·`category`·`item` |
| `applies_to_ids` | ulid[] | |
| `effective_from`, `effective_to` | timestamptz | Perubahan tarif = record baru |

**Resolusi:** `item` > `category` > `all_items`; channel spesifik > `all`; `outlet_id` terisi > `NULL`.

---

## 6. Transaksi

### `order`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | **Client-generated** |
| `tenant_id`, `outlet_id`, `device_id` | ulid | |
| `shift_id` | ulid FK | |
| `receipt_number` | text | `K1-20260726-0007` · `UNIQUE(device_id, business_date, sequence)` |
| `business_date` | date | **Bukan tanggal kalender** |
| `sequence` | int | Counter harian per device |
| `status` | text | `open`·`paid`·`closed`·`voided`·`refunded`·`abandoned` |
| `channel` | text | `dine_in`·`takeaway` |
| `owned_by_device_id` | ulid nullable | Untuk order `open` (KEP-21) |
| `subtotal`, `order_discount`, `service_charge_amount` | bigint | |
| `tax_amount`, `rounding_adjustment`, `total`, `amount_due` | bigint | |
| `has_calculation_variance` | bool | Ditandai server (FR-H6) |
| `variance_amount` | bigint nullable | |
| `voided_by_order_id` | ulid nullable | Menunjuk record void |
| `created_by`, `occurred_at`, `recorded_at`, `hlc` | | |

### `check`
`id` · `order_id` · `label` · `subtotal` · `total`
**v1: constraint aplikasi 1:1 dengan `order`.** Melonggarkannya nanti tidak memerlukan perubahan skema (KEP-06).

### `order_line`
| Kolom | Tipe | Peran |
|---|---|---|
| `id` | ulid PK | |
| `order_id`, `check_id` | ulid | |
| `variation_id` | ulid | **Referensi** — untuk pelaporan |
| `item_name`, `variation_name` | text | **Snapshot** |
| `unit_price` | bigint | **Snapshot** |
| `quantity` | numeric | **Numerik**, bukan integer |
| `modifier_snapshot` | jsonb | `[{name, price, qty}]` |
| `discount_amount` | bigint | Snapshot nilai, bukan referensi aturan |
| `tax_rate_id` | ulid nullable | Referensi |
| `tax_rate`, `tax_amount` | numeric/bigint | **Snapshot** |
| `is_tax_inclusive` | bool | **Snapshot** |
| `cost_at_sale` | bigint | **Snapshot — paling sering dilupakan** |
| `line_total` | bigint | |

### `order_line_modifier`
`id` · `order_line_id` · `modifier_id` (referensi) · `name` · `price` · `quantity` (snapshot)

### `payment`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `order_id`, `check_id` | ulid | |
| `method` | text | `cash`·`qris_dynamic`·`qris_static`·`card_edc`·`other` |
| `amount` | bigint | Selalu positif |
| `tendered_amount`, `change_amount` | bigint nullable | Tunai |
| `status` | text | `pending_confirmation`·`confirmed`·`failed`·`voided` |
| `provider`, `provider_reference` | text nullable | |
| `terminal_reference`, `approval_code` | text nullable | EDC |
| `card_last4` | text nullable | **CHECK length ≤ 4** |
| `card_brand`, `acquirer` | text nullable | |
| `confirmed_manually` | bool | QRIS statis |
| `mdr_estimated` | bigint nullable | |
| `tendered_at` | timestamptz | |

**Larangan eksplisit:** tidak ada `card_number`, `cvv`, `pin_block`, `track_data`.

### `refund`
`id` · `order_id` · `amount` · `reason_code` · `reason_note` · `created_by` · `approved_by` · `occurred_at` · `recorded_at` · `hlc`
**Constraint:** `SUM(refund.amount)` per order ≤ `order.total` — ditegakkan aplikasi + test.

---

## 7. Kas & shift

### `cash_drawer_shift`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `tenant_id`, `outlet_id`, `device_id` | ulid | |
| `business_date` | date | |
| `status` | text | `open`·`counting`·`closed` |
| `opening_float` | bigint | |
| `opened_by`, `opened_at` | | |
| `counted_amount` | bigint nullable | **Dimasukkan kasir** |
| `expected_amount` | bigint nullable | **Dihitung sistem** |
| `difference` | bigint nullable | Turunan, disimpan |
| `count_attempts` | jsonb | Riwayat percobaan hitung |
| `variance_reason_code`, `variance_note` | text nullable | |
| `closed_by`, `approved_by`, `closed_at` | | |

**Constraint:** maksimal satu shift `open` per device.

### `cash_movement`
`id` · `shift_id` · `type` (`opening_float`·`sale`·`refund`·`paid_in`·`paid_out`·`bank_deposit`·`adjustment`) · `delta` (bigint bertanda) · `order_id` nullable · **`counterpart_type`** (`sales_revenue`·`refund`·`owner_draw`·`expense`·`bank`·`unidentified`) · `reason_code` · `note` · `created_by` · `occurred_at` · `recorded_at` · `hlc`

**Invariant:** `expected_amount` = `opening_float` + `SUM(delta)`.

---

## 8. Inventori

### `stock_movement`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `tenant_id`, `outlet_id`, `device_id` | ulid | |
| `variation_id` | ulid | |
| `type` | text | `sale`·`void`·`refund`·`receipt`·`adjustment`·`stocktake`·`transfer_in`·`transfer_out` |
| `delta` | numeric | Bertanda |
| `order_id`, `stocktake_id` | ulid nullable | |
| `reason_code`, `note` | text nullable | Wajib untuk `adjustment` |
| `unit_cost` | bigint nullable | Untuk `receipt` |
| `created_by`, `occurred_at`, `recorded_at`, `hlc` | | |

**Tidak ada tabel `stock` atau kolom `quantity_on_hand`.** Stok = `SUM(delta)` per `(outlet_id, variation_id)`.

**Index wajib:** `(tenant_id, outlet_id, variation_id, occurred_at)`.

### `sold_out_flag`
`id` · `outlet_id` · `variation_id` · `is_sold_out` · `set_by` · `set_at` · `hlc`
Terpisah dari stok terhitung — produk bisa "habis" meski stok tercatat 10.

### `stocktake`, `stocktake_line`
`stocktake`: `id` · `outlet_id` · `status` (`draft`·`counting`·`approved`) · `snapshot_at` · `started_by` · `approved_by`
`stocktake_line`: `stocktake_id` · `variation_id` · `expected_qty` (pada `snapshot_at`) · `counted_qty` · `reason_code`

---

## 9. Audit

### `audit_event`
| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | ulid PK | |
| `tenant_id`, `outlet_id`, `device_id` | ulid | |
| **`actor_user_id`** | ulid | Yang melakukan |
| **`approver_user_id`** | ulid nullable | **Yang menyetujui — pembeda audit berguna** |
| `event_type` | text | Daftar di spec F § F.6 |
| `entity_type`, `entity_id` | text/ulid | |
| `before`, `after` | jsonb | Untuk perubahan |
| `reason_code`, `reason_note` | text nullable | |
| `occurred_at`, `recorded_at`, `hlc` | | |

**Constraint:** `actor_user_id ≠ approver_user_id`.
**Retensi:** minimal 5 tahun — lebih panjang dari transaksi.
**Tidak ada `UPDATE`/`DELETE`.**

---

## 10. Perangkat

### `device`
`id` · `tenant_id` · `outlet_id` · `code` (`K1`) · `name` · `platform` · `app_version` · `schema_version` · `token_hash` · `credentials_expire_at` · `last_seen_at` · `revoked_at`

**Constraint:** `UNIQUE(outlet_id, code) WHERE revoked_at IS NULL`.

### `peripheral`
`id` · `device_id` nullable · `outlet_id` · `type` (`printer`·`drawer`·`scanner`·`display`) · `connection` (`usb`·`bluetooth`·`network`) · `address` · `printer_profile_id` · `last_test_at`

### `printer_profile`
`id` · `name` · `paper_width_mm` · `chars_per_line` · `codepage` · `has_cutter` · `init_command` · `cut_command` · `drawer_command` · `image_support`
**Data, bukan kode** — menambah model printer = menambah baris.

### `print_job`
`id` · `order_id` nullable · `peripheral_id` · `document` (jsonb) · `status` · `attempts` · `last_error` · `created_at`

---

## 11. Tabel server-only

### `idempotency_key`
`key` (PK) · `tenant_id` · `request_hash` · `response_status` · `response_body` (jsonb) · `created_at` · `expires_at`
**Retensi 30 hari** (bukan 24 jam — perangkat bisa offline lebih lama).
Ditulis dalam transaksi yang sama dengan entitas yang dilindungi.

### `outbox`
`id` · `aggregate_type` · `aggregate_id` · `event_type` · `payload` · `published_at`
Transactional outbox — event dipancarkan setelah commit.

### `oversell_event`
`id` · `tenant_id` · `outlet_id` · `variation_id` · `detected_at` · `devices_involved` (jsonb) · `orders_involved` (jsonb) · `quantity_over` · `resolved_by` · `resolved_at` · `resolution_note`

### `usage_metric`, `subscription`, `support_session`, `schema_migration`
Sesuai spec modul komersial dan operasional.

---

## 12. Tabel lokal-only (SQLite, tidak direplikasi)

### `outbox_local`
`id` · `entity_type` · `entity_id` · `operation` · `payload` · `idempotency_key` · `status` (`pending`·`sending`·`sent`·`failed`) · `attempts` · `last_error` · `last_attempt_at` · `created_at`

### `device_config`
`device_code` · `outlet_id` · `receipt_sequence` · `sequence_business_date` · `hlc_state` · `last_sync_at`

### `sync_checkpoint`
`table_name` · `last_synced_hlc` · `last_synced_at`

---

## 13. Pemetaan tipe PostgreSQL ↔ SQLite

Skema diturunkan dari **satu sumber**; perbedaan tipe dipetakan eksplisit.

| Konsep | PostgreSQL | SQLite | Catatan |
|---|---|---|---|
| ID | `text` (ULID) atau `uuid` | `TEXT` | ULID sebagai text di keduanya menghindari konversi |
| Uang | `bigint` | `INTEGER` | SQLite INTEGER 64-bit |
| Kuantitas | **`bigint` ×1000** | **`INTEGER` ×1000** | ✅ **Diputuskan lewat pengukuran** — lihat `/prototypes/01-sqlite-sizing/FINDINGS.md` |
| Waktu | `timestamptz` | `TEXT` ISO-8601 UTC | Selalu UTC di penyimpanan |
| Boolean | `boolean` | `INTEGER` 0/1 | |
| JSON | `jsonb` | `TEXT` | Parsing di aplikasi |
| Enum | `text` + CHECK | `TEXT` + CHECK | |
| HLC | `bigint` | `INTEGER` | 64-bit |

### Kuantitas — keputusan berdasarkan pengukuran

`[FAKTA — diukur 27 Jul 2026]` `REAL` di SQLite **gagal** untuk kuantitas:

| Uji | `REAL` | `INTEGER ×1000` |
|---|---|---|
| Terima 1.000 kg → jual habis dalam 1.411 transaksi pecahan | `-4.6e-12` | `0.0` |
| `WHERE SUM(delta) = 0` (query "stok habis") | **tidak cocok — gagal diam-diam** | cocok |
| Tampilan ke merchant | `-4.605760217657462e-12 kg` | `0.0 kg` |

Perkalian tunggal aman di kedua tipe (pembulatan ke rupiah menyerap galat), tetapi **akumulasi pada ledger tidak** — dan stok justru didefinisikan sebagai `SUM(delta)`.

**Keputusan: `INTEGER ×1000` di kedua sisi.** `0.5 kg` → `500`. Float dihilangkan sepenuhnya dari jalur kuantitas, sejajar dengan aturan yang sudah berlaku untuk uang. Konversi ×1000 dan ÷1000 terjadi di satu lapisan, bukan tersebar.

*Sumber: `/prototypes/01-sqlite-sizing/FINDINGS.md` § 1*

---

## 14. Row-Level Security

**Pola untuk setiap tabel:**

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;   -- penting: owner tabel juga tunduk

CREATE POLICY tenant_select ON <t> FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::text);
CREATE POLICY tenant_insert ON <t> FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::text);
CREATE POLICY tenant_update ON <t> FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id')::text)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::text);
CREATE POLICY tenant_delete ON <t> FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id')::text);
```

**Tiga kesalahan yang membuat RLS menjadi ilusi keamanan:**

1. Aplikasi terhubung sebagai **superuser atau owner tabel** — keduanya melewati RLS secara default tanpa gejala apa pun. Aplikasi **wajib** memakai user terpisah tanpa `BYPASSRLS`, dan `FORCE ROW LEVEL SECURITY` wajib aktif.
2. Hanya membuat kebijakan `SELECT` — penulisan lintas tenant tetap lolos.
3. `app.tenant_id` di-set per koneksi alih-alih **per transaksi** (`SET LOCAL`) — connection pooling akan membocorkan konteks antar request.

**Gate CI wajib:** buat dua tenant, coba akses data tenant A dengan konteks tenant B untuk **setiap** tabel, pastikan hasilnya kosong dan penulisan ditolak.

---

## 15. Index

| Tabel | Index |
|---|---|
| `order` | `(tenant_id, outlet_id, business_date)` · `(device_id, business_date, sequence)` UNIQUE · `(status)` partial untuk `open` |
| `order_line` | `(order_id)` · `(variation_id, occurred_at)` untuk laporan produk |
| `payment` | `(order_id)` · `(status)` partial untuk `pending_confirmation` |
| `stock_movement` | `(tenant_id, outlet_id, variation_id, occurred_at)` · **`(tenant_id, outlet_id, hlc)`** — yang kedua wajib untuk snapshot delta (§16); tanpanya snapshot tidak berguna |
| `stock_snapshot` | PK `(tenant_id, outlet_id, variation_id)`, `WITHOUT ROWID` |
| `audit_event` | `(tenant_id, outlet_id, occurred_at)` · `(actor_user_id, occurred_at)` · `(event_type, occurred_at)` |
| `cash_movement` | `(shift_id)` |
| `idempotency_key` | PK · `(expires_at)` untuk pembersihan |
| `item_variation` | `(tenant_id, barcode)` UNIQUE partial |

**Partitioning by range bulanan** sejak awal: `order_line`, `stock_movement`, `audit_event`, `payment`. Menambahkannya belakangan pada tabel besar sangat mahal.

---

## 16. Snapshot stok — masuk v1

`[FAKTA — diukur 27 Jul 2026]` Versi sebelumnya dokumen ini menunda snapshot dengan ambang 500.000 movement. **Pengukuran menunjukkan angka itu terlalu lambat.**

### Data pengukuran

| Skenario | Variation | Movement | Agregasi langsung |
|---|---:|---:|---:|
| Kafe kecil, 90 hari | 321 | 37.349 | 17,0 ms |
| Kafe menengah, 90 hari | 1.293 | 74.289 | 58,2 ms |
| Kafe besar, 90 hari | 3.203 | 124.389 | **117,9 ms** |

Regresi: `waktu ≈ 1,155 ms per 1.000 movement − 27` → **200 ms tercapai pada ≈197.000 movement**, bukan 500.000.

Pada tablet kasir 3–5× lebih lambat `[ASUMSI]`, ambangnya turun ke **39.000–66.000 movement** — yang dicapai kafe besar dalam **kurang dari 30 hari**.

### Keputusan

**`stock_snapshot` masuk v1.**

```sql
CREATE TABLE stock_snapshot (
  tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL, variation_id TEXT NOT NULL,
  balance INTEGER NOT NULL,          -- x1000
  checkpoint_hlc INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, outlet_id, variation_id)
) WITHOUT ROWID;
```

**Index yang wajib menyertainya** — tanpa ini snapshot tidak berguna:

```sql
CREATE INDEX ix_mv_hlc ON stock_movement(tenant_id, outlet_id, hlc);
```

**Pembacaan stok:** `snapshot.balance + COALESCE(SUM(delta) WHERE hlc > checkpoint_hlc, 0)`

**Rebuild:** saat **tutup shift**, bukan nightly job. Tutup shift sudah merupakan jeda operasional alami, biayanya 126 ms, dan delta setelahnya hanya mencakup movement sejak shift dibuka.

### Hasil terukur

| | Waktu | Percepatan |
|---|---:|---:|
| Agregasi langsung | 116,3 ms | — |
| Snapshot, 0 movement sejak checkpoint | **1,1 ms** | **107×** |
| Snapshot, 1 hari sejak checkpoint | **1,9 ms** | **61×** |

Percobaan tanpa `ix_mv_hlc` hanya menghasilkan 117,7 → 111,6 ms — **hampir tidak membantu**, karena subquery delta memindai tabel penuh. Index inilah yang membuat pola ini bekerja.

*Sumber: `/prototypes/01-sqlite-sizing/FINDINGS.md` § 5*

---

## 17. Migrasi

**Pola wajib: expand-contract.**

```
1. EXPAND    tambah kolom baru (nullable atau default tanpa rewrite)
2. BACKFILL  isi ber-batch dengan jeda
3. SWITCH    deploy kode yang menulis keduanya, lalu membaca yang baru
4. CONTRACT  hapus kolom lama — MINIMAL SATU RILIS PENUH setelah switch
```

**Aturan yang mengikat setiap migrasi:**

| Aturan | Alasan |
|---|---|
| `SET lock_timeout` di setiap migrasi | Migrasi yang tidak dapat lock **gagal cepat** alih-alih memblokir seluruh merchant. Satu baris yang mencegah insiden terburuk |
| `CREATE INDEX CONCURRENTLY` untuk tabel produksi | Index biasa memblokir penulisan |
| Kolom baru nullable atau default yang tidak memicu rewrite | Menghindari lock panjang |
| Migrasi idempoten dan berurutan | Instalasi on-prem bisa tertinggal beberapa versi |
| Setiap migrasi dalam transaksi | Kegagalan meninggalkan sistem di versi lama yang berfungsi |

**Migrasi SQLite lokal: aditif-saja** sampai beberapa versi berlalu. Rollback aplikasi relatif sederhana; rollback skema lokal setelah data ditulis hampir mustahil.

---

## 18. State machine

**Order:** `open → paid → closed` · `open|paid → voided` · `closed → refunded` · `open → abandoned`
Ditolak: `closed → open` · `voided → *` · `refunded → paid`

**CashDrawerShift:** `open → counting → closed`. Tidak dapat dibuka ulang.

**Payment:** `pending_confirmation → confirmed|failed` · `confirmed → voided`

**OutboxLocal:** `pending → sending → sent` · `pending|sending → failed → pending` (retry)

**Stocktake:** `draft → counting → approved`

---

## 19. Open questions ERD

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| ~~Kuantitas `numeric` atau integer ×1000?~~ | ✅ **Terjawab** — `INTEGER ×1000`, lihat §13 | — |
| ~~OQ-07 jendela riwayat lokal~~ | ✅ **Terjawab** — 90 hari = 39–130 MB, aman. Lihat `/prototypes/01-sqlite-sizing/FINDINGS.md` | — |
| OQ-09 | `VerticalProfile` per tenant atau outlet — ERD mengasumsikan **per outlet dengan default tenant** | Implementasi skema |
| — | Apakah `check` benar-benar dipertahankan di v1, mengingat split bill tidak dirilis? Menghapusnya menyederhanakan; mempertahankannya menghindari migrasi | Implementasi skema |
| — | Retensi `order_line` dan `stock_movement` — kapan diarsipkan ke cold storage? | Setelah 12 bulan produksi |
| — | Apakah data pelanggan (nama, telepon) disimpan sebagai entitas terpisah atau field di order? UU PDP menuntut minimalisasi dan retensi terbatas | Implementasi modul pelanggan |

---

*ERD Lumi POS v1 · Draft 0.1 · 27 Juli 2026*
