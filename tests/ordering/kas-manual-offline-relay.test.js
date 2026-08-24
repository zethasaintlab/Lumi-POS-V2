'use strict';

// ⛔ Kas masuk/keluar yang dibuat OFFLINE, dikirim lewat transport relay yang
// SAMA dengan yang dipakai perangkat sungguhan.
//
// Aturan 21 Agustus 2026 (`CLAUDE.md`): *setiap operasi yang perangkat kirim
// lewat outbox wajib punya satu test yang memakai `buatPengirimHttp` dan
// `klasifikasi` yang ASLI*, dengan hanya `fetch` yang dipalsukan dan
// diteruskan ke server sungguhan.
//
// Aturan itu lahir dari cacat yang hidup berminggu-minggu di kode ter-merge:
// relay tidak pernah mengirim `X-Approver-Id`, jadi setiap refund offline
// berhenti `gagal-permanen` di antrean sementara kasir sudah mengembalikan
// uangnya. Delapan belas test void/refund hijau selama itu — semuanya
// memanggil endpoint LANGSUNG dengan header yang ditulis test itu sendiri.
//
// FR-D5 punya paparan yang sama persis, dan taruhannya identik: baris yang
// berhenti di antrean berarti server tetap menghitung uang yang sudah tidak
// ada di laci, dan tutup kas berikutnya menuduh kasirnya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatPengirimHttp } = require('../../packages/sync-client/src/http.ts');
const { klasifikasi } = require('../../packages/sync-client/src/klasifikasi.ts');

let owner, appSetup, app, tenant, base, device;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'RelayKas' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  await kueri(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, base.outlet.id]
  );
});

async function kueri(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await appSetup.query(sql, params);
    await appSetup.query('COMMIT');
    return rows;
  } catch (e) {
    await appSetup.query('ROLLBACK');
    throw e;
  }
}

async function shift({ status = 'open' } = {}) {
  const id = crypto.randomUUID();
  await kueri(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-24',$5,100000,$6)`,
    [id, tenant.id, base.outlet.id, device, status, base.user.id]
  );
  return id;
}

/** `fetch` yang meneruskan ke server sungguhan, apa adanya. */
function fetchKeServer(intip) {
  return async (url, opts) => {
    if (intip) intip(opts);
    const res = await app.inject({
      method: opts.method,
      url: new URL(url).pathname,
      payload: opts.body,
      headers: opts.headers,
    });
    return {
      status: res.statusCode,
      ok: res.statusCode >= 200 && res.statusCode < 300,
      async json() {
        return res.json();
      },
    };
  };
}

function relay(intip) {
  return buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: fetchKeServer(intip),
  });
}

/**
 * Baris `outbox_local` dalam bentuk yang PERSIS ditulis `catatKasManual`
 * (`apps/kasir/src/kas/manual.ts`).
 */
