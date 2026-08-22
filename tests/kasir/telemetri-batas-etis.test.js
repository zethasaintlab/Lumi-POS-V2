'use strict';

// ⛔ BATAS ETIS — `ARCH:309`, ditegakkan pada JALUR PEMANGGIL.
//
// *"Tidak pernah mengirim nama produk, harga, nilai transaksi, data
// pelanggan, atau nama merchant. Metrik dan tipe error saja."*
//
// `bersihkanPeristiwa` sudah membuang apa pun yang bukan angka, dan endpoint
// server menolaknya lagi. Yang TIDAK dijaga keduanya adalah slot `tipe`: ia
// memang string, dan string apa pun lolos. Pesan error yang diteruskan ke
// sana ("Kopi Susu tidak ditemukan") memuat nama produk, dan tidak satu pun
// lapisan di bawah dapat mengetahuinya.
//
// Penjaga ini karena itu membaca KODE PEMANGGILNYA, bukan datanya.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.join(__dirname, '..', '..', 'apps', 'kasir', 'src');

function berkasSumber(dir) {
  const hasil = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) hasil.push(...berkasSumber(p));
    else if (/\.tsx?$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

/** Memisah argumen tingkat atas dari teks di dalam `catat( ... )`. */
function bagiArgumen(isi) {
  const hasil = [];
  let dalam = 0;
  let kutip = null;
  let buf = '';
  for (let i = 0; i < isi.length; i += 1) {
    const c = isi[i];
    if (kutip) {
      if (c === kutip && isi[i - 1] !== '\\') kutip = null;
    } else if (c === "'" || c === '"' || c === '`') {
      kutip = c;
    } else if ('([{'.includes(c)) {
      dalam += 1;
    } else if (')]}'.includes(c)) {
      dalam -= 1;
    } else if (c === ',' && dalam === 0) {
      hasil.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim() !== '') hasil.push(buf.trim());
  return hasil;
}

/**
 * Membuang komentar sebelum pemindaian.
 *
 * ⛔ Diperlukan, bukan kerapian: berkas telemetri sendiri MENJELASKAN
 * `catat()` di komentarnya, dan penjaga yang membacanya menuntut komentar
 * memenuhi aturan yang ditulis untuk kode.
 */
function buangKomentar(isi) {
  return isi
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((b) => !/^\s*(\/\/|\*)/.test(b))
    .join('\n');
}

/** Setiap pemanggilan `catat(...)` di seluruh `apps/kasir/src`. */
function panggilanCatat() {
  const hasil = [];
  for (const berkas of berkasSumber(AKAR)) {
    const isi = buangKomentar(fs.readFileSync(berkas, 'utf8'));
    // ⛔ HANYA berkas yang benar-benar mengimpor `catat` dari sink telemetri.
    // `apps/kasir/src/harness/uji.ts` punya fungsi LOKAL bernama sama, dan
    // penjaga yang mencocokkan nama saja akan menuntut harness browser
    // memenuhi aturan yang tidak berlaku untuknya — lalu dimatikan orang
    // berikutnya karena ia menandai kode yang benar.
    if (!/import \{[^}]*\bcatat\b[^}]*\} from '[^']*sink\.ts'/.test(isi)) continue;
    const re = /\bcatat\(/g;
    let m;
    while ((m = re.exec(isi))) {
      let i = m.index + m[0].length;
      let dalam = 1;
      let kutip = null;
      while (i < isi.length && dalam > 0) {
        const c = isi[i];
        if (kutip) {
          if (c === kutip && isi[i - 1] !== '\\') kutip = null;
        } else if (c === "'" || c === '"' || c === '`') kutip = c;
        else if (c === '(') dalam += 1;
        else if (c === ')') dalam -= 1;
        i += 1;
      }
      const teks = isi.slice(m.index + m[0].length, i - 1);
      hasil.push({ berkas: path.relative(AKAR, berkas), teks, arg: bagiArgumen(teks) });
    }
  }
  return hasil;
}

// ---------------------------------------------------------------------------

test('penjaga ini benar-benar menemukan pemanggilnya', async () => {
  // Penjaga yang parsernya usang akan hijau karena TIDAK MENEMUKAN APA PUN,
  // dan itu kelas kegagalan yang paling mahal di repo ini.
  const p = panggilanCatat();
  assert.ok(p.length >= 5, `hanya ${p.length} pemanggilan catat() yang terbaca`);
});

test('⛔ argumen pertama selalu literal dari daftar TERTUTUP', async () => {
  const { EVENT_TELEMETRI } = await import('../../packages/domain/src/telemetri.ts');
  // Nama event yang dihitung saat runtime membuat daftar tertutup itu tidak
  // dapat diperiksa siapa pun dengan membaca kode — dan daftar tertutup yang
  // tidak dapat dibaca bukan daftar tertutup.
  for (const p of panggilanCatat()) {
    const m = /^'([a-z_]+)'$/.exec(p.arg[0] ?? '');
    assert.ok(m, `${p.berkas}: argumen pertama bukan literal — \`${p.arg[0]}\``);
    assert.ok(
      EVENT_TELEMETRI.includes(m[1]),
      `${p.berkas}: event '${m[1]}' tidak ada di EVENT_TELEMETRI`
    );
  }
});

test('⛔ tidak satu pun pemanggil mengoper `.message`', async () => {
  // Vektor kebocoran yang paling mungkin, dan yang paling tidak terlihat:
  // `e.message` printer memuat konteks perangkat, `e.message` stok memuat
  // NAMA PRODUK. Yang boleh dikirim adalah `e.name`.
  for (const p of panggilanCatat()) {
    assert.ok(
      !/\.message\b/.test(p.teks),
      `${p.berkas}: \`.message\` dioper ke telemetri — pakai \`.name\`.\n  catat(${p.teks})`
    );
  }
});

test('⛔ slot `tipe` hanya literal atau `.name` — tidak ada string yang dirakit', async () => {
  // Template literal adalah tempat nama produk masuk: `${item.nama} habis`
  // terlihat seperti label kategori sampai dibaca.
  for (const p of panggilanCatat()) {
    const tipe = p.arg[2];
    if (tipe === undefined) continue;
    assert.ok(!tipe.includes('`'), `${p.berkas}: template literal di slot tipe — \`${tipe}\``);
    // `name` adalah satu-satunya yang DIKIRIM; `error` dan `reason` hanya
    // membuka pembungkus DOM (`ErrorEvent`, `PromiseRejectionEvent`) untuk
    // sampai ke sana. Tidak ada properti lain yang dijamin bebas teks.
    const IZIN = new Set(['name', 'error', 'reason']);
    const properti = [...tipe.matchAll(/\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    const asing = properti.filter((n) => !IZIN.has(n));
    assert.deepEqual(
      asing,
      [],
      `${p.berkas}: slot tipe membaca properti selain \`.name\`: ${asing.join(', ')}\n  ${tipe}`
    );
  }
});

test('⛔ nilai tidak pernah literal string', async () => {
  // `catat('crash', '1')` akan dibuang diam-diam oleh `bersihkanPeristiwa` —
  // metrik yang tidak pernah ada, tanpa satu pun error di mana pun.
  for (const p of panggilanCatat()) {
    const nilai = p.arg[1] ?? '';
    assert.ok(
      !/^['"`]/.test(nilai),
      `${p.berkas}: nilai berupa string — \`${nilai}\``
    );
  }
});
