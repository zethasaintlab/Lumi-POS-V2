# Modul server

Batas modul **ditegakkan**, bukan konvensi. Lihat `product/ARCH-lumi-pos-v1.md` § 3.

## Aturan

1. `index.ts` adalah **satu-satunya** permukaan publik tiap modul.
2. **Tidak ada query ke tabel milik modul lain.** Kepemilikan tabel:

| Modul | Tabel yang dimiliki |
|---|---|
| `tenancy` | `tenant`, `outlet`, `vertical_profile`, `subscription_invoice`, `usage_metric` |
| `identity` | `user`, `role`, `user_role`, `device`, `support_session`, `device_telemetry` |
| `rilis` | `app_release` |
| `catalog` | `category`, `item`, `item_variation`, `modifier_list`, `modifier`, `item_modifier_list`, `price_history` |
| `ordering` | `order`, `check`, `order_line`, `order_line_modifier`, `refund` |
| `payment` | `payment`, `tax_rate` |
| `inventory` | `stock_movement`, `stock_snapshot`, `sold_out_flag`, `stocktake`, `stocktake_line`, `oversell_event` |
| `cash` | `cash_drawer_shift`, `cash_movement` |
| `reporting` | — **tidak memiliki tabel apa pun**. Satu-satunya modul yang boleh MEMBACA lintas domain (keputusan user 16 Agustus 2026); tidak menulis apa pun |
| `sync` | `idempotency_key`, `outbox` |
| `peripheral` | `peripheral`, `printer_profile`. ⛔ `print_job` **murni lokal di perangkat** (`db/local/001-initial.sql`) — struk adalah artefak perangkat, dan printer yang gagal di kasir 1 tidak dapat dicetak ulang oleh kasir 2 |
| `audit` | `audit_event` |

3. Lint rule melarang import dalam-dalam antar modul.
4. Idealnya kepemilikan ditegakkan lewat **skema PostgreSQL terpisah per modul dengan grant terbatas**, sehingga pelanggaran gagal di runtime — bukan menunggu review.

## Modul yang sudah punya kode

| Modul | Isi | Permukaan publik |
|---|---|---|
| `catalog` | Kategori, item/variation, modifier, harga per outlet | 32 operasi REST · `resolvePrice` · `getVariationSnapshot` |
| `ordering` | Penulisan penjualan, void & refund, seluruh laporan atas `order` | `POST /orders` · `GET /orders/{id}` · `POST /orders/{id}/cancel` · `GET /reports/sales` · `GET /reports/recap` · `GET /reports/export` · `ambilPenjualan` · `ambilProduk` |
| `identity` | Provisioning device (FR-B6) | `POST /devices` · `POST /devices/{id}/revoke` · `assertUserVisible` · `assertApproverVisible` · `assertDeviceVisible` |
| `identity` | Telemetri perangkat (F6) | `POST /devices/{id}/telemetry` · `GET /devices/{id}/telemetry` — barisnya berkunci perangkat, dan penjaganya kredensial perangkat (`kredensial-perangkat.ts`), yang sudah dimiliki modul ini |
| `rilis` | Staged rollout (F6) | `GET /devices/{id}/update` · `POST /devices/{id}/update/defer` — keputusannya menunjuk `device` (identity) DAN `outlet`/`tenant` (tenancy), jadi ia modul tersendiri alih-alih membuat salah satu dari keduanya meng-query tabel milik yang lain |
| `cash` | Buka shift, tutup kas, no-sale (FR-D7) | `POST /shifts` · `POST /shifts/{id}/close` · `POST /shifts/{id}/no-sale` · `assertShiftOpen` |
| `payment` | Tarif pajak; pembayaran tunai, QRIS dinamis, QRIS statis, EDC; webhook gateway | `POST /tax-rates` · `GET /tax-rates` · `POST /tax-rates/{id}/end` · `POST /orders/{id}/payments` · `POST /payments/{id}/check-status` · `POST /webhooks/midtrans` · `fetchEffectiveTaxRates` · `selectPaymentProvider` · `selectSubscriptionProvider` |
| `tenancy` | Pendaftaran merchant mandiri + kuota + langganan (F5) + kategori merchant (FR-C12) | `POST /tenants` · `POST /outlets` · `GET /tenants/usage` · `PATCH /tenants/settings` · `POST /tenants/subscription/invoices` · `GET /tenants/subscription/invoices` · `POST /tenants/subscription/invoices/{id}/check-status` · `batasKuota` · `assertKuota` · `assertOutletVisible` · `getOutletSettings` · `getMerchantCategory` · `terapkanStatusTagihan` |
| `sync` | Tidak punya endpoint; worker relay `outbox` adalah F2 | `findIdempotencyKey` · `claimIdempotencyKey` · `completeIdempotencyKey` · `insertOutboxEvent` |
| `inventory` | Pergerakan stok, opname, penandaan habis | `POST /inventory/movements` · `POST /inventory/stocktakes` · `POST /inventory/sold-out` · `recordStockMovements` · `detectOversell` |
| `audit` | Irisan minimal Modul F — hanya penulisan satu event | `recordAuditEvent` |

