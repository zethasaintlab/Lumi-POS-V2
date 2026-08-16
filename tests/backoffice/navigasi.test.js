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

test('B-18 dan B-19 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  for (const id of ['B-18', 'B-19']) {
    assert.ok(LAYAR_SIAP.has(id), `${id} sudah dibangun tapi masih menampilkan keadaan kosong`);
  }
});


// ---------------------------------------------------------------------------
// ⛔ Akuntan — resolusi IA:439
// ---------------------------------------------------------------------------

test('⛔ akuntan melihat grup Laporan DAN Pengawasan', async () => {
  // Keputusan produk direvisi 16 Agustus 2026: Akuntan mendapat akses ke B-21.
  //
  // Versi sebelumnya menyempitkan akuntan ke grup Laporan saja dan MENCATAT
  // ketegangannya: matriks `spec-f` memberinya `report_exception`, jadi menu
  // menyembunyikan layar yang haknya benar-benar ia punya. Revisi ini menutup
  // ketegangan itu — sekarang navigasinya DITURUNKAN dari matriks yang sama
  // dengan yang server tegakkan, bukan dari daftar grup yang ditulis tangan.
  const { navigasiUntuk } = await import(NAV);
  const grup = navigasiUntuk(['accountant']).map((g) => g.group);
  assert.deepEqual(grup, ['Laporan', 'Pengawasan']);
});

test('⛔ akuntan melihat B-21 tapi TIDAK B-22', async () => {
  // Pengawasan tidak dibuka sebagai grup utuh. B-22 (Audit & Aktivitas) tidak
  // punya operasi di matriks, dan grup yang dibuka borongan akan menyeretnya
  // ikut — memberi akuntan menu yang tidak seorang pun pernah putuskan.
  const { navigasiUntuk } = await import(NAV);
  const pengawasan = navigasiUntuk(['accountant']).find((g) => g.group === 'Pengawasan');
  assert.deepEqual(pengawasan.items.map((i) => i.id), ['B-21']);
});

test('⛔ akuntan tidak melihat Katalog, Pengguna, atau Pengaturan', async () => {
  const { navigasiUntuk } = await import(NAV);
  const terlihat = navigasiUntuk(['accountant']).flatMap((g) => g.items.map((i) => i.id));
  for (const id of ['B-06', 'B-08', 'B-09', 'B-10', 'B-23', 'B-25', 'B-27', 'B-28']) {
    assert.ok(!terlihat.includes(id), `${id} bocor ke menu akuntan`);
  }
});

test('⛔ operasi pada item navigasi DIKENAL matriks domain', async () => {
  // Penjaga yang membuat `operasi` tidak dapat menjadi sumber kebenaran kedua.
  // `bolehkah` fail-closed: operasi yang salah ketik ditolak untuk SEMUA orang,
  // jadi item itu akan hilang dari menu semua peran — diam-diam, tanpa error.
  const { NAVIGASI } = await import(NAV);
  const { bolehkah } = await import('../../packages/domain/src/rbac.ts');

  const asing = [];
  for (const grup of NAVIGASI) {
    for (const item of grup.items) {
      if (item.operasi === undefined) continue;
      if (!bolehkah(['owner'], item.operasi)) asing.push(`${item.id} → "${item.operasi}"`);
    }
  }
  assert.deepEqual(asing, [], `operasi tidak dikenal matriks: ${asing.join(', ')}`);
});

