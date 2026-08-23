'use strict';

// B-22 — `GET /audit-events`, pembacaan audit trail. FR-F6, FR-F7.
//
// ⛔ Yang paling menentukan di berkas ini adalah PAGINASI. `CLAUDE.md` menetapkan
// keyset untuk riwayat transaksi karena perangkat offline menyisipkan baris
// ber-tanggal historis di tengah urutan; audit trail punya paparan yang sama
// dan taruhan yang lebih besar — baris audit yang terlewat tidak meninggalkan
// lubang yang terlihat siapa pun.
//
// Karena itu test paginasi di sini tidak memeriksa "halaman kedua ada", ia
// memeriksa bahwa MENYUSURI seluruh halaman mengembalikan setiap baris tepat
// satu kali, termasuk saat banyak baris berbagi timestamp yang sama persis.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

const MOD = '../../apps/server/src/modules/reporting/handlers/audit.ts';
const DOMAIN = '../../packages/domain/src/audit-peristiwa.ts';

let owner, appSetup, base, tenant, device, manajer;
let n = 0;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
});

beforeEach(async () => {
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'AuditB22' });
  tenant = base.tenant;
  device = crypto.randomUUID();
  manajer = crypto.randomUUID();
  n = 0;

  await tx(async () => {
    await appSetup.query(
      `INSERT INTO device (id,tenant_id,outlet_id,code,name,platform,app_version,schema_version)
       VALUES ($1,$2,$3,'K1','Kasir 1','tauri','0','1')`,
      [device, tenant.id, base.outlet.id]
    );
    await appSetup.query(`INSERT INTO "user" (id,tenant_id,name) VALUES ($1,$2,'Rina Manajer')`, [
      manajer,
      tenant.id,
    ]);
  });
});

async function tx(fn) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await fn();
  await appSetup.query('COMMIT');
  return hasil;
}

async function audit({
  eventType = 'order.voided',
  entityId = null,
  aktor = base.user.id,
  penyetuju = null,
  reason = null,
  occurredAt = '2026-08-10T10:00:00Z',
  outletId = undefined,
  deviceId = undefined,
} = {}) {
  n += 1;
  const id = crypto.randomUUID();
  await tx(async () => {
    await appSetup.query(
      `INSERT INTO audit_event (id,tenant_id,outlet_id,device_id,actor_user_id,approver_user_id,
         event_type,entity_type,entity_id,reason_code,occurred_at,hlc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'order',$8,$9,$10::timestamptz,$11::bigint)`,
      [
        id,
        tenant.id,
        outletId === undefined ? base.outlet.id : outletId,
        deviceId === undefined ? device : deviceId,
        aktor,
        penyetuju,
        eventType,
        entityId,
        reason,
        occurredAt,
        n,
      ]
    );
  });
  return id;
}

const SAringanDasar = {
  from: '2026-08-01',
  to: '2026-08-31',
  outletId: null,
  eventType: null,
  actorUserId: null,
  entityId: null,
  kursor: null,
  batas: 50,
};

async function baca(ubah = {}) {
  const { ambilAudit } = await import(MOD);
  return tx(() => ambilAudit(appSetup, { ...SAringanDasar, ...ubah }));
}

// ---------------------------------------------------------------------------
// Isi baris
// ---------------------------------------------------------------------------

test('baris audit membawa DUA identitas, dan nama keduanya', async () => {
  // FR-F7: "mencatat hanya satu identitas membuat audit trail tidak berguna."
  await audit({ eventType: 'order.refunded', aktor: base.user.id, penyetuju: manajer });

  const { peristiwa } = await baca();
  assert.equal(peristiwa.length, 1);
  assert.equal(peristiwa[0].aktorId, base.user.id);
  assert.equal(peristiwa[0].penyetujuId, manajer);
  assert.equal(peristiwa[0].penyetujuNama, 'Rina Manajer');
});