`peripheral` lahir 25 Agustus 2026 dengan dua operasi
(`POST /peripherals`, `GET /printer-profiles`) — menutup lubang TERAKHIR audit
trail FR-F6, dan memberi perangkat jalan untuk mengatakan printer mana yang
ada padanya. Sebelum itu, K-09/K-15 memilih profil dengan `p[0]` dari query
tanpa `ORDER BY`.

`audit` lahir dengan **satu fungsi**, dan itu bukan penundaan yang malas. Keputusan produk 1 Agustus 2026 menetapkan void berjalan **tanpa PIN manajer**, dengan syarat alasan daftar tertutup + audit + restock otomatis — jadi keduanya bukan pelengkap void, melainkan kontrol yang tersisa untuknya. Invariant #1 menuntut keduanya ditulis dalam transaksi yang sama, dan aturan 2 melarang `ordering` menyentuh `stock_movement` maupun `audit_event` langsung.

Perhitungan stok (`SUM(delta)`) tetap dibaca modul `reporting`, yang boleh menggabungkan `stock_movement` dengan katalog. RBAC, PIN, sesi, dan seluruh permukaan query/laporan audit tetap Modul F penuh.

## Kenapa modul-modul kecil itu ada

`tenancy`, `identity`, dan `sync` sebagian besar berisi satu-dua fungsi, dan itu disengaja. Aturan 2 melarang sebuah modul meng-query tabel milik modul lain, sementara jalur penjualan menunjuk ke mana-mana: `order.shift_id` → `cash`, `order.device_id` → `identity`, `order.outlet_id` → `tenancy`, `order_line.variation_id` → `catalog`, `idempotency_key` → `sync`.

Alternatifnya adalah `ordering` meng-query enam tabel milik lima modul lain. Fungsi kecil yang diekspor lewat `index.ts` adalah harga yang dibayar untuk menjaga batas itu tetap nyata, bukan sekadar tertulis.

## Port keluar: `PaymentProvider`

`ARCH:197` mendefinisikannya, tapi yang membuatnya **wajib** adalah CI: `.github/workflows/test.yml` mengisi `MIDTRANS_SERVER_KEY` dengan string kosong. Test yang memanggil API sungguhan akan gagal di sana, lambat, dan bergantung pada layanan pihak ketiga yang bisa down saat tidak ada yang melihat.

