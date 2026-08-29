import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import type { Hlc } from '../../../../../packages/domain/src/hlc.ts';
import { createDeviceHandlers } from './handlers/devices.ts';
import { createTokenHandlers, type KonfigToken } from './handlers/tokens.ts';
import { createTelemetryHandlers } from './handlers/telemetry.ts';
import { createUserHandlers } from './handlers/users.ts';
import { createAuthHandlers } from './handlers/auth.ts';
import { createSupportHandlers } from './handlers/support.ts';
import { buatPinHasher } from './pin-hasher.ts';
import { bolehkah } from '../../../../../packages/domain/src/rbac.ts';

// Permukaan publik modul identity (apps/server/src/modules/README.md --
// kepemilikan tabel DITEGAKKAN). Modul catalog DILARANG query `"user"`
// langsung; `price_history.changed_by` menunjuk user(id) lintas modul --
// dan, tidak seperti FK lain di sistem ini, kolom itu bahkan TIDAK PUNYA FK
// sama sekali (db/migrations/0004_catalog.sql). Tanpa guard ini, id karangan
// apa pun akan masuk begitu saja ke kolom audit finansial.
//
// KENAPA `client` (bukan `pool`): SELECT ini harus tunduk RLS supaya "user
// ini ada" berarti "user ini ada DI TENANT PEMANGGIL", bukan di tenant mana
// pun. Sama seperti assertOutletVisible di modules/tenancy, dan sama seperti
// temuan F1 (CLAUDE.md) yang membuktikan FK PostgreSQL tidak tunduk RLS --
// di sini malah tidak ada FK sama sekali untuk jadi jaring pengaman kedua.
export async function assertUserVisible(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query('SELECT id FROM "user" WHERE id = $1 AND is_active = true', [userId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'ACTOR_NOT_FOUND', `Aktor ${userId} tidak ditemukan atau tidak aktif.`);
  }
}

/**
 * Sama persis dengan `assertUserVisible`, KECUALI pesannya.
 *
 * Terpisah karena pesan yang salah di sini menimpa orang yang salah: refund
 * menuntut penyetuju (`spec-b:278`), dan bila penyetujunya tidak sah,
 * `ACTOR_NOT_FOUND` memberi tahu manajer bahwa KASIR-nya yang tidak
 * ditemukan. Manajer itu sedang berdiri di kasir dengan pelanggan menunggu;
 * ia akan mencari masalah di tempat yang keliru.
 *
 * Alasan kedua, yang menentukan: selama pesannya sama, tidak ada test yang
 * dapat membedakan guard ini dari validasi yang dilakukan `recordAuditEvent`
 * beberapa langkah kemudian — sabotase membuktikannya, guard ini dimatikan
 * dan seluruh suite tetap hijau. Guard yang tidak dapat dibedakan adalah
 * guard yang tidak teruji.
 *
 * `refund.approved_by` adalah `text NOT NULL` TANPA FK
 * (`0007_ordering.sql:106`) — kelas yang sama dengan
 * `price_history.changed_by`. Ini satu-satunya yang berdiri di sana pada saat
 * baris `refund` ditulis.
 */
export async function assertApproverVisible(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query('SELECT id FROM "user" WHERE id = $1 AND is_active = true', [userId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'APPROVER_NOT_FOUND', `Penyetuju ${userId} tidak ditemukan atau tidak aktif.`);
  }
}