test('B-21 sudah ditandai siap', async () => {
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-21'), 'B-21 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('⛔ akuntan yang JUGA manajer melihat menu penuh', async () => {
  // Seseorang dapat memegang beberapa peran. Memeriksa `includes('accountant')`
  // saja akan menyembunyikan menu dari orang yang berhak memakainya.
  const { navigasiUntuk } = await import(NAV);
  const grup = navigasiUntuk(['accountant', 'outlet_manager']).map((g) => g.group);
  assert.ok(grup.length > 1, 'akuntan-merangkap-manajer kehilangan menunya');
});

test('peran lain tidak terpengaruh', async () => {
  const { navigasiUntuk, NAVIGASI } = await import(NAV);
  for (const peran of [['owner'], ['area_manager'], ['outlet_manager'], []]) {
    assert.equal(navigasiUntuk(peran).length, NAVIGASI.length, `${peran} kehilangan menu`);
  }
});

test('⛔ beranda akuntan adalah B-16, bukan dashboard', async () => {
  // B-01 tidak ada di grup Laporan. Akuntan yang mendarat di sana melihat
  // keadaan kosong "tidak punya akses" sebagai layar pertamanya.
  const { BERANDA_AKUNTAN, navigasiUntuk } = await import(NAV);
  assert.equal(BERANDA_AKUNTAN, 'B-16');
  const terlihat = navigasiUntuk(['accountant']).flatMap((g) => g.items.map((i) => i.id));
  assert.ok(terlihat.includes(BERANDA_AKUNTAN), 'beranda akuntan tidak ada di menunya');
});

test('B-20 sudah ditandai siap — IA:439 sudah diputuskan', async () => {
  // Persona Akuntan: hanya grup Laporan. Penjaga yang menahan B-20 sebelumnya
  // sengaja dihapus bersamaan dengan keputusan itu.
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-20'), 'B-20 sudah dibangun tapi masih menampilkan keadaan kosong');
});

test('⛔ SELURUH grup Laporan siap — itu yang akuntan lihat', async () => {
  const { LAYAR_SIAP, navigasiUntuk } = await import(NAV);
  const belum = navigasiUntuk(['accountant'])
    .flatMap((g) => g.items)
    .filter((i) => !LAYAR_SIAP.has(i.id))
    .map((i) => i.id);
  assert.deepEqual(belum, [], `akuntan melihat layar tanpa isi: ${belum.join(', ')}`);
});

test('B-12 dan B-13 sudah ditandai siap', async () => {
  // ⛔ B-13 tidak punya layar sendiri — ia panel di atas B-12, dan menunya
  // membuka B-12 dengan panel itu terbuka. Menandainya siap karena itu benar:
  // menu yang menampilkan "belum dibangun" untuk sesuatu yang sudah ada
  // berbohong ke arah yang berlawanan dari yang daftar ini cegah.
  const { LAYAR_SIAP } = await import(NAV);
  for (const id of ['B-12', 'B-13']) {
    assert.ok(LAYAR_SIAP.has(id), `${id} sudah dibangun tapi masih menampilkan keadaan kosong`);
  }
});

test('B-14 dan B-15 sudah ditandai siap — seluruh grup Inventori utuh', async () => {
  // ⛔ Keduanya dulu diblokir oleh sebab yang berbeda, dan keduanya kini
  // terbuka:
  //
  // B-15 — `oversell_event` sudah terisi `detectOversell` sejak F3, dan
  // `GET /reports/inventory/oversells` membacanya.
  //
  // B-14 — `stocktake`/`stocktake_line` ada di skema sejak migrasi 0010 tapi
  // tidak punya satu pun rute REST sampai epik ini. `IA:§3.3` menamainya
  // **Opname**; peringatan stok menipis adalah hal lain dan hidup di B-12
  // sebagai penyaring tampilan.
  const { LAYAR_SIAP, NAVIGASI } = await import(NAV);
  for (const id of ['B-14', 'B-15']) {
    assert.ok(LAYAR_SIAP.has(id), `${id} sudah dibangun tapi masih menampilkan keadaan kosong`);
  }

  // Penjaga yang menahan grup Inventori tetap utuh: layar yang ditambahkan
  // kelak tanpa isi terlihat di sini alih-alih diam-diam menampilkan keadaan
  // kosong di tengah grup yang penuh.
  const inventori = NAVIGASI.find((g) => g.group === 'Inventori');
  const belum = inventori.items.filter((i) => !LAYAR_SIAP.has(i.id)).map((i) => i.id);
  assert.deepEqual(belum, [], `layar Inventori tanpa isi: ${belum.join(', ')}`);
});

test('B-04 sudah ditandai siap — blokadenya dibuka endpoint tutup shift', async () => {
  // B-04 diblokir dua penyelidikan lamanya karena shift yang ditutup tidak
  // pernah sampai ke server: setiap baris akan menampilkan kolom uang NULL.
  // `POST /shifts/{id}/close` menutup itu.
  //
  // ⛔ B-05 tidak punya layar sendiri — ia panel di atas B-04, dan `IA:§3.3`
  // memang menaruhnya sebagai layar DETAIL yang dicapai dari daftarnya. Ada
  // test lain yang menahannya tetap di luar sidebar.
  const { LAYAR_SIAP } = await import(NAV);
  assert.ok(LAYAR_SIAP.has('B-04'), 'B-04 sudah dibangun tapi masih menampilkan keadaan kosong');
});