function barisOutbox(over = {}) {
  return {
    id: crypto.randomUUID(),
    entity_type: 'cash_movement',
    entity_id: over.entity_id,
    operation: 'create',
    payload: JSON.stringify({
      id: crypto.randomUUID(),
      arah: 'keluar',
      jumlah: '50000',
      reasonCode: 'bayar_pemasok',
      reasonNote: null,
      hlc: '1',
      occurredAt: new Date().toISOString(),
      ...over.payloadOver,
    }),
    idempotency_key: crypto.randomUUID(),
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: new Date().toISOString(),
    depends_on: null,
    actor_id: base.user.id,
    approver_id: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------

test('⛔ kas keluar offline MENDARAT di server lewat relay yang sungguhan', async () => {
  const shiftId = await shift();
  const baris = barisOutbox({ entity_id: shiftId });
  const muatan = JSON.parse(baris.payload);

  const hasil = await relay()(baris);
  assert.equal(hasil.status, 201, JSON.stringify(hasil));

  // ⛔ Dibuktikan dari BARIS DATABASE, bukan dari status 2xx. Endpoint yang
  // menjawab 201 tanpa menulis apa pun akan lulus assertion di atas.
  const [row] = await kueri(
    'SELECT type, delta, counterpart_type, shift_id FROM cash_movement WHERE id = $1',
    [muatan.id]
  );
  assert.ok(row, 'baris tidak mendarat di server');
  assert.equal(row.type, 'paid_out');
  assert.equal(String(row.delta), '-50000');
  assert.equal(row.counterpart_type, 'expense');
  assert.equal(row.shift_id, shiftId);
});

test('⛔ kas masuk offline mendarat dengan delta POSITIF', async () => {
  const shiftId = await shift();
  const baris = barisOutbox({
    entity_id: shiftId,
    payloadOver: { arah: 'masuk', reasonCode: 'tambah_modal', jumlah: '250000' },
  });
  const muatan = JSON.parse(baris.payload);

  const hasil = await relay()(baris);
  assert.equal(hasil.status, 201, JSON.stringify(hasil));

  const [row] = await kueri('SELECT type, delta FROM cash_movement WHERE id = $1', [muatan.id]);
  assert.equal(row.type, 'paid_in');
  assert.equal(String(row.delta), '250000');
});

test('⛔ relay menyusun header yang endpoint ini BUTUHKAN — tanpa yang hilang', async () => {
  // Inti pelajaran 21 Agustus. Header yang tidak pernah disusun
  // `buatPengirimHttp` tidak dapat hilang dari test yang menuliskan headernya
  // sendiri; di sini yang menyusunnya adalah kode produksi.
  const shiftId = await shift();
  let dikirim = null;
  await relay((opts) => {
    dikirim = opts.headers;
  })(barisOutbox({ entity_id: shiftId }));

  assert.equal(dikirim['X-Tenant-Id'], tenant.id);
  assert.ok(dikirim['Idempotency-Key'], 'Idempotency-Key tidak disusun relay');
  assert.equal(dikirim['X-Actor-Id'], base.user.id);
});

test('⛔ retry relay dengan baris yang SAMA tidak menggandakan uang laci', async () => {
  // Respons yang hilang adalah kejadian normal di jalur ini — perangkat
  // mengirim, jaringan putus sebelum jawabannya sampai, penjadwal mencoba
  // lagi. Yang melindunginya `idempotency_key` milik BARIS, dan barisnya
  // dikirim ulang apa adanya.
  const shiftId = await shift();
  const baris = barisOutbox({ entity_id: shiftId });

  const pertama = await relay()(baris);
  const kedua = await relay()(baris);
  assert.equal(pertama.status, 201);
  assert.equal(kedua.status, 201, 'respons ASLI dikembalikan apa adanya');

  const rows = await kueri('SELECT id FROM cash_movement WHERE shift_id = $1', [shiftId]);
  assert.equal(rows.length, 1);
});

test('shift yang sudah ditutup: 409, dan `klasifikasi` TIDAK menebaknya terkirim', async () => {
  // ⛔ `klasifikasi` yang SUNGGUHAN, dan jawabannya `coba-lagi` — bukan
  // `gagal-permanen`, dan itu disengaja. Aturannya: 409 berkode tak dikenal
  // tidak pernah ditebak `terkirim`, karena menghapus baris dari antrean
  // berdasarkan kata yang tidak dimengerti adalah kehilangan catatan uang.
  //
  // Konsekuensinya dinyatakan, bukan didiamkan: shift tertutup tidak akan
  // pernah terbuka lagi, jadi percobaannya habis di batas backoff dan barisnya
  // mendarat di daftar gagal K-14 — tempat seorang manusia melihatnya. Itu
  // hasil yang BENAR untuk uang yang sudah berpindah: terlihat, bukan hilang
  // diam-diam.
  const shiftId = await shift({ status: 'closed' });
  const hasil = await relay()(barisOutbox({ entity_id: shiftId }));
  assert.equal(hasil.status, 409);
  assert.notEqual(klasifikasi(hasil), 'terkirim');

  const rows = await kueri('SELECT id FROM cash_movement WHERE shift_id = $1', [shiftId]);
  assert.equal(rows.length, 0, 'server tidak menulis apa pun ke shift yang tertutup');
});

test('muatan yang ditolak domain diklasifikasi gagal-permanen, bukan diulang selamanya', async () => {
  const shiftId = await shift();
  const hasil = await relay()(
    barisOutbox({ entity_id: shiftId, payloadOver: { jumlah: '0' } })
  );
  assert.equal(hasil.status, 400);
  assert.equal(klasifikasi(hasil), 'gagal-permanen');
});

test('server mati diklasifikasi dapat-diulang — uangnya tidak boleh hilang dari antrean', async () => {
  const shiftId = await shift();
  const kirim = buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: async () => {
      throw new Error('gagal menyambung');
    },
  });
  const hasil = await kirim(barisOutbox({ entity_id: shiftId }));
  assert.notEqual(klasifikasi(hasil), 'gagal-permanen');
});