// T0c (PLAN-ordering-fondasi.md §T0c) -- guard BARU, sama alasan dengan
// assertOutletVisible/assertUserVisible di atas: modul cash BARU
// (cash_drawer_shift.device_id) menunjuk device(id) lintas modul (invariant
// #4, CLAUDE.md). FK PostgreSQL tidak tunduk RLS (temuan F1) -- device
// milik tenant lain hanya bisa ditolak lewat SELECT yang tunduk RLS di
// transaksi pemanggil, bukan lewat FK device_id REFERENCES device(id).
//
// `revoked_at IS NULL` disertakan -- sama seperti assertOutletVisible
// menyaring archived_at -- supaya shift baru tidak bisa dibuka atas nama
// device yang sudah dicabut. Tidak ada AC eksplisit yang menuntut ini,
// tapi membiarkan device tercabut membuka shift baru adalah cacat yang
// sama bentuknya dengan mengizinkan kategori terarsip jadi induk baru.
export async function assertDeviceVisible(client: PoolClient, deviceId: string): Promise<void> {
  const { rows } = await client.query('SELECT id FROM device WHERE id = $1 AND revoked_at IS NULL', [deviceId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'DEVICE_NOT_FOUND', `Device ${deviceId} tidak ditemukan atau sudah dicabut.`);
  }
}

/**
 * Menegakkan matriks hak akses `spec-f:38-53` untuk satu pengguna.
 *
 * ## ⛔ Batas yang harus dibaca bersama fungsi ini
 *
 * Perangkat kasir mengautentikasi diri sebagai **perangkat** (secret bearer,
 * FR-F12). `X-Actor-Id` dan `X-Approver-Id` adalah atribusi yang **dijamin
 * perangkat**, bukan identitas yang diverifikasi server — dan itu konsekuensi
 * langsung dari offline-first: order yang antre enam jam tidak dapat membawa
 * sesi hidup, dan `spec-f:118` sendiri menyebut PIN sebagai atribusi, bukan
 * otentikasi.
 *
 * Jadi fungsi ini TIDAK menahan perangkat yang di-root. Yang menahan itu
 * adalah token perangkat yang dapat dicabut.
 *
 * Yang ia lakukan tetap bernilai, dan tidak dapat dicapai dengan cara lain:
 * id yang disebut memang punya hak untuk operasi itu. Kasir tidak dapat
 * muncul sebagai penyetuju refund, apa pun yang dikirim perangkat — dan
 * sebelum ini, satu-satunya yang berdiri di sana adalah
 * `assertApproverVisible`, yang hanya membuktikan penyetujunya ada dan aktif.
 *
 * **Fail-closed dua kali:** pengguna tanpa peran ditolak, dan operasi yang
 * belum didaftarkan di matriks ditolak untuk semua orang (`bolehkah`).
 * "Belum diatur" tidak boleh berarti "boleh segalanya".
 */
export async function assertBoleh(
  client: PoolClient,
  userId: string,
  operasi: string,
  label = 'melakukan operasi ini'
): Promise<void> {
  if (!(await bolehkahAktor(client, userId, operasi))) {
    throw new HttpError(403, 'FORBIDDEN', `Pengguna ${userId} tidak berhak ${label}.`);
  }
}

/**
 * Bentuk `assertBoleh` yang MENJAWAB alih-alih melempar.
 *
 * ⛔ Ada karena sebagian aturan bukan "boleh atau ditolak" melainkan salah
 * satu dari beberapa jalan. Tutup shift misalnya: pemilik shift boleh, DAN
 * manajer boleh — memakai `assertBoleh` di sana akan menolak kasir yang
 * menutup shiftnya sendiri, yang justru jalur normalnya.
 *
 * ⛔ Keduanya berbagi SATU query dan SATU pemanggilan `bolehkah`. Menyalin
 * badannya akan membuat dua tempat memutuskan hal yang sama, dan yang satu
 * akan lupa `u.is_active = true` — pengguna nonaktif yang tetap berwenang
 * adalah kegagalan yang tidak terlihat sampai seseorang memakainya.
 */
export async function bolehkahAktor(
  client: PoolClient,
  userId: string,
  operasi: string
): Promise<boolean> {
  // SELECT tunduk RLS: peran milik pengguna tenant lain tidak terlihat, jadi
  // id lintas-tenant jatuh ke daftar kosong dan ditolak fail-closed.
  const { rows } = await client.query<{ role: string }>(
    `SELECT ur.role
       FROM user_role ur
       JOIN "user" u ON u.id = ur.user_id
      WHERE ur.user_id = $1 AND u.is_active = true`,
    [userId]
  );
  return bolehkah(rows.map((r) => r.role), operasi);
}

