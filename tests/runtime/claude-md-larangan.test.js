'use strict';

// ⛔ REGISTRI LARANGAN — setiap kalimat ⛔ yang pernah ada di CLAUDE.md
// (sebelum #76/#78 memindahkan riwayat dan alasan ke `docs/keputusan/*.md`)
// wajib tetap terbaca di salah satu dari: CLAUDE.md itu sendiri,
// `docs/keputusan/*.md`, `docs/verifikasi/KELAS-GAGAL.md`, atau `HANDOFF.md`.
//
// Fixture `fixtures/claude-md-larangan.json` diekstrak SEKALI dari CLAUDE.md
// versi sebelum pemindahan (commit 0211b88) — setiap unit (heading, list item
// termasuk sambungannya, atau paragraf) yang memuat ⛔, dinormalisasi
// (whitespace dirapatkan). Test ini tidak mengekstrak ulang: pemindahan itu
// sendiri mengubah CLAUDE.md, jadi sumber kebenarannya adalah fixture yang
// sudah dibekukan, bukan file yang sedang disunting.
//
// ⛔ Pengecualian (`fixture.exceptions`) adalah kalimat yang user PERINTAHKAN
// dihapus atau ditulis ulang (Group 3, lihat issue #76/#78) — bukan celah,
// melainkan daftar tertutup dengan alasan tertulis untuk masing-masing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');

function normalize(s) {
  return s.replace(/\s+/g, ' ').trim();
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-md-larangan.json'), 'utf8')
);

function daftarBerkasKeputusan() {
  const dir = path.join(AKAR, 'docs', 'keputusan');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f));
}

function daftarBerkasSumberDicari() {
  return [
    path.join(AKAR, 'CLAUDE.md'),
    ...daftarBerkasKeputusan(),
    path.join(AKAR, 'docs', 'verifikasi', 'KELAS-GAGAL.md'),
    path.join(AKAR, 'HANDOFF.md'),
  ];
}

function isiTernormalisasi() {
  return daftarBerkasSumberDicari().map((p) => ({
    path: p,
    text: normalize(fs.readFileSync(p, 'utf8')),
  }));
}

test('setiap kalimat ⛔ lama masih ada di CLAUDE.md atau docs/keputusan/*.md', () => {
  assert.ok(fixture.entries.length > 0, 'fixture kosong — tidak memindai apa pun');

  const pengecualian = new Set((fixture.exceptions || []).map((e) => normalize(e.text)));
  for (const exc of fixture.exceptions || []) {
    assert.ok(
      typeof exc.reason === 'string' && exc.reason.length > 0,
      `pengecualian tanpa alasan: ${exc.text}`
    );
  }

  const sumber = isiTernormalisasi();
  const hilang = [];

  for (const entriMentah of fixture.entries) {
    const entri = normalize(entriMentah);
    if (pengecualian.has(entri)) continue; // Group 3: dihapus/ditulis ulang atas perintah user
    const ada = sumber.some((s) => s.text.includes(entri));
    if (!ada) hilang.push(entriMentah);
  }

  assert.deepEqual(
    hilang,
    [],
    'Kalimat ⛔ berikut hilang dari CLAUDE.md DAN dari docs/keputusan/*.md ' +
      '(dan dari KELAS-GAGAL.md/HANDOFF.md):\n  ' + hilang.join('\n  ---\n  ')
  );
});

test('registri larangan benar-benar memindai sesuatu', () => {
  assert.ok(fixture.entries.length >= 50, `fixture hanya ${fixture.entries.length} entri — terlalu sedikit untuk dipercaya`);
  const sumber = daftarBerkasSumberDicari();
  assert.ok(sumber.length >= 3, 'daftar berkas sumber terlalu pendek');
  for (const p of sumber) {
    assert.ok(fs.existsSync(p), `berkas sumber tidak ada: ${p}`);
    assert.ok(fs.readFileSync(p, 'utf8').length > 0, `berkas sumber kosong: ${p}`);
  }
  assert.ok(daftarBerkasKeputusan().length >= 6, 'docs/keputusan/ harus berisi beberapa berkas hasil pemindahan');
});
