#!/usr/bin/env node
/**
 * Ekstrak node SVG mentah dari paket `lucide-react` apa adanya, tanpa
 * dependency npm baru di repo ini — Task 6, sub-proyek 1 "Fondasi desain".
 *
 * Kenapa alat, bukan salin-tempel tangan: node Lucide dipakai untuk
 * membuktikan `ikon.tsx` sama persis dengan sumbernya
 * (`tests/runtime/ikon-lucide.test.js` § (b)), dan pembuktian itu hanya
 * berarti sesuatu kalau fixture pembandingnya juga ditarik dari paket asli,
 * bukan ditranskripsi ulang oleh tangan yang sama yang menulis `ikon.tsx`.
 *
 * Sumber paket TIDAK dikutip dari registry npm — repo ini tidak menambah
 * dependency Lucide (`CLAUDE.md` § Aturan design system #8, keputusan
 * kampanye 26 September 2026). Unduh sekali ke scratchpad:
 *
 *   npm pack lucide-react@0.468.0
 *   tar xzf lucide-react-0.468.0.tgz
 *
 * Jalankan:
 *   node tools/ekstrak-lucide.mjs <dir-paket-lucide> <daftar-nama> [berkas-keluaran]
 *
 *   <dir-paket-lucide>  folder hasil ekstrak tarball (berisi `dist/esm/icons`
 *                       dan `LICENSE`) — BUKAN folder repo ini.
 *   <daftar-nama>       berkas teks, satu nama kebab Lucide per baris
 *                       (baris kosong dan `#komentar` diabaikan).
 *   [berkas-keluaran]   path `nodes.json` tujuan; tanpa ini, JSON dicetak ke
 *                       stdout. `--format=ts` menulis modul `.ts` yang
 *                       mengekspor `NODES` alih-alih JSON mentah — dipakai
 *                       untuk `packages/ds/ikon-data.ts`, supaya `node:test`
 *                       dapat mengimpornya lewat `--experimental-strip-types`
 *                       tanpa JSX.
 *
 * Setiap nama diselesaikan lewat `dist/esm/icons/<nama>.js`. Berkas yang
 * hanya berisi `export { default } from './lain.js';` adalah ALIAS Lucide
 * (nama lama yang dipertahankan untuk kompatibilitas) — diikuti sampai
 * berkas yang benar-benar memanggil `createLucideIcon`, dan alias yang
 * diikuti dicatat di stderr supaya tidak diam-diam.
 *
 * Atribut `key` dibuang dari setiap node: itu kunci React internal Lucide
 * (dari `nanoid`, bukan bagian gambar), dan `ikon.tsx` menghasilkan key-nya
 * sendiri dari indeks saat merender.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function usageError(pesan) {
  console.error(`ekstrak-lucide: ${pesan}`);
  console.error('');
  console.error('Pemakaian: node tools/ekstrak-lucide.mjs <dir-paket-lucide> <daftar-nama> [berkas-keluaran] [--format=json|ts]');
  process.exit(1);
}

function bacaDaftarNama(path) {
  if (!existsSync(path)) usageError(`daftar nama tidak ditemukan: ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((baris) => baris.trim())
    .filter((baris) => baris.length > 0 && !baris.startsWith('#'));
}

/** Parse literal array `createLucideIcon("Nama", [ ... ])` dari teks berkas ikon Lucide. */
function parseNodeArray(teks, path) {
  const m = teks.match(/createLucideIcon\(\s*"[^"]+",\s*(\[[\s\S]*?\])\s*\)/);
  if (!m) throw new Error(`tidak menemukan createLucideIcon(...) di ${path}`);
  // eslint-disable-next-line no-new-func -- sumbernya berkas Lucide yang sudah kita unduh sendiri, bukan input jaringan.
  const nilai = new Function(`"use strict"; return (${m[1]});`)();
  return nilai.map(([tag, attrs]) => {
    const { key: _key, ...sisa } = attrs;
    return [tag, sisa];
  });
}

/** Selesaikan satu nama kebab ke node-nya, mengikuti alias `export { default } from './x.js'` bila ada. */
function resolveNodes(dirPaket, nama, rantai = []) {
  const path = join(dirPaket, 'dist', 'esm', 'icons', `${nama}.js`);
  if (!existsSync(path)) {
    throw new Error(`berkas ikon tidak ada: ${path} (rantai: ${[...rantai, nama].join(' -> ')})`);
  }
  const teks = readFileSync(path, 'utf8');
  const alias = teks.match(/export\s*\{\s*default\s*\}\s*from\s*['"]\.\/([a-z0-9-]+)\.js['"]/);
  if (alias) {
    const target = alias[1];
    if (rantai.includes(target)) {
      throw new Error(`alias melingkar: ${[...rantai, nama, target].join(' -> ')}`);
    }
    console.error(`ekstrak-lucide: "${nama}" adalah alias Lucide -> "${target}"`);
    return resolveNodes(dirPaket, target, [...rantai, nama]);
  }
  return parseNodeArray(teks, path);
}

function formatTs(nodes) {
  const baris = [
    '/**',
    ' * BERKAS TERGENERASI — jangan disunting tangan.',
    ' * Dihasilkan `tools/ekstrak-lucide.mjs` dari `lucide-react@0.468.0`',
    ' * (`dist/esm/icons/*.js`, ISC — lihat `packages/ds/LISENSI-LUCIDE`).',
    ' * Node disalin apa adanya; atribut `key` Lucide dibuang.',
    ' *',
    ' * Ulangi: node tools/ekstrak-lucide.mjs <dir-paket-lucide> tests/fixture/lucide-0.468.0/daftar-nama.txt packages/ds/ikon-data.ts --format=ts',
    ' */',
    '',
    'export type LucideNode = [tag: string, attrs: Record<string, string>];',
    '',
    `export const NODES = ${JSON.stringify(nodes, null, 2)} as const satisfies Record<string, readonly LucideNode[]>;`,
    '',
    'export type LucideKebabName = keyof typeof NODES;',
    '',
  ];
  return baris.join('\n');
}

function main() {
  const [dirPaket, daftarPath, keluaranPath, ...rest] = process.argv.slice(2);
  if (!dirPaket || !daftarPath) usageError('dir-paket-lucide dan daftar-nama wajib diisi.');
  const formatArg = rest.find((a) => a.startsWith('--format='));
  const format = formatArg ? formatArg.split('=')[1] : 'json';
  if (!['json', 'ts'].includes(format)) usageError(`--format tidak dikenal: ${format}`);

  const namaList = bacaDaftarNama(daftarPath);
  if (namaList.length === 0) usageError(`daftar nama kosong: ${daftarPath}`);

  const nodes = {};
  for (const nama of namaList) {
    if (nama in nodes) continue;
    nodes[nama] = resolveNodes(dirPaket, nama);
  }

  const namaTerurut = Object.keys(nodes).sort();
  const hasil = {};
  for (const nama of namaTerurut) hasil[nama] = nodes[nama];

  const teks = format === 'ts' ? formatTs(hasil) : `${JSON.stringify(hasil, null, 2)}\n`;

  if (keluaranPath) {
    writeFileSync(keluaranPath, teks);
    console.error(`ekstrak-lucide: ${namaTerurut.length} ikon ditulis ke ${keluaranPath}`);
  } else {
    process.stdout.write(teks);
  }
}

main();