/**
 * Pemakaian kuota `max_users`.
 *
 * ⛔ Pengguna NONAKTIF tidak dihitung. Baris `"user"` tidak pernah dihapus —
 * menghapusnya memutus atribusi setiap audit event yang menunjuknya — jadi
 * menghitung seluruh baris membuat kuota menjadi penghitung seumur hidup yang
 * tidak dapat dipulihkan dengan cara apa pun yang tersedia bagi merchant.
 *
 * Satu fungsi, dua pemanggil: penegakan di `POST /users` dan tampilan di
 * `GET /tenants/usage`. Dua salinan akan menyimpang, dan gejalanya adalah
 * merchant yang melihat "1 dari 3" lalu ditolak karena kuota penuh.
 */
export async function hitungPengguna(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    'SELECT count(*) AS n FROM "user" WHERE is_active = true'
  );
  return Number(rows[0].n);
}

/**
 * Pemakaian kuota `max_devices`.
 *
 * ⛔ Perangkat yang sudah DICABUT tidak dihitung. `research/09` § 6 menulis
 * "jumlah device AKTIF", dan perilaku yang ditetapkannya saat kuota penuh
 * adalah "tolak; tawarkan mencabut device lama" — tawaran yang tidak
 * menyelesaikan apa pun kalau yang dicabut tetap dihitung.
 */
export async function hitungPerangkat(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    'SELECT count(*) AS n FROM device WHERE revoked_at IS NULL'
  );
  return Number(rows[0].n);
}

/**
 * Membuat pengguna owner PERTAMA sebuah tenant — dipakai pendaftaran mandiri
 * (`POST /tenants`, modul tenancy).
 *
 * ## Kenapa ia ada di sini dan bukan di modul tenancy
 *
 * Invariant #4: `"user"`, `user_role`, dan `user_outlet` milik modul identity
 * (`apps/server/src/modules/README.md`). Modul tenancy tidak boleh
 * menyentuhnya — pola yang sama persis dengan `recordAuditEvent` dan
 * `recordStockMovements`, yang lahir karena alasan itu juga.
 *
 * `client` WAJIB berasal dari transaksi pemanggil. Pendaftaran adalah satu
 * transaksi: tenant yang lahir tanpa owner **tidak dapat dimasuki siapa pun
 * selamanya**, karena setiap endpoint lain menuntut `X-Actor-Id` yang sah dan
 * tidak ada satu pun jalur pemulihan.
 *
 * ## Kenapa ia TIDAK memanggil `createUser`
 *
 * `createUser` memeriksa `assertBolehKelola(actorId, …)` — aktor yang berhak
 * mengelola peran yang diminta. Pada pendaftaran, aktor itu adalah pengguna
 * yang sedang dibuat baris ini. Melewatinya berarti menulis pengecualian ke
 * dalam RBAC, dan pengecualian di RBAC adalah lubang yang bentuknya persis
 * seperti fitur.
 *
 * ⛔ Peran owner ber-scope **tenant**, bukan outlet. Scope outlet membuat
 * owner tidak dapat membuat outlet kedua — ia terkunci di cabang pertamanya
 * sendiri, dan tidak ada orang lain yang dapat mengeluarkannya.
 */
