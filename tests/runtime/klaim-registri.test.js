'use strict';

// ⛔ REGISTRI KLAIM — catatan berangka yang diukur ulang, bukan diingat.
//
// ## Kenapa penjaga ini ada
//
// Audit 2 September 2026: dari 19 klaim berangka di `CLAUDE.md` dan komentar
// kode, **delapan sudah basi**. Semuanya benar saat ditulis. Mekanismenya satu:
// catatan tidak punya cara memberi tahu bahwa dunia di sekitarnya berubah, dan
// pembaca berikutnya MENGUTIPNYA sebagai pengukuran. Itu terjadi — "delapan
// salinan pemformat rupiah" dikutip dari catatan 24 Agustus yang sudah lunas.
//
// ## Aturan masuk registri, dan ia SEMPIT
//
// Sebuah klaim masuk ke sini hanya bila pengukurnya **murah dan kokoh**.
//
// ⛔ Klaim yang menuntut penghitung RAPUH TIDAK MASUK — dan konsekuensinya:
// ia tidak boleh punya angka sama sekali di prosa mana pun. "52 layar" dan
// "414 acceptance criteria" adalah contohnya: regex atas dokumen produk
// menjawab 53 dan 415, dan selisih satu itu jauh lebih mungkin salah pola
// daripada salah dokumen. Penjaga yang menuduh dokumen yang benar akan
// dimatikan — dan yang mematikannya benar.
//
// Bentuknya karena itu bukan "daftar semua angka", melainkan "daftar angka
// yang kita sanggup ukur ulang setiap kali test berjalan".
//
// ## Ia memeriksa DUA arah
//
// 1. `ukur()` == `harap`  — kode menjauh dari klaimnya
// 2. `frasa` masih ada di `berkas` — klaimnya disunting/dipindahkan tanpa
//    registrinya ikut, yang membuat entri di bawah menjaga kalimat yang sudah
//    tidak ada. Penjaga yang menjaga hantu adalah bentuk kekosongan yang sama
//    dengan yang `KELAS-GAGAL.md` catat.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const baca = (p) => fs.readFileSync(path.join(AKAR, p), 'utf8');

function berkasSumber(dir, pola, { lewati = [] } = {}) {
  const hasil = [];
  const telusuri = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(e.name) || e.name.startsWith('dist-')) continue;
      if (lewati.includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) telusuri(p);
      else if (pola.test(e.name)) hasil.push(p);
    }
  };
  telusuri(path.join(AKAR, dir));
  return hasil;
}

const isiSemua = (berkas) => berkas.map((f) => fs.readFileSync(f, 'utf8'));

/**
 * Registri.
 *
 * `frasa` ditulis PERSIS seperti di berkasnya, termasuk angkanya — itu yang
 * membuat entri ini gagal saat kalimatnya disunting tanpa registri ikut.
 */
