/**
 * Alat operator — feature flag dan kill switch. `ARCH:358`, KEP-36.
 *
 * Jalankan:
 *   node --env-file=.env tools/kill-switch.mjs --daftar
 *   node --env-file=.env tools/kill-switch.mjs --status [--tenant=<uuid>]
 *   node --env-file=.env tools/kill-switch.mjs <kunci> off \
 *     --alasan="dugaan fraud tiket #123" [--tenant=<uuid>] [--kering]
 *   node --env-file=.env tools/kill-switch.mjs <kunci> bawaan [--tenant=<uuid>]
 *
 * `off` / `on` menulis penyimpangan; `bawaan` MENGHAPUS barisnya sehingga
 * fitur kembali mengikuti bawaan kode.
 *
 * ## Kenapa alat, bukan endpoint
 *
 * Alasan yang sama persis dengan `naikkan-tahap.mjs`: mematikan fitur adalah
 * tindakan OPERATOR kami, bukan tindakan merchant. Seluruh peran di `spec-f`
 * adalah peran merchant, dan endpoint operator menuntut permukaan otentikasi
 * staf yang tidak ada di sistem ini.
 *
 * ⛔ Dan di sini ada alasan kedua yang lebih keras: merchant tidak boleh dapat
 * menyalakan kembali fitur yang kami matikan untuknya. Endpoint apa pun yang
 * dipanggil dari back-office merchant akan menjadi jalan itu.
 *
 * ## ⛔ Daftar fitur DIBACA dari domain, tidak pernah disalin
 *
 * Alat yang punya daftarnya sendiri akan menyimpang, dan yang menyimpang
 * menulis baris ber-kunci yang tidak pernah cocok saat resolusi — kill switch
 * yang terlihat aktif di alat dan tidak mematikan apa pun di lapangan. Ada
 * test yang menolak kunci yang disalin ke berkas ini.
 *
 * ## ⛔ `--alasan` WAJIB saat mematikan
 *
 * Kill switch dinyalakan saat insiden dan dilupakan sesudahnya. Baris tanpa
 * alasan adalah fitur yang mati berbulan-bulan tanpa ada yang tahu kenapa —
 * dan yang menemukannya adalah merchant yang menelepon karena tombolnya
 * hilang.
 */

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { FITUR, adalahKunciFitur, bawaanFitur } from '../packages/domain/src/fitur.ts';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

function argumen(argv) {
  const posisi = [];
  const opsi = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      opsi[k] = v === undefined ? true : v;
    } else {
      posisi.push(a);
    }
  }
  return { posisi, opsi };
}

function cetakDaftar() {
  console.log('Fitur yang dapat dimatikan (packages/domain/src/fitur.ts):\n');
  for (const f of FITUR) {
    console.log(`  ${f.kunci}  [bawaan: ${f.bawaan ? 'menyala' : 'mati'}]`);
    console.log(`    ${f.keterangan}\n`);
  }
}

async function cetakStatus(db, tenantId) {
  const { rows } = await db.query(
    `SELECT key, tenant_id, enabled, reason, updated_at, updated_by
       FROM feature_flag
      WHERE ($1::uuid IS NULL AND tenant_id IS NULL)
         OR ($1::uuid IS NOT NULL AND (tenant_id IS NULL OR tenant_id = $1))
      ORDER BY key, tenant_id NULLS FIRST`,
    [tenantId]
  );

  console.log(tenantId ? `Penyimpangan untuk tenant ${tenantId} (+ global):` : 'Penyimpangan GLOBAL:');
  if (rows.length === 0) {
    console.log('  (tidak ada — seluruh fitur mengikuti bawaan kode)');
    return;
  }
  for (const r of rows) {
    const lingkup = r.tenant_id === null ? 'GLOBAL' : r.tenant_id;
    const dikenal = adalahKunciFitur(r.key) ? '' : '  ⚠ kunci TIDAK DIKENAL — dibaca MATI';
    console.log(
      `  ${r.key}  ${r.enabled ? 'menyala' : 'MATI'}  [${lingkup}]  ` +
        `${r.updated_at.toISOString?.() ?? r.updated_at} oleh ${r.updated_by}${dikenal}`
    );
    if (r.reason) console.log(`    alasan: ${r.reason}`);
  }
}

