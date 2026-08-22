'use strict';

// ⛔ PENJAGA: kelas tipografi `t-*` yang dipakai aplikasi harus BENAR-BENAR ADA
// di `/ds-bundle`.
//
// Aturan design system #1: *tepat empat ukuran teks*. Kelas yang salah ketik
// — atau dikarang karena "sepertinya ada ukuran di antara keduanya" — tidak
// menghasilkan satu pun error. Ia hanya tidak cocok apa pun, dan teksnya
// dirender pada ukuran warisan. Hasilnya terlihat *hampir* benar, dan tidak
// ada yang memeriksanya lagi.
//
// Ditemukan dengan cara itu persis: `t-body-lg` ditulis di B-19 dan tidak ada
// di `tokens/typography.css`. Yang menangkapnya adalah membaca berkas token,
// bukan lint dan bukan typecheck — keduanya tidak tahu apa pun tentang nama
// kelas CSS di dalam string.
//
// Penjaga ini statis: tanpa database, tanpa browser.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const TIPOGRAFI = join(AKAR, 'ds-bundle', 'tokens', 'typography.css');

const DIPINDAI = [join('apps', 'kasir', 'src'), join('apps', 'backoffice', 'src')];

function berkasSumber(dir) {
  const hasil = [];
  const telusuri = (d) => {
    for (const nama of readdirSync(d)) {
      const p = join(d, nama);
      if (statSync(p).isDirectory()) {
        if (nama === 'node_modules' || nama === 'dist') continue;
        telusuri(p);
        continue;
      }
      if (/\.tsx?$/.test(nama)) hasil.push(p);
    }
  };
  telusuri(join(AKAR, dir));
  return hasil;
}

/** Kelas `t-*` yang benar-benar didefinisikan design system. */
function kelasSah() {
  const css = readFileSync(TIPOGRAFI, 'utf8');
  return new Set([...css.matchAll(/^\.(t-[a-z-]+)/gm)].map((m) => m[1]));
}

test('penjaga benar-benar membaca token — bukan hijau karena kosong', () => {
  const sah = kelasSah();
  assert.ok(sah.size >= 4, `hanya ${sah.size} kelas tipografi terbaca; parsernya rusak?`);
  // Sentinel: keempat ukuran yang aturan #1 sebut wajib ada.
  for (const k of ['t-display', 't-title', 't-body', 't-caption']) {
    assert.ok(sah.has(k), `kelas inti ${k} tidak terbaca dari ${relative(AKAR, TIPOGRAFI)}`);
  }
});

test('⛔ setiap kelas `t-*` yang dipakai aplikasi ada di /ds-bundle', () => {
  const sah = kelasSah();
  const berkas = DIPINDAI.flatMap(berkasSumber);
  assert.ok(berkas.length > 20, `hanya ${berkas.length} berkas terpindai`);

  const asing = [];
  let dipakai = 0;
  for (const f of berkas) {
    const isi = readFileSync(f, 'utf8');
    // Hanya di dalam `className` — supaya kata seperti `t-shirt` di teks
    // Indonesia tidak ikut tertangkap.
    for (const m of isi.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const kelas of (m[1] ?? m[2] ?? '').split(/\s+/)) {
        if (!/^t-[a-z-]+$/.test(kelas)) continue;
        dipakai += 1;
        if (!sah.has(kelas)) asing.push(`${relative(AKAR, f)}: ${kelas}`);
      }
    }
  }

  assert.ok(dipakai > 20, `hanya ${dipakai} pemakaian kelas t-* terlihat; pemindainya rusak?`);
  assert.deepEqual(
    [...new Set(asing)],
    [],
    'Kelas tipografi yang tidak ada di /ds-bundle — teksnya dirender pada ukuran warisan, ' +
      'tanpa satu pun error:\n  ' + [...new Set(asing)].join('\n  ')
  );
});
