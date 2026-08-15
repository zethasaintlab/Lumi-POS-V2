'use strict';

// Sidebar back-office — `IA:§3.2` dan `IA:§3.3`.
//
// ⛔ Kenapa test ini ada: versi pertama `navigasi.ts` ditulis dari INGATAN,
// dan seluruh kode layarnya bergeser mulai dari B-08. "Langganan & Batas"
// kebetulan tetap B-29, jadi layar yang sedang dikerjakan terlihat benar
// sementara sembilan lainnya menunjuk ke tempat yang salah.
//
// Kode layar adalah kosakata bersama antara IA, plan, dan kode. Kalau ia
// bergeser, "layar mana yang belum ada" tidak dapat dijawab dengan membaca —
// hanya dengan menebak.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const NAV = '../../apps/backoffice/src/navigasi.ts';

/** Tabel `IA:§3.3` — sumber kebenaran kode layar back-office. */
function layarDariIA() {
  const isi = readFileSync(join(AKAR, 'product', 'IA-lumi-pos-v1.md'), 'utf8');
  const peta = new Map();
  for (const m of isi.matchAll(/^\|\s*(B-\d{2})\s*\|\s*(.+?)\s*\|/gm)) {
    peta.set(m[1], m[2]);
  }
  return peta;
}

test('⛔ setiap kode layar di sidebar ADA di tabel IA §3.3', async () => {
  const { NAVIGASI } = await import(NAV);
  const ia = layarDariIA();
  assert.ok(ia.size >= 30, `tabel IA tidak terbaca (${ia.size} baris) — pola regex-nya usang?`);

  const hilang = [];
  for (const grup of NAVIGASI) {
    for (const item of grup.items) {
      if (!ia.has(item.id)) hilang.push(`${item.id} (${item.label})`);
    }
  }
  assert.deepEqual(hilang, [], `kode layar tidak ada di IA §3.3: ${hilang.join(', ')}`);
});

