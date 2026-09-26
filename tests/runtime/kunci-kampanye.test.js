'use strict';

// Kunci satu pelari kampanye (`docs/PROTOKOL-OTONOM.md` § Satu pelari).
//
// ## ⛔ Kenapa penjaga ini ada
//
// Dua session yang mengerjakan kampanye yang sama akan saling menimpa di
// branch yang sama. Kuncinya satu branch di remote (`kampanye-kunci`) yang
// hanya maju lewat push TANPA force: push yang kalah balapan ditolak git
// sebagai non-fast-forward. Session yang mati tanpa melepas kunci tidak
// menahannya selamanya: kunci yang tidak disegarkan lebih lama dari TTL boleh
// diambil alih.
//
// Test ini memakai repo bare lokal sebagai remote dan jam yang disuntikkan
// lewat `KUNCI_SEKARANG`, jadi tidak ada jaringan dan tidak ada menunggu.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ALAT = path.resolve(__dirname, '..', '..', 'tools', 'kunci-kampanye.mjs');

let remote;
let klonA;
let klonB;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function kunci(cwd, aksi, pemilik, sekarang) {
  const r = spawnSync(process.execPath, [ALAT, aksi, pemilik], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, KUNCI_SEKARANG: sekarang, KUNCI_REMOTE: 'origin' },
  });
  return { kode: r.status, keluaran: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  const akar = fs.mkdtempSync(path.join(os.tmpdir(), 'kunci-'));
  remote = path.join(akar, 'remote.git');
  git(akar, 'init', '-q', '--bare', remote);
  for (const nama of ['a', 'b']) {
    const d = path.join(akar, nama);
    git(akar, 'clone', '-q', remote, d);
    git(d, 'config', 'user.email', 'uji@contoh.invalid');
    git(d, 'config', 'user.name', 'uji');
  }
  klonA = path.join(akar, 'a');
  klonB = path.join(akar, 'b');
});

test('kunci bebas dapat diambil; pemilik lain lalu ditolak dengan kode 3', () => {
  const a = kunci(klonA, 'ambil', 'sesi-a', '2026-09-26T10:00:00Z');
  assert.equal(a.kode, 0, a.keluaran);
  const b = kunci(klonB, 'ambil', 'sesi-b', '2026-09-26T10:30:00Z');
  assert.equal(b.kode, 3, `pemilik kedua seharusnya ditolak: ${b.keluaran}`);
  assert.match(b.keluaran, /sesi-a/, 'pesan penolakan menyebut pemegang kunci');
});

test('kunci yang tidak disegarkan lebih lama dari TTL (120 menit) dapat diambil alih', () => {
  assert.equal(kunci(klonA, 'ambil', 'sesi-a', '2026-09-26T10:00:00Z').kode, 0);
  const masihHidup = kunci(klonB, 'ambil', 'sesi-b', '2026-09-26T11:59:00Z');
  assert.equal(masihHidup.kode, 3, 'pada 119 menit kunci masih dipegang');
  const basi = kunci(klonB, 'ambil', 'sesi-b', '2026-09-26T12:01:00Z');
  assert.equal(basi.kode, 0, `pada 121 menit kunci basi boleh diambil alih: ${basi.keluaran}`);
  assert.match(basi.keluaran, /basi/, 'pengambilalihan dinyatakan, tidak diam-diam');
});

test('segarkan memperpanjang TTL hanya untuk pemiliknya', () => {
  assert.equal(kunci(klonA, 'ambil', 'sesi-a', '2026-09-26T10:00:00Z').kode, 0);
  assert.equal(kunci(klonA, 'segarkan', 'sesi-a', '2026-09-26T11:50:00Z').kode, 0);
  assert.equal(kunci(klonB, 'ambil', 'sesi-b', '2026-09-26T12:30:00Z').kode, 3, 'segarkan memindahkan titik basi');
  const bukanPemilik = kunci(klonB, 'segarkan', 'sesi-b', '2026-09-26T12:31:00Z');
  assert.notEqual(bukanPemilik.kode, 0, 'non-pemilik tidak boleh menyegarkan kunci orang lain');
});

test('lepas membebaskan kunci untuk pemilik lain, sebelum TTL', () => {
  assert.equal(kunci(klonA, 'ambil', 'sesi-a', '2026-09-26T10:00:00Z').kode, 0);
  assert.equal(kunci(klonA, 'lepas', 'sesi-a', '2026-09-26T10:05:00Z').kode, 0);
  assert.equal(kunci(klonB, 'ambil', 'sesi-b', '2026-09-26T10:06:00Z').kode, 0);
});

test('balapan: dua pengambil yang melihat keadaan bebas yang sama, hanya satu yang menang', () => {
  // Keduanya membaca keadaan remote yang sama, lalu mendorong. Push kedua
  // bukan fast-forward dan ditolak git; alat melaporkannya sebagai kalah
  // balapan (kode 4), bukan sebagai sukses.
  const siap = kunci(klonA, 'ambil', 'sesi-a', '2026-09-26T09:00:00Z');
  assert.equal(siap.kode, 0);
  assert.equal(kunci(klonA, 'lepas', 'sesi-a', '2026-09-26T09:01:00Z').kode, 0);
  git(klonB, 'fetch', '-q', 'origin', 'kampanye-kunci');
  const menang = kunci(klonA, 'ambil', 'sesi-a', '2026-09-26T10:00:00Z');
  assert.equal(menang.kode, 0);
  const kalah = spawnSync(process.execPath, [ALAT, 'ambil', 'sesi-b'], {
    cwd: klonB,
    encoding: 'utf8',
    env: { ...process.env, KUNCI_SEKARANG: '2026-09-26T10:00:01Z', KUNCI_REMOTE: 'origin', KUNCI_TANPA_FETCH: '1' },
  });
  assert.equal(kalah.status, 4, `pengambil yang kalah balapan harus mendapat kode 4: ${kalah.stdout}${kalah.stderr}`);
});

test('periksa melaporkan pemegang tanpa mengubah remote', () => {
  assert.equal(kunci(klonA, 'ambil', 'sesi-a', '2026-09-26T10:00:00Z').kode, 0);
  const sebelum = git(klonB, 'ls-remote', 'origin', 'refs/heads/kampanye-kunci');
  const p = kunci(klonB, 'periksa', '-', '2026-09-26T10:10:00Z');
  assert.equal(p.kode, 3);
  assert.match(p.keluaran, /sesi-a/);
  assert.equal(git(klonB, 'ls-remote', 'origin', 'refs/heads/kampanye-kunci'), sebelum);
});