Konsekuensinya mutlak: **tidak ada satu pun test yang boleh menyentuh jaringan.** Adapter Midtrans menerima `fetch` sebagai dependensi; adapter dipilih di `buildApp` lewat `PAYMENT_PROVIDER`, bukan `if (isProduction)` di kode aplikasi (invariant #5).

`PAYMENT_PROVIDER=midtrans` dengan kunci kosong **gagal saat boot**, bukan saat pelanggan pertama membayar.

## ⛔ Penjaga sesi: fail-closed, dan jalur kasir SENGAJA di luar

`apps/server/src/sesi.ts` memasang hook `onRequest` yang memverifikasi `Authorization: Bearer` terhadap `user_session`. Setiap rute WAJIB membawa sesi **kecuali** yang terdaftar eksplisit di `RUTE_TERBUKA` — endpoint yang ditambahkan besok terlindungi tanpa ada yang perlu ingat melindunginya.

Sebelum ini, `X-Actor-Id` adalah satu-satunya identitas yang dipegang server: header biasa berisi id pengguna. Siapa pun yang tahu sepasang tenant_id + user_id dapat memanggil seluruh permukaan back-office.

| | |
|---|---|
| `Authorization: Bearer` | **Kredensialnya.** Barisnya dicari di `user_session`; kedaluwarsa dan pengguna nonaktif ditolak |
| `X-Tenant-Id` | **Petunjuk pencarian**, bukan otoritas — `user_session` tunduk RLS. Berbohong tidak membeli apa pun |
| `X-Actor-Id` | **DIABAIKAN** di rute terlindungi. `getActorId` mengutamakan `req.sesi` |

⛔ **Jalur perangkat kasir tidak ikut dilindungi, dan itu dipaksa kenyataan.** Relay outbox mengirim tepat empat header dan tidak satu pun Bearer; `spec-f:183` melarang kasir punya sesi back-office. Menuntut sesi di `POST /orders`, `/shifts`, `/orders/{id}/cancel`, `/orders/{id}/payments` berarti **setiap penjualan offline yang menyusul dijawab 401** — jalur naik mati. Menutupnya menuntut kredensial perangkat (FR-F12) menjadi kredensial permintaan, dan itu pekerjaan tersendiri.

⛔ **`onRequest`, bukan `preHandler`.** Validasi skema OpenAPI berjalan di antara keduanya. Terukur: dipasang di `preHandler`, `POST /items` dengan body `{}` tanpa Bearer menjawab **400**, sementara body sah menjawab 401 — pemanggil tanpa kredensial dapat memetakan bentuk request setiap endpoint dari selisih itu.

## Dua endpoint tanpa `X-Tenant-Id` — dan alasannya berbeda

`POST /tenants` (pendaftaran, F5) menyusul webhook Midtrans sebagai yang kedua. Alasannya tidak sama:

| Endpoint | Kenapa tidak ada header | Dari mana tenant-nya |
|---|---|---|
| `POST /webhooks/midtrans` | Midtrans tidak tahu apa-apa soal tenant kami | `custom_field1` yang kami titipkan sendiri saat charge |
| `POST /tenants` | **Tenantnya belum ada** — tidak ada nilai yang benar | Id yang di-generate klien di body |

Keduanya tetap menulis di dalam transaksi ber-`SET LOCAL app.tenant_id`. Pada pendaftaran, `SET LOCAL` berjalan dengan id yang belum punya baris; `tenant` — satu-satunya tabel yang dikecualikan RLS, karena ia akar model tenancy — ditulis di dalamnya, dan setiap tabel sesudahnya sudah tunduk RLS seperti biasa. **Invariant #8 tidak dilonggarkan di jalur mana pun.**

⛔ Pendaftaran belum punya rate limit maupun verifikasi email. Endpoint publik yang membuat baris database; wajib ditutup sebelum merchant berbayar pertama.

### Webhook: dua hal yang hanya berlaku di sana

Midtrans tidak tahu apa-apa soal tenant kami. Karena itu `POST /webhooks/midtrans` berbeda dari seluruh endpoint lain:

1. **Signature diverifikasi lebih dulu**, sebelum satu query pun dijalankan.
2. **Tenant dibaca dari `custom_field1`** yang kami titipkan sendiri saat charge, lalu dipakai sebagai `app.tenant_id` — sehingga pencarian payment tetap tunduk RLS. Notifikasi bertanda tangan sah tapi bertenant salah dijawab `404`.

Alternatifnya adalah query yang melewati RLS, dan itu melanggar invariant #8.

3. **⛔ Satu URL, dua jenis tagihan (F5).** Midtrans mengirim SELURUH notifikasi ke URL yang sama. Sebelum F5, handler ini memperlakukan `order_id` notifikasi sebagai id payment kami dan menjawab `404 PAYMENT_NOT_FOUND` bila tidak ditemukan — sementara Midtrans **mengirim ulang notifikasi yang tidak dijawab 200**. Notifikasi tagihan langganan pertama karena itu akan dijawab 404 lalu diulang selamanya.

   Yang menutupnya adalah **prefiks** (`sub-`) pada id yang dititipkan ke gateway, dan rutenya diputuskan dari string-nya — **sebelum satu query pun jalan**. Alternatifnya (mencari di kedua tabel) menghasilkan dua pencarian yang keduanya gagal untuk notifikasi asing, dan jenis tagihan berikutnya menambah pencarian ketiga.

   Tabel `subscription_invoice` milik `tenancy`, jadi yang menyentuhnya adalah `terapkanStatusTagihan` yang diekspor modul itu; transaksinya tetap dibuka di webhook supaya batasnya satu dan sama untuk kedua jenis.

## Kuota: empat titik administratif, nol di jalur kasir

`research/09` § 6, aturan mutlak: *"tidak ada kuota yang boleh menghentikan penjualan."*

| Dimensi | Ditegakkan di | Yang menghitung | Tidak dihitung |
|---|---|---|---|
| `max_outlets` | `POST /outlets` | tenancy | outlet terarsip |
| `max_devices` | `POST /devices` | identity | perangkat tercabut |
| `max_users` | `POST /users` | identity | pengguna nonaktif |
| `max_products` | `POST /items` **dan `POST /catalog/import`** | catalog | item terarsip |

⛔ **`tenancy` tidak menghitung apa pun.** Ia hanya membaca kolom `max_*` dan menjalankan aturannya; `COUNT(*) FROM item` dijalankan catalog, `FROM device` oleh identity (invariant #4). Kalau tenancy menghitung sendiri, ia harus tahu aturan arsip setiap modul lain — dan aturan itu berbeda di tiap modul, seperti tabel di atas menunjukkan.

⛔ **Impor dinilai UTUH, atas produk BARU saja.** `(terpakai + produk baru) <= kuota`, ditolak `403` sebagai satu kesatuan. Memeriksa per baris akan memasukkan 200 baris pertama lalu menolak sisanya — impor parsial yang meninggalkan katalog setengah jadi tanpa cara membatalkannya, karena katalog tidak pernah di-`DELETE` (invariant #2).

Yang **tidak** dihitung, karena tidak menambah produk: baris `dilewati` (nama sudah ada, mode `lewati`), baris `valid.perbarui` (nama sudah ada, mode `perbarui` — yang disentuhnya hanya `category_id`), dan baris `masalah` (tidak dapat diparse). Versi pertama menghitung seluruh baris berkas dan menabrak `spec-a:288` secara langsung: alur yang spec sebut adalah "unduh baris gagal → perbaiki → unggah ulang", jadi unggah-ulang berkas yang sama selalu menghitung ulang seluruh barisnya — merchant dihukum karena memperbaiki datanya sendiri.

## `POST /tenants`: satu-satunya endpoint yang dibatasi lajunya

`@fastify/rate-limit`, store **in-memory** (`research/03` mengunci "tanpa Redis di v1"), `global: false`, hanya pada `POST /tenants`. Angkanya dari `TENANT_REGISTRATION_RATE_MAX` / `TENANT_REGISTRATION_RATE_WINDOW` (invariant #5), bawaan 5 per 15 menit.

⛔ **Bukan global, dan itu bukan penghematan.** Endpoint lain sudah dijaga `X-Tenant-Id` + RLS, dan membatasi jalur kasir berarti membangun kemampuan **menghentikan penjualan** dari sisi server — hal yang sama yang `research/09` § 6 larang untuk kuota. Perangkat di balik satu NAT outlet berbagi alamat IP; batas global akan mengunci kasir kedua pada jam sibuk.

⛔ **`errorResponseBuilder` mengembalikan `HttpError`, bukan objek berbentuk respons.** Yang dikembalikan di sana dilempar sebagai error dan melewati `setErrorHandler`; objek `{ error: { … } }` tanpa `statusCode` tidak dikenali cabang mana pun dan keluar sebagai **500**. Ditemukan dengan menjalankannya — tidak ada satu pun tipe yang mengeluh.

Batas yang tersisa: **tidak ada captcha**, dan hitungannya per-proses (hilang saat restart, tidak dibagi antar instance). Ia menahan penyalahgunaan kasar, bukan penyerang terdistribusi.

⛔ **`tenant` adalah satu-satunya tabel yang `WHERE tenant_id`-nya WAJIB.** Ia dikecualikan RLS (akar model tenancy). Setiap tabel lain menyaring dirinya sendiri walau `WHERE` lupa ditulis; di sini `SELECT max_products FROM tenant` tanpa `WHERE` mengembalikan baris **setiap merchant**, dan kuota yang terbaca adalah kuota siapa pun yang kebetulan pertama.

Bahwa jalur kasir tidak menyentuhnya dijaga statis: `tests/domain/kuota-tidak-di-jalur-kasir.test.js` memindai `ordering`, `payment`, `cash`, dan `inventory`. Test perilaku hanya membuktikan kuota tidak menolak penjualan **pada keadaan yang diujinya** — merchant yang melewati kuota lalu menjual barang yang sudah ada di katalognya adalah keadaan yang tidak terpikir dituliskan sampai ia terjadi di outlet sungguhan.

## Guard lintas modul: SELECT, bukan foreign key

**Setiap guard semacam ini WAJIB berupa `SELECT` yang tunduk RLS di dalam transaksi pemanggil.** Foreign key tidak cukup.

FK PostgreSQL dicek dengan privilese owner tabel yang direferensikan dan **tidak tunduk `FORCE ROW LEVEL SECURITY`** — ia hanya membuktikan baris itu ada di *suatu* tenant, bukan tenant yang benar.

Ini bukan teori. Dibuktikan **empat kali** di repo ini lewat sabotase yang disengaja, tiap kali di FK berbeda dan modul berbeda: `item.category_id`, `price_history.outlet_id`, dan terakhir `order.shift_id` — semuanya menghasilkan `201` dengan baris yang **benar-benar tersimpan** menunjuk tenant lain. Rinciannya di `CLAUDE.md` § "Temuan F1".

Anggap setiap FK klien-suplai baru terpapar sampai kamu membuktikan sebaliknya.

### Dan guard yang tidak dapat DIBEDAKAN adalah guard yang tidak teruji

Ditemukan saat membangun refund (7 Agustus 2026). Penyetuju refund divalidasi di dua tempat: guard eksplisit di jalur refund, dan lagi di dalam `recordAuditEvent` beberapa langkah kemudian. Keduanya memakai pesan yang sama, jadi saat guard pertama **dimatikan sepenuhnya**, seluruh suite tetap hijau — yang kedua menjawab dengan status dan kode yang sama persis.

Perbaikannya bukan menghapus salah satunya: `refund.approved_by` ditulis **sebelum** audit berjalan, dan kolom itu tidak punya FK sama sekali. Yang diperbaiki adalah pesannya — `assertApproverVisible` lahir dengan kode `APPROVER_NOT_FOUND`, terpisah dari `ACTOR_NOT_FOUND`. Itu sekaligus memperbaiki cacat yang lebih nyata: manajer yang penyetujuannya ditolak sebelumnya diberi tahu bahwa **kasir**-nya yang tidak ditemukan.

Aturannya: bila dua lapisan menjaga hal yang sama, pastikan keduanya dapat dibedakan dari luar. Kalau tidak, salah satunya bisa hilang tanpa ada yang tahu.