test('⛔ LABEL sidebar cocok dengan nama layar di IA — bukan sekadar kodenya', async () => {
  // Kode yang ada tapi menunjuk layar lain adalah kegagalan yang lebih halus
  // daripada kode yang tidak ada: keduanya lolos test pertama.
  //
  // Dicocokkan longgar (label sidebar lebih pendek daripada judul di tabel:
  // "Penjualan" vs "Laporan Penjualan"), tapi harus saling memuat.
  const { NAVIGASI } = await import(NAV);
  const ia = layarDariIA();

  const bersih = (t) =>
    t.replace(/\*\*/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase();

  const menyimpang = [];
  for (const grup of NAVIGASI) {
    for (const item of grup.items) {
      const judul = bersih(ia.get(item.id) ?? '');
      const label = bersih(item.label);
      if (!judul.includes(label) && !label.includes(judul)) {
        menyimpang.push(`${item.id}: sidebar "${item.label}" vs IA "${ia.get(item.id)}"`);
      }
    }
  }
  assert.deepEqual(menyimpang, [], menyimpang.join('\n'));
});

test('⛔ tidak ada layar back-office yang HILANG dari sidebar tanpa alasan', async () => {
  // Kebalikan dari test pertama. Layar yang ada di IA tapi tidak di sidebar
  // adalah layar yang tidak dapat dicapai siapa pun.
  //
  // Empat pengecualian, dan masing-masing punya alasan yang dapat diperiksa:
  // B-00 adalah layar SEBELUM shell; B-03/B-05/B-07 adalah layar DETAIL yang
  // dicapai dari daftarnya, bukan dari menu.
  const DIKECUALIKAN = new Set(['B-00', 'B-03', 'B-05', 'B-07']);
  const { NAVIGASI } = await import(NAV);
  const ia = layarDariIA();

  const diSidebar = new Set(NAVIGASI.flatMap((g) => g.items.map((i) => i.id)));
  const hilang = [...ia.keys()].filter((id) => !DIKECUALIKAN.has(id) && !diSidebar.has(id));

  assert.deepEqual(hilang, [], `layar tanpa jalan masuk: ${hilang.join(', ')}`);
});

test('⛔ setiap nama ikon ADA di design system', async () => {
  // TypeScript sudah menahannya lewat `IconName` (`ds-bundle/components/
  // forms/Icon.d.ts`), tapi typecheck tidak berjalan di setiap test run dan
  // `iconNames` adalah daftar RUNTIME. Ikon yang tidak dikenal merender
  // kosong di sidebar — menu tanpa ikon terbaca seperti menu yang rusak,
  // bukan seperti error.
  const { NAVIGASI } = await import(NAV);
  const sumber = readFileSync(join(AKAR, 'ds-bundle', 'components', 'forms', 'Icon.jsx'), 'utf8');
  const dikenal = new Set([...sumber.matchAll(/^\s{2}'?([a-z0-9-]+)'?:\s/gm)].map((m) => m[1]));
  assert.ok(dikenal.size > 20, `daftar ikon tidak terbaca (${dikenal.size})`);

  const asing = [];
  for (const grup of NAVIGASI) {
    for (const item of grup.items) {
      if (!dikenal.has(item.icon)) asing.push(`${item.id} → "${item.icon}"`);
    }
  }
  assert.deepEqual(asing, [], `ikon tidak ada di design system: ${asing.join(', ')}`);
});

test('⛔ PENGAWASAN adalah grup TERPISAH dari LAPORAN (IA:171)', async () => {
  // Bukan selera. Laporan menjawab "apa yang terjadi", pengawasan menjawab
  // "apa yang tidak wajar" — dan laporan exception adalah satu-satunya
  // kontrol terhadap penyalahgunaan void sejak keputusan 1 Agustus 2026
  // menghapus PIN manajer darinya. Digabung, ia tenggelam.
  const { NAVIGASI } = await import(NAV);
  const nama = NAVIGASI.map((g) => g.group);
  assert.ok(nama.includes('Laporan'));
  assert.ok(nama.includes('Pengawasan'));

  const pengawasan = NAVIGASI.find((g) => g.group === 'Pengawasan');
  assert.deepEqual(
    pengawasan.items.map((i) => i.id),
    ['B-21', 'B-22'],
    'isi PENGAWASAN bergeser — laporan exception dan audit harus ada di sana'
  );
});

test('urutan grup mengikuti diagram IA §3.2', async () => {
  const { NAVIGASI } = await import(NAV);
  assert.deepEqual(
    NAVIGASI.map((g) => g.group),
    ['Ringkasan', 'Penjualan', 'Katalog', 'Inventori', 'Laporan', 'Pengawasan', 'Pengaturan']
  );
});

test('⛔ tidak ada layar yang muncul di DUA grup', async () => {
  const { NAVIGASI } = await import(NAV);
  const semua = NAVIGASI.flatMap((g) => g.items.map((i) => i.id));
  const ganda = semua.filter((id, i) => semua.indexOf(id) !== i);
  assert.deepEqual(ganda, [], `layar muncul dua kali: ${ganda.join(', ')}`);
});

test('⛔ setiap layar di LAYAR_SIAP benar-benar ada di sidebar', async () => {
  // Dulu test ini berbunyi "LAYAR_SIAP kosong, dan itu jujur" — benar saat
  // seluruh back-office masih kerangka. B-29 mengisi yang pertama.
  //
  // Yang dijaga sekarang bukan kekosongannya melainkan konsistensinya: kode
  // layar di daftar ini yang tidak ada di sidebar adalah layar yang tidak
  // dapat dicapai siapa pun — ia dianggap "siap" dan menyembunyikan keadaan
  // kosong yang seharusnya menjelaskan bahwa ia belum ada.
  const { LAYAR_SIAP, NAVIGASI } = await import(NAV);
  const diSidebar = new Set(NAVIGASI.flatMap((g) => g.items.map((i) => i.id)));

  for (const id of LAYAR_SIAP) {
    assert.ok(diSidebar.has(id), `${id} ada di LAYAR_SIAP tapi tidak ada di sidebar`);
  }
});

test('B-29 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-29'), 'B-29 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('⛔ B-27 sudah ditandai siap — ia GATE F5, bukan CRUD biasa', async () => {
  // Tanpa layar ini tidak ada jalur apa pun untuk menyetel PIN, dan login
  // kasir menuntut `pin_hash IS NOT NULL`. Merchant yang baru mendaftar punya
  // back-office yang dapat dimasuki dan aplikasi kasir yang tidak dapat
  // dimasuki siapa pun — termasuk dirinya sendiri.
  //
  // Kalau layarnya ada tapi tidak terdaftar di sini, sidebar menampilkan
  // keadaan kosong "B-27 belum dibangun" di atas layar yang sudah ada.
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-27'), 'B-27 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('B-06 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-06'), 'B-06 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('B-08 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-08'), 'B-08 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('⛔ B-07 TIDAK di sidebar — ia layar detail, dicapai dari B-06', async () => {
  // `IA:§3.3` menaruhnya di luar menu. Menambahkannya ke sidebar berarti
  // layar yang tidak dapat tahu produk mana yang sedang dibuka.
  const { NAVIGASI } = await import(NAV);
  const diSidebar = NAVIGASI.flatMap((g) => g.items.map((i) => i.id));
  assert.ok(!diSidebar.includes('B-07'), 'B-07 masuk sidebar — ia layar detail');
});

test('B-10 sudah ditandai siap — ia satu-satunya jalan mengubah harga', async () => {
  // B-07 membekukan harga varian dan MENUNJUK ke sini. Kalau layarnya tidak
  // terdaftar, tunjukan itu mengarah ke keadaan kosong "belum dibangun".
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-10'), 'B-10 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('B-09 sudah ditandai siap — grup Katalog akhirnya utuh', async () => {
  const { LAYAR_SIAP, NAVIGASI } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-09'), 'B-09 sudah dibangun tapi masih menampilkan keadaan kosong');

  // Seluruh grup Katalog kini punya isi. Penjaga ini menahan grup itu tetap
  // utuh: layar Katalog yang ditambahkan kelak tanpa isi akan terlihat di sini
  // alih-alih diam-diam menampilkan keadaan kosong di tengah grup yang penuh.
  const katalog = NAVIGASI.find((g) => g.group === 'Katalog');
  const belum = katalog.items.filter((i) => !LAYAR_SIAP.has(i.id)).map((i) => i.id);
  assert.deepEqual(belum, [], `layar Katalog tanpa isi: ${belum.join(', ')}`);
});

test('B-23 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-23'), 'B-23 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('B-25 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-25'), 'B-25 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('⛔ B-24 dan B-26 TIDAK ditandai siap — endpointnya belum ada', async () => {
  // Penyelidikan kontrak: `vertical_profile` punya tabel tapi NOL endpoint;
  // ambang otorisasi tidak punya tabel maupun endpoint (yang ada hanya
  // konstanta `AMBANG_SELISIH` yang dipanggang di `apps/kasir/src/kas/tutup.ts`).
  //
  // Menandainya siap berarti sidebar menjanjikan layar yang tidak dapat
  // memuat apa pun. Keadaan kosong bawaan sudah jujur — dan test ini menahan
  // seseorang menandainya siap sebelum endpointnya benar-benar ada.
  const { LAYAR_SIAP } = await import(NAV);
  for (const id of ['B-24', 'B-26']) {
    assert.ok(!LAYAR_SIAP.has(id), `${id} ditandai siap padahal endpointnya belum ada`);
  }
});

test('B-16 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-16'), 'B-16 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('B-17 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-17'), 'B-17 sudah dibangun tapi masih menampilkan keadaan kosong');
});
