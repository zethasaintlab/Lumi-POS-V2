# Scaffold `apps/server` — fondasi Fastify + RLS tenant-context + OpenAPI spec-first

**Status:** Disetujui · **Tanggal:** 31 Juli 2026
**Bagian dari:** F1 — prasyarat sebelum modul Katalog (atau modul manapun) bisa punya endpoint nyata. Bukan gate F0 (F0 sudah tertutup penuh sesi ini), tapi pekerjaan pertama F1.

## Konteks

`apps/server` saat ini benar-benar kosong — hanya `README.md` placeholder ("Fastify + modular monolith") dan `src/modules/README.md` (aturan batas modul: tabel per modul, `index.ts` sebagai satu-satunya permukaan publik, lint rule melarang import dalam-dalam). Tidak ada Fastify, tidak ada koneksi PostgreSQL, tidak ada wiring `SET LOCAL app.tenant_id` per transaksi (invariant #8), tidak ada setup OpenAPI. `packages/contracts` dan `packages/domain` juga masih README-only placeholder — README mereka sudah menyatakan maksudnya ("Spesifikasi OpenAPI + tipe TypeScript yang di-generate darinya" dan "Logika bisnis yang DIBAGI server dan klien").

User memilih memulai F1 dari modul Katalog (hulu — Order dan Payment butuh referensi produk), tapi Katalog butuh fondasi server ini lebih dulu. Sub-project ini HANYA fondasi — endpoint Katalog sungguhan adalah sub-project berikutnya.

Pola koneksi RLS sudah terbukti benar di `tests/isolation/helpers/seed.js`: `BEGIN` → `SELECT set_config('app.tenant_id', $1, true)` (parameter ketiga `true` = `is_local`, setara `SET LOCAL`) → query → `COMMIT`. Sub-project ini membungkus pola yang sama persis jadi helper yang dipakai server, bukan menemukan pola baru.

`.env.example` sudah punya `DATABASE_URL` (koneksi `lumi_app`, bukan superuser, bukan owner tabel — sesuai invariant #8) dan `PORT`.

## Keputusan desain

### 1. Kontrak API — `fastify-openapi-glue`, bukan route Fastify manual

Per `CLAUDE.md` (terkunci) dan `research/03-TECH-STACK-EVALUATION.md` KEP-09: REST + OpenAPI **spec-first**, karena aplikasi kasir yang sudah terpasang tidak bisa dipaksa update, jadi server harus melayani beberapa versi klien sekaligus untuk waktu lama — skenario yang membuat tRPC lemah dan kontrak eksplisit (OpenAPI) kuat.

"Spec-first" secara literal berarti: OpenAPI YAML adalah sumber kebenaran, kode mengikuti, bukan sebaliknya. Opsi yang dipertimbangkan:

- **A. `fastify-openapi-glue`** (dipilih) — route di-dispatch otomatis dari `operationId` di YAML ke fungsi handler yang ditulis terpisah. Tidak ada definisi route independen di kode, jadi tidak mungkin drift dari kontrak. Diverifikasi: package nyata di npm, versi terbaru 4.11.3, `engines.node >= 20` (proyek ini Node 22+, cocok).
- **B. Route Fastify manual + OpenAPI YAML terpisah + script pembanding drift.** Lebih familiar, tapi dalam praktik gampang jadi code-first (tambah route, lupa update YAML) — persis kegagalan yang coba dihindari dengan memilih spec-first sejak awal.

**Alasan memilih A:** ini satu-satunya opsi yang benar-benar menegakkan sifat yang jadi alasan keputusan arsitektur ini diambil.

### 2. Struktur file

```
apps/server/
  package.json              # fastify, pg, fastify-openapi-glue
  src/
    db.ts                   # pg Pool + withTenantTransaction() -- infrastruktur bersama,
                             # tidak dimiliki modul manapun
    app.ts                  # bootstrap instance Fastify, daftarkan openapi-glue
                             # menunjuk packages/contracts/openapi.yaml
    index.ts                # entrypoint: app.listen(PORT)

packages/contracts/
  openapi.yaml              # kontrak spec-first -- untuk sub-project ini hanya GET /health
  package.json              # baru: openapi-typescript sebagai devDependency + script generate
  types.d.ts                # tipe TS hasil generate (git-ignored, dibuat ulang saat build)

tests/server/
  health.test.js            # integrasi: instance Fastify nyata, GET /health lewat app.inject()
  tenant-transaction.test.js # membuktikan withTenantTransaction() men-set app.tenant_id per
                             # transaksi dan tidak bocor antar pemanggilan -- pola kontrol negatif
                             # yang sama dengan tests/isolation/set-local-per-transaction.test.js,
                             # sekarang diuji lewat helper nyata yang dipakai aplikasi
```

### 3. `withTenantTransaction` — bagian paling sensitif keamanan di sub-project ini

```ts
async function withTenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

Setiap modul yang dibangun setelah ini memakai helper yang sama untuk semua akses DB-nya — kalau ini benar sekali di sini, semua modul berikutnya mewarisi isolasi tenant yang benar secara gratis. Kalau salah di sini, semua modul berikutnya mewarisi kebocoran.

### 4. Endpoint tunggal untuk sub-project ini: `GET /health`

Bukan business logic — cuma cukup untuk membuktikan seluruh pipa (`openapi.yaml` → `fastify-openapi-glue` → handler → response) benar-benar tersambung sebelum modul Katalog membangun endpoint sungguhan di atasnya. Tidak menyentuh database (murni liveness check).

## Di luar scope (sengaja tidak disentuh)

- Endpoint Katalog sungguhan (`/items`, `/categories`, dst.) — sub-project F1 berikutnya, dibangun di atas fondasi ini.
- Lint rule pembatas import antar modul (`src/modules/README.md` aturan #3) — ditunda sampai ada ≥2 modul untuk saling dibatasi; belum ada satu pun modul dibangun di `src/modules/` saat ini, jadi belum ada yang perlu ditegakkan.
- `packages/domain` (TaxCalculator, state machine order, dll.) — urusan modul Payment/Ordering nanti, bukan scaffold ini.
- Autentikasi/otorisasi request nyata — `tenantId` di `withTenantTransaction` untuk sub-project ini datang dari test/pemanggil langsung, bukan dari token/session middleware (itu modul `identity`, F3 per tabel fase).
- Deployment/Docker — di luar scope teknis brainstorming ini.

## Verifikasi

- `npm install` dari root berhasil, `apps/server` dan `packages/contracts` ter-resolve sebagai workspace.
- `node --test tests/server/*.test.js` — kedua test hijau, termasuk kontrol negatif kebocoran tenant.
- `GET /health` lewat `app.inject()` mengembalikan respons yang cocok dengan skema di `openapi.yaml` (fastify-openapi-glue akan menolak start kalau schema tidak valid — ini sendiri sudah jadi verifikasi kontrak).
- Generate tipe TS dari `openapi.yaml` berhasil tanpa error (`npx openapi-typescript packages/contracts/openapi.yaml -o packages/contracts/types.d.ts`).
- Server bisa dijalankan manual (`node apps/server/src/index.ts` atau setara) dan `curl localhost:$PORT/health` merespons — butuh PostgreSQL lokal jalan (sudah prasyarat sejak gate F0).