test('⛔ penyetuju NULL tetap null, tidak dijadikan nama aktor', async () => {
  // Void berjalan tanpa penyetuju sejak keputusan 1 Agustus 2026. Mengisi
  // kolomnya dengan aktor membuat trail berkata seseorang menyetujui
  // tindakannya sendiri — persis yang CHECK di database larang.
  await audit({ eventType: 'order.voided' });
  const { peristiwa } = await baca();
  assert.equal(peristiwa[0].penyetujuId, null);
  assert.equal(peristiwa[0].penyetujuNama, null);
});

test('kelompok peristiwa diturunkan dari domain, dan nama asing berkelompok null', async () => {
  // Baris lama dapat memuat nama yang sudah tidak dipancarkan siapa pun —
  // `audit_event` tidak pernah di-UPDATE (invariant #2). Menaruhnya di
  // kelompok bawaan membuat saringan kelompok menyembunyikannya.
  await audit({ eventType: 'order.voided' });
  await tx(async () => {
    await appSetup.query(
      `INSERT INTO audit_event (id,tenant_id,outlet_id,actor_user_id,event_type,occurred_at,hlc)
       VALUES ($1,$2,$3,$4,'peristiwa_lama_2025','2026-08-10T09:00:00Z',999)`,
      [crypto.randomUUID(), tenant.id, base.outlet.id, base.user.id]
    );
  });

  const { peristiwa } = await baca();
  const peta = Object.fromEntries(peristiwa.map((p) => [p.eventType, p.kelompok]));
  assert.equal(peta['order.voided'], 'transaksi');
  assert.equal(peta['peristiwa_lama_2025'], null);
});

test('⛔ `before`/`after` TIDAK dikembalikan', async () => {
  // Keduanya muatan bebas; pada `item_updated` ia akan memuat `cost`, dan
  // FR-F5 melarang HPP sampai ke mata yang tidak berhak. Bahwa peran yang
  // boleh membuka layar ini kebetulan sama dengan yang boleh melihat margin
  // bukan penjaga.
  await audit({ eventType: 'discount_applied' });
  const { peristiwa } = await baca();
  assert.equal('before' in peristiwa[0], false);
  assert.equal('after' in peristiwa[0], false);
});

// ---------------------------------------------------------------------------
// ⛔ Paginasi keyset
// ---------------------------------------------------------------------------

test('⛔ menyusuri seluruh halaman mengembalikan setiap baris TEPAT SATU KALI', async () => {
  const dibuat = [];
  for (let i = 0; i < 25; i += 1) {
    dibuat.push(
      await audit({ occurredAt: `2026-08-10T${String(10 + (i % 5)).padStart(2, '0')}:00:00Z` })
    );
  }

  const terlihat = [];
  let kursor = null;
  let putaran = 0;
  do {
    const halaman = await baca({ batas: 7, kursor });
    terlihat.push(...halaman.peristiwa.map((p) => p.id));
    kursor = halaman.kursorBerikut;
    putaran += 1;
    assert.ok(putaran < 20, 'paginasi tidak pernah berhenti');
  } while (kursor !== null);

  assert.equal(terlihat.length, 25, 'jumlah baris berubah saat disusuri');
  assert.equal(new Set(terlihat).size, 25, 'ada baris yang muncul dua kali');
  assert.deepEqual([...terlihat].sort(), [...dibuat].sort());
});

test('⛔ baris ber-timestamp IDENTIK tidak saling melewati', async () => {
  // Lima peristiwa pada detik yang sama persis adalah keadaan normal: satu
  // penjualan menulis beberapa baris audit dalam satu transaksi. Kursor yang
  // hanya membandingkan waktu akan melewati empat di antaranya.
  for (let i = 0; i < 5; i += 1) await audit({ occurredAt: '2026-08-10T10:00:00Z' });

  const terlihat = [];
  let kursor = null;
  do {
    const halaman = await baca({ batas: 2, kursor });
    terlihat.push(...halaman.peristiwa.map((p) => p.id));
    kursor = halaman.kursorBerikut;
  } while (kursor !== null);

  assert.equal(new Set(terlihat).size, 5, JSON.stringify(terlihat));
});

