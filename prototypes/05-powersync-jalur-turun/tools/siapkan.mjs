// Menyiapkan container pg-db supaya PowerSync punya sesuatu untuk direplikasi.
//
// Tiga langkah, dan urutannya penting:
//   1. migrasi 0001-0018 -- SKEMA SUNGGUHAN, bukan tiruan. Prototipe yang
//      menguji skema mainan tidak menguji apa pun.
//   2. GRANT + PUBLICATION -- keduanya harus setelah tabelnya ada.
//   3. seed DUA tenant, supaya isolasi jalur turun dapat diuji sama sekali.
//      Satu tenant membuat T4 mustahil dibedakan dari "sync memang jalan".
//
// Dijalankan ulang berkali-kali aman: seluruhnya idempoten.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const URL_OWNER = 'postgres://lumi_owner:lumi_owner@localhost:5433/lumi';
const URL_APP = 'postgres://lumi_app:lumi_app@localhost:5433/lumi';

// Ketujuh tabel katalog. Sengaja BUKAN `FOR ALL TABLES` -- lihat
// init/02-powersync-role.sql.
const TABEL_KATALOG = [
  'category',
  'item',
  'item_variation',
  'modifier_list',
  'modifier',
  'item_modifier_list',
  'tax_rate',
];

export const TENANTS = {
  A: { id: 'tenant-alpha', nama: 'Kopi Alpha', item: 'Kopi Susu Alpha', modifier: 'Gula Alpha' },
  B: { id: 'tenant-beta', nama: 'Kopi Beta', item: 'Kopi Susu Beta', modifier: 'Gula Beta' },
};

function jalankanMigrasi() {
  const hasil = spawnSync(
    process.execPath,
    ['db/migrate.js'],
    {
      cwd: AKAR,
      env: { ...process.env, DATABASE_MIGRATION_URL: URL_OWNER },
      encoding: 'utf8',
    }
  );
  if (hasil.status !== 0) {
    throw new Error(`migrasi gagal:\n${hasil.stdout ?? ''}\n${hasil.stderr ?? ''}`);
  }
  const baris = (hasil.stdout ?? '').trim().split('\n');
  const diterapkan = baris.filter((b) => b.startsWith('apply')).length;
  return { total: baris.length, diterapkan };
}

async function seedTenant(client, t) {
  // `tenant` RLS-exempt; sisanya tidak. Owner pun tunduk FORCE ROW LEVEL
  // SECURITY, jadi app.tenant_id harus di-set sebelum menyentuh tabel mana pun
  // di bawahnya.
  await client.query(
    `INSERT INTO tenant (id, name, plan, status, deployment_mode)
     VALUES ($1, $2, 'standard', 'active', 'cloud')
     ON CONFLICT (id) DO NOTHING`,
    [t.id, t.nama]
  );
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [t.id]);

  const id = (suffix) => `${t.id}-${suffix}`;

  await client.query(
    `INSERT INTO category (id, tenant_id, name) VALUES ($1, $2, 'Minuman')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id('cat'), t.id]
  );
  await client.query(
    `INSERT INTO item (id, tenant_id, name, category_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id('item'), t.id, t.item, id('cat')]
  );
  await client.query(
    `INSERT INTO item_variation (id, tenant_id, item_id, name, price, cost)
     VALUES ($1, $2, $3, 'Regular', 20000, 8000)
     ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price`,
    [id('var'), t.id, id('item')]
  );
  await client.query(
    `INSERT INTO modifier_list (id, tenant_id, name, selection_type)
     VALUES ($1, $2, $3, 'single')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id('ml'), t.id, t.modifier]
  );
  await client.query(
    `INSERT INTO modifier (id, tenant_id, modifier_list_id, name, price)
     VALUES ($1, $2, $3, 'Normal', 0)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id('mod'), t.id, id('ml')]
  );
  // Inilah tabel yang menuntut migrasi 0018. Tanpa kolom `id` ia tidak dapat
  // menjadi raw table, dan relasi item<->modifier tidak pernah sampai ke
  // perangkat.
  await client.query(
    `INSERT INTO item_modifier_list (id, tenant_id, item_id, modifier_list_id, sort_order)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT ON CONSTRAINT ux_item_modifier_list_pair DO UPDATE SET sort_order = 0`,
    [id('iml'), t.id, id('item'), id('ml')]
  );
  // Tarif pajak, dan sengaja LEBIH DARI SATU.
  //
  // `tax_rate.rate` adalah `numeric(6,4)` di PostgreSQL tapi `INTEGER` di
  // skema lokal, dengan konvensi ×10000 (11% -> 1100). Satu nilai saja tidak
  // cukup untuk melihat apakah konversinya benar: 0.1100 bisa lolos karena
  // kebetulan, sementara 0.1075 (empat desimal signifikan) dan 0.0825
  // memperlihatkan pembulatan yang merusak. Ini jalur uang — pembulatan yang
  // salah di sini mengubah pajak setiap transaksi.
  const tarif = [
    ['tax', 'PPN 11%', 0.11],
    ['tax-1075', 'PBJT 10,75%', 0.1075],
    ['tax-0825', 'Uji 8,25%', 0.0825],
    ['tax-0001', 'Uji 0,01%', 0.0001],
  ];
  for (const [suffix, nama, nilai] of tarif) {
    await client.query(
      `INSERT INTO tax_rate (id, tenant_id, name, type, rate, is_inclusive, effective_from)
       VALUES ($1, $2, $3, 'ppn', $4, true, now())
       ON CONFLICT (id) DO UPDATE SET rate = EXCLUDED.rate, name = EXCLUDED.name`,
      [id(suffix), t.id, nama, nilai]
    );
  }
}

async function main() {
  const langkah = [];

  langkah.push(['migrasi', JSON.stringify(jalankanMigrasi())]);

  const owner = new pg.Client(URL_OWNER);
  await owner.connect();

  // GRANT diulang di sini karena ALTER DEFAULT PRIVILEGES di init hanya
  // berlaku untuk tabel yang dibuat SETELAHnya. Tabel yang lahir dari migrasi
  // pertama kali tidak tercakup bila urutannya bergeser -- diulang eksplisit
  // supaya tidak bergantung pada urutan itu.
  await owner.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role');

  const { rows: adaPub } = await owner.query(
    `SELECT 1 FROM pg_publication WHERE pubname = 'powersync'`
  );
  if (adaPub.length === 0) {
    const daftar = TABEL_KATALOG.map((t) => `"${t}"`).join(', ');
    await owner.query(`CREATE PUBLICATION powersync FOR TABLE ${daftar}`);
    langkah.push(['publication', `dibuat untuk ${TABEL_KATALOG.length} tabel katalog`]);
  } else {
    langkah.push(['publication', 'sudah ada']);
  }

  for (const t of Object.values(TENANTS)) {
    await seedTenant(owner, t);
  }
  langkah.push(['seed', Object.values(TENANTS).map((t) => t.id).join(', ')]);

  // Bukti bahwa seed benar-benar tersimpan, dibaca ulang per tenant.
  for (const t of Object.values(TENANTS)) {
    await owner.query(`SELECT set_config('app.tenant_id', $1, false)`, [t.id]);
    const jumlah = {};
    for (const tabel of TABEL_KATALOG) {
      const { rows } = await owner.query(`SELECT count(*)::int AS n FROM "${tabel}"`);
      jumlah[tabel] = rows[0].n;
    }
    langkah.push([`baris ${t.id}`, JSON.stringify(jumlah)]);
  }

  await owner.end();

  for (const [k, v] of langkah) console.log(`${k.padEnd(22)} ${v}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
