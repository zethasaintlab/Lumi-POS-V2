#!/usr/bin/env node
// Kunci satu pelari kampanye — `docs/PROTOKOL-OTONOM.md` § Satu pelari.
//
//   node tools/kunci-kampanye.mjs ambil    <pemilik>
//   node tools/kunci-kampanye.mjs segarkan <pemilik>
//   node tools/kunci-kampanye.mjs lepas    <pemilik>
//   node tools/kunci-kampanye.mjs pastikan <pemilik>
//   node tools/kunci-kampanye.mjs periksa  -
//
// Kode keluar: 0 berhasil / bebas · 3 dipegang pemilik lain · 4 kalah balapan
// (coba lagi dari awal) · 5 bukan pemilik · 6 kunci sendiri sudah basi ·
// 2 pemakaian salah.
//
// ⛔ `pastikan` dijalankan SEBELUM SETIAP PUSH dan tidak menulis apa pun. Kunci
// yang sudah diambil alih (5) atau basi (6) berarti berhenti tanpa push:
// session lain mungkin sedang menulis branch yang sama.
//
// ⛔ Kuncinya satu branch di remote, `kampanye-kunci`, berisi satu berkas
// `KUNCI.json`. Setiap perubahan adalah commit BARU di atas tip yang terbaca,
// didorong TANPA force. Dua pengambil yang membaca tip yang sama menghasilkan
// dua commit bersaudara; git menerima yang pertama dan menolak yang kedua
// sebagai non-fast-forward. Itu satu-satunya operasi atomik yang tersedia
// tanpa layanan tambahan, dan ia tidak menuntut izin push paksa yang
// `.claude/settings.json` larang.
//
// ⛔ Session yang mati tanpa `lepas` tidak menahan kunci selamanya: kunci yang
// tidak disegarkan lebih lama dari TTL dianggap basi dan boleh diambil alih,
// dan pengambilalihan itu dicetak, tidak diam-diam.
//
// Tidak menyentuh pohon kerja maupun branch kerja: commit dibangun lewat
// `hash-object` / `mktree` / `commit-tree`.
//
// ⛔ Pohonnya juga memuat `vercel.json` yang mematikan deployment: Vercel
// membaca berkas itu dari commit yang di-push, jadi setelan di `main` tidak
// berlaku di sini, dan tanpanya setiap aksi kunci memicu deployment (#76).

import { execFileSync } from 'node:child_process';

const BRANCH = 'kampanye-kunci';
const REMOTE = process.env.KUNCI_REMOTE || 'origin';
const TTL_MENIT = Number(process.env.KUNCI_TTL_MENIT || 120);
const TRACKING = `refs/remotes/${REMOTE}/${BRANCH}`;
const VERCEL_JSON = JSON.stringify({ git: { deploymentEnabled: false } }, null, 2) + '\n';

const [aksi, pemilik] = process.argv.slice(2);
if (!['ambil', 'segarkan', 'lepas', 'pastikan', 'periksa'].includes(aksi) || !pemilik) {
  console.error('pakai: kunci-kampanye.mjs ambil|segarkan|lepas|pastikan <pemilik> · periksa -');
  process.exit(2);
}

const sekarang = process.env.KUNCI_SEKARANG ? new Date(process.env.KUNCI_SEKARANG) : new Date();

function git(args, input) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'kunci-kampanye',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'kunci@lumi.invalid',
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'kunci-kampanye',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'kunci@lumi.invalid',
    },
  }).trim();
}

function coba(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

if (!process.env.KUNCI_TANPA_FETCH) {
  // Branch yang belum pernah ada di remote bukan galat: kuncinya bebas.
  coba(['fetch', '-q', REMOTE, `+refs/heads/${BRANCH}:${TRACKING}`]);
}

const tip = coba(['rev-parse', '--verify', '-q', TRACKING]);
const keadaan = tip ? JSON.parse(git(['show', `${TRACKING}:KUNCI.json`])) : { status: 'bebas' };
const umurMenit = keadaan.diperbarui ? (sekarang - new Date(keadaan.diperbarui)) / 60000 : Infinity;
const aktif = keadaan.status === 'aktif';
const dipegang = aktif && umurMenit <= TTL_MENIT;
const ringkas = aktif
  ? `${keadaan.pemilik}, disegarkan ${Math.round(umurMenit)} menit lalu (${keadaan.diperbarui})`
  : 'bebas';

function tulis(status, pesan) {
  const isi = JSON.stringify({ status, pemilik, diperbarui: sekarang.toISOString() }, null, 2) + '\n';
  const blob = git(['hash-object', '-w', '--stdin'], isi);
  const vercel = git(['hash-object', '-w', '--stdin'], VERCEL_JSON);
  const pohon = git(['mktree'], `100644 blob ${blob}\tKUNCI.json\n100644 blob ${vercel}\tvercel.json\n`);
  const commit = git(['commit-tree', pohon, ...(tip ? ['-p', tip] : []), '-m', pesan]);
  try {
    git(['push', '-q', REMOTE, `${commit}:refs/heads/${BRANCH}`]);
  } catch (e) {
    console.error(`kalah balapan: remote ${BRANCH} berubah sejak dibaca. Ulangi dari awal.\n${e.stderr || ''}`);
    process.exit(4);
  }
}

if (aksi === 'periksa') {
  console.log(dipegang ? `dipegang: ${ringkas}` : `bebas (${ringkas})`);
  process.exit(dipegang ? 3 : 0);
}

if (aksi === 'ambil') {
  if (dipegang && keadaan.pemilik !== pemilik) {
    console.error(`dipegang: ${ringkas}. Keluar tanpa bekerja.`);
    process.exit(3);
  }
  const basi = aktif && !dipegang && keadaan.pemilik !== pemilik;
  tulis('aktif', basi ? `ambil alih kunci basi dari ${keadaan.pemilik}: ${pemilik}` : `ambil: ${pemilik}`);
  console.log(basi ? `diambil alih dari kunci basi: ${ringkas}` : `diambil: ${pemilik}`);
  process.exit(0);
}

if (!aktif || keadaan.pemilik !== pemilik) {
  console.error(`bukan pemilik: ${ringkas}`);
  process.exit(5);
}

if (aksi === 'pastikan') {
  if (!dipegang) {
    console.error(`kunci sendiri sudah basi: ${ringkas}. Segarkan dulu; jangan push.`);
    process.exit(6);
  }
  console.log(`masih dipegang: ${ringkas}`);
  process.exit(0);
}
tulis(aksi === 'lepas' ? 'bebas' : 'aktif', `${aksi}: ${pemilik}`);
console.log(`${aksi}: ${pemilik}`);