test('⛔ halaman terakhir yang PAS penuh tidak menghasilkan kursor', async () => {
  // Server mengambil satu baris lebih banyak daripada yang diminta justru
  // untuk ini: kursor yang selalu ada membuat layar menampilkan tombol yang
  // membuka halaman kosong.
  for (let i = 0; i < 4; i += 1) await audit();
  const halaman = await baca({ batas: 4 });
  assert.equal(halaman.peristiwa.length, 4);
  assert.equal(halaman.kursorBerikut, null);
});

test('terbaru lebih dulu', async () => {
  await audit({ occurredAt: '2026-08-10T08:00:00Z' });
  const baru = await audit({ occurredAt: '2026-08-10T20:00:00Z' });
  const { peristiwa } = await baca();
  assert.equal(peristiwa[0].id, baru);
});

test('kursor cacat DITOLAK, bukan diabaikan diam-diam', async () => {
  // Kursor yang diabaikan mengembalikan halaman pertama lagi — penyusuran
  // yang tidak pernah maju dan tidak pernah terlihat gagal.
  const { uraikanKursor } = await import(MOD);
  for (const buruk of ['', 'tanpa-pemisah', '|abc', '2026-08-10T10:00:00Z|', 'bukan-tanggal|abc']) {
    assert.throws(() => uraikanKursor(buruk), /INVALID_CURSOR|Kursor/, `diterima: ${buruk}`);
  }
});

// ---------------------------------------------------------------------------
// Saringan
// ---------------------------------------------------------------------------

test('saringan jenis, aktor, dan objek masing-masing menyempitkan', async () => {
  const orderId = crypto.randomUUID();
  await audit({ eventType: 'order.voided', entityId: orderId });
  await audit({ eventType: 'discount_applied', entityId: orderId });
  await audit({ eventType: 'order.voided', aktor: manajer });

  assert.equal((await baca({ eventType: 'order.voided' })).peristiwa.length, 2);
  assert.equal((await baca({ actorUserId: manajer })).peristiwa.length, 1);
  assert.equal((await baca({ entityId: orderId })).peristiwa.length, 2);
});

test('⛔ jenis peristiwa ASING ditolak, bukan dijawab nol baris', async () => {
  // Nol baris terlihat persis seperti "tidak ada yang melakukannya".
  const { bacaJenis } = await import(MOD);
  assert.throws(() => bacaJenis('order_voided'), /UNKNOWN_EVENT_TYPE|tidak dikenal/);
  assert.equal(bacaJenis('order.voided'), 'order.voided');
  assert.equal(bacaJenis(''), null);
  assert.equal(bacaJenis(undefined), null);
});

test('batas halaman DIJEPIT, bukan ditolak', async () => {
  const { bacaBatas, BATAS_MAKS, BATAS_BAWAAN } = await import(MOD);
  assert.equal(bacaBatas(undefined), BATAS_BAWAAN);
  assert.equal(bacaBatas('1000'), BATAS_MAKS);
  assert.equal(bacaBatas('10'), 10);
  assert.throws(() => bacaBatas('0'), /VALIDATION_ERROR|bulat/);
  assert.throws(() => bacaBatas('abc'), /VALIDATION_ERROR|bulat/);
});

test('rentang memakai occurred_at, bukan tanggal bisnis sebuah order', async () => {
  await audit({ occurredAt: '2026-07-31T23:00:00Z' });
  await audit({ occurredAt: '2026-08-01T00:30:00Z' });
  const hasil = await baca({ from: '2026-08-01', to: '2026-08-01' });
  assert.equal(hasil.peristiwa.length, 1);
});