export async function buatPemilikPertama(
  client: PoolClient,
  input: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    passwordHash: string;
    outletId: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO "user" (id, tenant_id, name, email, password_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.tenantId, input.name, input.email, input.passwordHash]
  );

  await client.query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, 'owner', 'tenant', $4)`,
    [randomUUID(), input.tenantId, input.id, input.tenantId]
  );

  // Owner ber-scope tenant tidak MEMBUTUHKAN baris outlet untuk haknya
  // (`0019_identity_outlet_pin.sql`), tapi ia membutuhkannya untuk terlihat
  // perangkat outlet pertama — jalur turun mengirim pengguna per outlet.
  await client.query(
    `INSERT INTO user_outlet (id, tenant_id, user_id, outlet_id) VALUES ($1, $2, $3, $4)`,
    [randomUUID(), input.tenantId, input.id, input.outletId]
  );
}

/**
 * Hasher yang dipakai lintas modul untuk password pendaftaran.
 *
 * Ia stateless; yang dijaga di sini adalah supaya parameter Argon2id-nya
 * tidak punya dua sumber. `buatPinHasher` membaca `ARGON2_PARAMS` dari
 * `packages/domain`, jadi bahkan instance kedua tidak dapat menyimpang —
 * tapi titik penggantiannya tetap tunggal.
 */
export function buatHasher() {
  return buatPinHasher();
}

/**
 * Permukaan kredensial perangkat, untuk modul lain yang endpoint-nya
 * dipanggil PERANGKAT dan bukan orang (telemetri F6, rilis F6).
 *
 * `device` milik modul ini (`modules/README.md`), jadi yang membutuhkannya
 * memanggil lewat sini alih-alih meng-query tabelnya sendiri (invariant #4).
 */
export {
  ambilBearer,
  ambilDevice,
  verifikasiPerangkat,
  type BarisDevice,
} from './kredensial-perangkat.ts';

/**
 * F6 — mencatat satu penundaan update, dan mengembalikan jumlahnya SETELAH
 * penambahan.
 *
 * ⛔ Penghitung direset saat versinya berganti, di query yang SAMA. Tanpa
 * itu, penundaan yang terkumpul untuk versi lama membuat versi berikutnya
 * wajib segera saat pertama kali muncul — merchant kehilangan hak menundanya
 * tanpa pernah memakainya.
 *
 * ⛔ Ia tidak memeriksa batas. Batasnya (`MAKS_TUNDA`) adalah aturan domain,
 * dan modul yang memutuskan memanggilnya lebih dulu; fungsi ini hanya
 * mencatat. Dua tempat yang memutuskan hal yang sama akan menyimpang.
 */
export async function catatPenundaanUpdate(
  client: PoolClient,
  deviceId: string,
  versi: string
): Promise<number> {
  const { rows } = await client.query<{ update_deferrals: number }>(
    `UPDATE device
        SET update_deferrals = CASE
              WHEN update_deferred_version IS DISTINCT FROM $2 THEN 1
              ELSE update_deferrals + 1
            END,
            update_deferred_version = $2
      WHERE id = $1
  RETURNING update_deferrals`,
    [deviceId, versi]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'DEVICE_NOT_FOUND', `Device ${deviceId} tidak ditemukan.`);
  }
  return rows[0].update_deferrals;
}

export function createIdentityHandlers(
  pool: Pool,
  konfigToken: KonfigToken,
  hlc: Hlc
): Record<string, unknown> {
  // Satu `PinHasher` per proses. Ia stateless, tapi dibuat di sini alih-alih
  // di dalam handler supaya titik penggantiannya tunggal -- sama seperti
  // adapter pembayaran dipilih sekali di `buildApp`.
  const hasher = buatPinHasher();
  return {
    ...createDeviceHandlers(pool),
    // F.5 — akses support. Ia di modul identity karena yang diberikan adalah
    // KREDENSIAL, dan `support_session.token_hash` bersaudara dengan
    // `user_session.token_hash` dan `device.token_hash`.
    ...createSupportHandlers(pool, hlc),
    ...createTokenHandlers(pool, konfigToken),
    ...createTelemetryHandlers(pool),
    ...createUserHandlers(pool, hasher, hlc),
    ...createAuthHandlers(pool, hasher),
  };
}