async function utama() {
  const { posisi, opsi } = argumen(process.argv.slice(2));

  if (opsi.daftar) {
    cetakDaftar();
    return;
  }

  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error('DATABASE_MIGRATION_URL belum diatur.');
    process.exit(2);
  }

  const tenantId = typeof opsi.tenant === 'string' ? opsi.tenant : null;
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    if (opsi.status || posisi.length === 0) {
      await cetakStatus(db, tenantId);
      if (posisi.length === 0 && !opsi.status) {
        console.error(
          '\nPakai: kill-switch.mjs <kunci> <off|on|bawaan> [--tenant=<uuid>] [--alasan="..."]\n' +
            '       kill-switch.mjs --daftar'
        );
        process.exit(2);
      }
      return;
    }

    const [kunci, aksi] = posisi;
    if (!adalahKunciFitur(kunci)) {
      console.error(`Fitur "${kunci}" tidak dikenal. Jalankan --daftar untuk melihat pilihannya.`);
      process.exit(2);
    }
    if (!['off', 'on', 'bawaan'].includes(aksi)) {
      console.error(`Aksi harus off, on, atau bawaan — bukan "${aksi}".`);
      process.exit(2);
    }

    const lingkup = tenantId === null ? 'GLOBAL (seluruh merchant)' : `tenant ${tenantId}`;

    if (aksi === 'bawaan') {
      console.log(`${kunci} → kembali ke bawaan kode (${bawaanFitur(kunci) ? 'menyala' : 'mati'}) untuk ${lingkup}`);
      if (opsi.kering) {
        console.log('--kering: tidak ada yang ditulis.');
        return;
      }
      const { rowCount } = await db.query(
        `DELETE FROM feature_flag
          WHERE key = $1 AND tenant_id IS NOT DISTINCT FROM $2::uuid`,
        [kunci, tenantId]
      );
      console.log(rowCount === 0 ? 'Tidak ada baris — memang sudah bawaan.' : 'Baris dihapus.');
      return;
    }

    const aktif = aksi === 'on';
    const alasan = typeof opsi.alasan === 'string' ? opsi.alasan.trim() : '';
    // ⛔ Wajib saat MEMATIKAN. Menyalakan kembali tidak menuntutnya: yang
    // perlu dijelaskan adalah kenapa sesuatu mati, bukan kenapa ia normal.
    if (!aktif && alasan.length < 10) {
      console.error(
        'Mematikan fitur menuntut --alasan (minimal 10 karakter).\n' +
          'Kill switch dinyalakan saat insiden dan dilupakan sesudahnya; baris tanpa alasan ' +
          'adalah fitur yang mati berbulan-bulan tanpa ada yang tahu kenapa.'
      );
      process.exit(2);
    }

    const oleh = typeof opsi.oleh === 'string' ? opsi.oleh : (process.env.USER ?? 'operator');
    console.log(`${kunci} → ${aktif ? 'MENYALA' : 'MATI'} untuk ${lingkup}`);
    if (alasan) console.log(`  alasan: ${alasan}`);
    console.log(`  oleh  : ${oleh}`);
    if (opsi.kering) {
      console.log('--kering: tidak ada yang ditulis.');
      return;
    }

    // ⛔ `IS NOT DISTINCT FROM` di WHERE, bukan `= $2`. NULL tidak sama dengan
    // NULL di PostgreSQL, jadi UPDATE atas baris global tidak akan pernah
    // mengenai apa pun dengan perbandingan biasa — dan INSERT berikutnya
    // ditolak index unik parsialnya. Gejalanya: kill switch global yang gagal
    // dengan pesan constraint alih-alih bekerja.
    const { rowCount } = await db.query(
      `UPDATE feature_flag
          SET enabled = $3, reason = $4, updated_at = now(), updated_by = $5
        WHERE key = $1 AND tenant_id IS NOT DISTINCT FROM $2::uuid`,
      [kunci, tenantId, aktif, alasan || null, oleh]
    );
    if (rowCount === 0) {
      await db.query(
        `INSERT INTO feature_flag (id, key, tenant_id, enabled, reason, updated_by)
         VALUES ($1, $2, $3::uuid, $4, $5, $6)`,
        [randomUUID(), kunci, tenantId, aktif, alasan || null, oleh]
      );
      console.log('Baris dibuat.');
    } else {
      console.log('Baris diperbarui.');
    }
  } finally {
    await db.end();
  }
}

utama().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