const KLAIM = [
  {
    id: 'pemformat-rupiah-pemakai',
    berkas: 'CLAUDE.md',
    frasa: '35 berkas mengimpornya',
    harap: 35,
    // ⛔ `import`, bukan sekadar MENYEBUT nama berkasnya. Versi pertama
    // memakai `includes('uang-tampilan')` dan menghitung 36 — yang ke-36
    // adalah `packages/ds/index.ts`, yang menyebutnya di KOMENTAR (catatan
    // kenapa CartRow tidak diekspor) dan tidak mengimpor apa pun. Klaimnya
    // berbunyi "berkas mengimpornya", jadi pengukurnya harus mengukur itu.
    ukur: () =>
      berkasSumber('apps', /\.tsx?$/)
        .concat(berkasSumber('packages', /\.tsx?$/))
        .filter((f) => /import[^;]*uang-tampilan/.test(fs.readFileSync(f, 'utf8'))).length,
  },
  {
    id: 'ikon-bundle',
    berkas: 'CLAUDE.md',
    frasa: '`<Icon>` (42 ikon)',
    harap: 42,
    ukur: () => {
      const s = baca('ds-bundle/components/forms/Icon.jsx');
      const seg = s.slice(s.indexOf('PATHS = '), s.indexOf('iconNames'));
      return [...seg.matchAll(/(?:^|[{,]\s*)([a-z][a-z0-9-]*)\s*:/gm)].length;
    },
  },
  {
    id: 'ikon-backoffice',
    berkas: 'CLAUDE.md',
    frasa: 'back-office memakai **56×**',
    harap: 56,
    ukur: () =>
      isiSemua(berkasSumber('apps/backoffice/src', /\.tsx$/))
        .join('\n')
        .match(/<Icon[\s/}>]/g)?.length ?? 0,
  },
  {
    id: 'modul-server',
    berkas: 'CLAUDE.md',
    frasa: '**Dua belas modul kini punya kode**',
    harap: 12,
    ukur: () =>
      fs
        .readdirSync(path.join(AKAR, 'apps/server/src/modules'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).length,
  },
  {
    id: 'peripheral-belum-ada',
    berkas: 'CLAUDE.md',
    frasa: '`peripheralAktif()` masih mengembalikan `null`',
    harap: true,
    // Klaim KEADAAN, bukan hitungan: gate F4 bagian pertama berdiri di atasnya,
    // dan hari adapter sungguhan lahir, kalimat itu harus ikut berubah.
    ukur: () => /return null;/.test(baca('apps/kasir/src/cetak/aktif.ts')),
  },
  {
    id: 'service-charge-nol',
    berkas: 'CLAUDE.md',
    frasa: '`POST /orders` menulis literal `0` ke `service_charge_amount`',
    harap: true,
    ukur: () => {
      const s = baca('apps/server/src/modules/ordering/handlers/orders.ts');
      const sql = s.slice(s.indexOf('INSERT_ORDER_SQL'), s.indexOf('INSERT_CHECK_SQL'));
      // Kolomnya urutan ke-13 di daftar; nilainya literal `0` di VALUES.
      return /order_discount, service_charge_amount/.test(sql) && /\$18, 0,/.test(sql);
    },
  },
  {
    id: 'ppn-nol-di-fixture',
    berkas: 'docs/verifikasi/MONOKULTUR-FIXTURE.md',
    frasa: '**`ppn` tidak pernah muncul di satu pun fixture. Nol.**',
    harap: 0,
    // ⛔ Ini yang paling penting di registri: ia berubah menjadi bukan-nol
    // tepat pada hari gerbang K-06/K-07 dipenuhi, dan pada hari itu KEDUA
    // dokumen harus ikut berubah.
    // ⛔ Berkas INI dikecualikan. Versi pertama menghitung 1 — dan yang satu
    // itu adalah string `'ppn'` di dalam pengukurnya sendiri. Penjaga yang
    // mengukur dirinya sendiri melaporkan dunia yang ia ciptakan.
    ukur: () =>
      isiSemua(berkasSumber('tests', /\.js$/, { lewati: ['klaim-registri.test.js'] }))
        .join('\n')
        .split("'ppn'").length - 1,
  },
  {
    id: 'kasir-non-tunai',
    berkas: 'docs/verifikasi/MONOKULTUR-FIXTURE.md',
    frasa: '**4 dari 48 berkas test kasir**',
    harap: '4/48',
    ukur: () => {
      const semua = berkasSumber('tests/kasir', /\.test\.js$/);
      const nonTunai = semua.filter((f) =>
        /qris_static|card_edc|qris_dynamic/.test(fs.readFileSync(f, 'utf8'))
      );
      return `${nonTunai.length}/${semua.length}`;
    },
  },
  {
    id: 'empty-state-tanpa-antrean',
    berkas: 'docs/verifikasi/KELAS-GAGAL.md',
    frasa: '**Ukuran: 27 dari 42 berkas ber-`<EmptyState>`**',
    harap: '27/42',
    ukur: () => {
      const semua = berkasSumber('apps', /\.tsx$/).filter((f) =>
        fs.readFileSync(f, 'utf8').includes('<EmptyState')
      );
      const sebut = semua.filter((f) =>
        /sinkron|tersinkron|antrean/.test(fs.readFileSync(f, 'utf8'))
      );
      return `${semua.length - sebut.length}/${semua.length}`;
    },
  },
];

test('⛔ setiap klaim berangka masih benar terhadap kode', () => {
  const salah = [];
  for (const k of KLAIM) {
    const nyata = k.ukur();
    if (nyata !== k.harap) salah.push(`${k.id}: ditulis ${k.harap}, terukur ${nyata}`);
  }
  assert.deepEqual(
    salah,
    [],
    'Catatan berangka sudah basi. Perbaiki KALIMATNYA di berkas yang disebut, ' +
      'lalu `harap` di sini — atau hapus angkanya kalau ia tidak layak dijaga.\n  ' +
      salah.join('\n  ')
  );
});

test('⛔ setiap klaim masih ada di berkas yang registri sebut', () => {
  // Arah KEDUA. Tanpa test ini, kalimat yang disunting meninggalkan entri di
  // atas menjaga sesuatu yang tidak ada lagi — hijau selamanya, dan hijaunya
  // berarti "tidak ada yang diperiksa".
  const hilang = [];
  for (const k of KLAIM) {
    if (!baca(k.berkas).includes(k.frasa)) hilang.push(`${k.id}: "${k.frasa}" → ${k.berkas}`);
  }
  assert.deepEqual(
    hilang,
    [],
    'Frasa klaim tidak ditemukan lagi. Kalimatnya disunting tanpa registri ' +
      'ikut, dan entri di bawah ini kini menjaga hantu:\n  ' + hilang.join('\n  ')
  );
});

test('registri benar-benar mengukur sesuatu', () => {
  assert.ok(KLAIM.length >= 9, `registri hanya ${KLAIM.length} entri`);
  // Setiap pengukur wajib menyentuh berkas: `ukur()` yang mengembalikan
  // konstanta akan selalu cocok dengan `harap` dan tidak menjaga apa pun.
  for (const k of KLAIM) {
    assert.ok(typeof k.ukur === 'function', `${k.id} tanpa pengukur`);
    assert.doesNotThrow(() => k.ukur(), `${k.id}: pengukurnya melempar`);
  }
  // Pemindainya benar-benar melihat repo, bukan direktori kosong.
  assert.ok(berkasSumber('apps', /\.tsx?$/).length > 150, 'pemindai tidak melihat apa pun');
});
