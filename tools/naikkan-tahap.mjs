/**
 * Alat rilis F6 — menaikkan tahap staged rollout. `ARCH:§12`, KEP-36.
 *
 * Jalankan:
 *   node --env-file=.env tools/naikkan-tahap.mjs <versi> \
 *     --crash-kandidat=<angka> --crash-baseline=<angka> [--kering]
 *   node --env-file=.env tools/naikkan-tahap.mjs <versi> --status
 *
 * ## Kenapa alat, bukan endpoint
 *
 * Menaikkan tahap adalah tindakan OPERATOR kami, bukan tindakan merchant.
 * Endpoint untuknya menuntut permukaan otentikasi staf yang tidak ada di
 * sistem ini — seluruh peran di `spec-f` adalah peran merchant. Alat ini
 * memakai kredensial database yang memang sudah dipegang operator.
 *
 * ## ⛔ Kenapa angka crash rate WAJIB DIKETIK, bukan dihitung sendiri
 *
 * Crash rate satu versi bersifat LINTAS-TENANT menurut sifatnya ("berapa
 * crash di seluruh merchant yang sudah di 1.1.0"). Membacanya menuntut
 * pembaca ber-`BYPASSRLS`: `device_telemetry` tunduk RLS, dan
 * `FORCE ROW LEVEL SECURITY` berlaku untuk owner juga — jadi bahkan
 * `DATABASE_MIGRATION_URL` tidak dapat mengagregasinya. Batas yang sama sudah
 * tercatat di `apps/server/src/metrik.ts` sejak F6 dimulai.
 *
 * Yang dilakukan alat ini alih-alih menebak: menuntut angkanya disebutkan,
 * MENEGAKKAN aturannya terhadap angka itu, lalu MENYIMPAN angka yang dipakai
 * di `app_release.gate_crash_*`. Kalau tahap ternyata dinaikkan atas angka
 * yang salah, angkanya masih ada untuk dibaca.
 *
 * ⛔ Menjalankan tanpa keduanya TIDAK menaikkan tahap. Gate yang meloloskan
 * ketidaktahuan hanya menyala pada rilis yang sudah tidak membutuhkannya.
 */

import { createRequire } from 'node:module';
import {
  bolehNaikTahap,
  tahapBerikutnya,
  JEDA_TAHAP_JAM,
} from '../packages/domain/src/rilis.ts';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const SEBAB = {
  jeda_belum_cukup: `Belum ${JEDA_TAHAP_JAM} jam di tahap ini (ARCH:355).`,
  crash_naik: 'Crash rate kandidat LEBIH TINGGI daripada baseline (ARCH:304).',
  belum_terukur:
    'Crash rate belum disebutkan. Sebutkan --crash-kandidat dan --crash-baseline; ' +
    'lihat catatan kepala berkas ini soal kenapa alat tidak menghitungnya sendiri.',
  sudah_penuh: 'Tahap sudah `penuh`; tidak ada tahap berikutnya.',
};

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

function angkaOpsional(nilai, nama) {
  if (nilai === undefined) return null;
  const n = Number(nilai);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--${nama} harus angka >= 0, bukan "${nilai}".`);
  }
  return n;
}

async function utama() {
  const { posisi, opsi } = argumen(process.argv.slice(2));
  const versi = posisi[0];
  if (!versi) {
    console.error(
      'Pakai: node --env-file=.env tools/naikkan-tahap.mjs <versi> ' +
        '--crash-kandidat=<angka> --crash-baseline=<angka> [--kering]'
    );
    process.exit(2);
  }

  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error('DATABASE_MIGRATION_URL belum diatur.');
    process.exit(2);
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    // ⛔ Jeda dihitung dari jam DATABASE, bukan jam mesin operator. Aturan
    // yang sama dengan resolusi harga; di sini akibatnya adalah tahap yang
    // naik beberapa menit terlalu cepat karena laptop seseorang salah setel.
    const { rows } = await db.query(
      `SELECT version, stage, halted_at,
              EXTRACT(epoch FROM (now() - stage_entered_at)) / 3600 AS jam_di_tahap,
              gate_crash_candidate, gate_crash_baseline
         FROM app_release WHERE version = $1`,
      [versi]
    );
    if (rows.length === 0) {
      console.error(`Rilis ${versi} tidak ada di app_release.`);
      process.exit(1);
    }
    const r = rows[0];
    const jamDiTahap = Number(r.jam_di_tahap);

    console.log(`Rilis   : ${r.version}`);
    console.log(`Tahap   : ${r.stage}${r.halted_at ? ' (DIHENTIKAN)' : ''}`);
    console.log(`Di tahap: ${jamDiTahap.toFixed(1)} jam`);
    if (opsi.status) return;

    if (r.halted_at !== null) {
      console.error('Rilis ini sudah dihentikan. Terbitkan versi baru alih-alih menaikkannya.');
      process.exit(1);
    }

    const gate = {
      jamDiTahap,
      crashKandidat: angkaOpsional(opsi['crash-kandidat'], 'crash-kandidat'),
      crashBaseline: angkaOpsional(opsi['crash-baseline'], 'crash-baseline'),
    };
    const hasil = bolehNaikTahap(r.stage, gate);
    if (!hasil.boleh) {
      console.error(`\nDITAHAN: ${SEBAB[hasil.sebab] ?? hasil.sebab}`);
      process.exit(1);
    }

    const berikut = tahapBerikutnya(r.stage);
    console.log(`\nBoleh naik: ${r.stage} -> ${berikut}`);
    console.log(`  crash kandidat ${gate.crashKandidat} <= baseline ${gate.crashBaseline}`);
    if (opsi.kering) {
      console.log('\n--kering: tidak ada yang ditulis.');
      return;
    }

    await db.query(
      `UPDATE app_release
          SET stage = $2,
              stage_entered_at = now(),
              gate_crash_candidate = $3,
              gate_crash_baseline = $4
        WHERE version = $1`,
      [versi, berikut, gate.crashKandidat, gate.crashBaseline]
    );
    console.log(`\nTahap ${versi} kini ${berikut}.`);
  } finally {
    await db.end();
  }
}

utama().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