test('peristiwa TANPA outlet tetap terlihat saat outlet tidak disaring', async () => {
  // `tenant_registered` dan `user_created` tidak menempel pada outlet mana
  // pun. Menyaringnya keluar dari pandangan bawaan membuat pendaftaran
  // pengguna tidak pernah muncul di trail.
  await audit({ eventType: 'user_created', outletId: null, deviceId: null });
  assert.equal((await baca()).peristiwa.length, 1);
  assert.equal((await baca({ outletId: base.outlet.id })).peristiwa.length, 0);
});

// ---------------------------------------------------------------------------
// ⛔ Kosakata
// ---------------------------------------------------------------------------

test('⛔ SETIAP eventType yang server pancarkan ada di daftar tertutup domain', async () => {
  // Penjaga sesungguhnya adalah TypeScript: `recordAuditEvent` menerima
  // `PeristiwaAudit`, jadi nama yang tidak terdaftar gagal saat typecheck.
  // Test ini menjaga arah sebaliknya — daftar yang memuat nama yang tidak
  // seorang pun pancarkan membuat saringan di layar menawarkan pilihan yang
  // selalu kosong.
  const { readFileSync, readdirSync, statSync } = require('node:fs');
  const { join } = require('node:path');
  const { KUNCI_PERISTIWA } = await import(DOMAIN);

  // ⛔ `packages/domain` ikut dipindai. `cash_drawer_opened` hanya muncul
  // sebagai `EVENT_NO_SALE` di sisi server; namanya hidup di domain, dan
  // konstanta yang dipakai bersama klien adalah cara yang BENAR menuliskannya.
  const akar = [
    join(__dirname, '..', '..', 'apps', 'server', 'src'),
    join(__dirname, '..', '..', 'packages', 'domain', 'src'),
  ];
  const berkas = [];
  const telusuri = (dir) => {
    for (const nama of readdirSync(dir)) {
      const p = join(dir, nama);
      if (statSync(p).isDirectory()) telusuri(p);
      else if (p.endsWith('.ts')) berkas.push(p);
    }
  };
  for (const a of akar) telusuri(a);
  const seluruh = berkas
    .filter((p) => !p.endsWith('audit-peristiwa.ts'))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');

  // ⛔ `audit-peristiwa.ts` sendiri DIKECUALIKAN — ia mendaftar, tidak
  // memancarkan. Menyertakannya membuat penjaga ini selalu hijau.
  const tanpaPemakai = KUNCI_PERISTIWA.filter((k) => !seluruh.includes(`'${k}'`));
  assert.deepEqual(tanpaPemakai, [], `terdaftar tapi tidak dipancarkan: ${tanpaPemakai.join(', ')}`);
});

test('⛔ jarak ke FR-F6 DITURUNKAN, bukan ditulis tangan', async () => {
  // FR-F6 AC pertama: "setiap event dalam daftar menghasilkan record". Trail
  // berlubang yang terlihat lengkap adalah bentuk paling berbahaya dari trail
  // yang tidak lengkap.
  const { PERISTIWA_BELUM_DIPANCARKAN, adalahPeristiwaAudit, PETA_EJAAN_SPEC } = await import(
    DOMAIN
  );
  // Tidak ada satu pun yang sebenarnya SUDAH dipancarkan.
  for (const nama of PERISTIWA_BELUM_DIPANCARKAN) {
    assert.equal(
      adalahPeristiwaAudit(PETA_EJAAN_SPEC[nama] ?? nama),
      false,
      `${nama} sudah dipancarkan tapi masih terdaftar sebagai belum`
    );
  }
  // Dan ejaan yang berbeda TIDAK dihitung sebagai lubang.
  assert.equal(PERISTIWA_BELUM_DIPANCARKAN.includes('order_voided'), false);
  assert.equal(PERISTIWA_BELUM_DIPANCARKAN.includes('order_refunded'), false);
  // Yang benar-benar belum ada tetap disebut.
  assert.equal(PERISTIWA_BELUM_DIPANCARKAN.includes('shift_opened'), true);
  assert.equal(PERISTIWA_BELUM_DIPANCARKAN.includes('price_changed'), true);
});
