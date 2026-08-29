'use strict';

// Penjaga sync rules — jalur turun.
//
// ⛔ `sync-config.yaml` adalah SATU-SATUNYA batas tenant di jalur turun.
// `powersync_role` punya BYPASSRLS dan replikasi logis membaca WAL, jadi RLS
// tidak berlaku sama sekali di sana. Tidak ada lapisan kedua.
//
// Berkas ini menjaga dua hal yang sudah pernah salah, dan yang keduanya tidak
// menghasilkan error apa pun saat salah:
//
//   1. `cost` turun ke setiap perangkat lewat `SELECT *` (FR-F5);
//   2. klausa tenant yang hilang dari satu baris (dibuktikan lewat sabotase
//      di prototipe 05 T5 — katalog merchant lain mendarat di perangkat yang
//      salah, tanpa satu pun error).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');

const KONFIG = resolve(__dirname, '../../prototypes/05-powersync-jalur-turun/powersync/sync-config.yaml');

/** Baris query saja — komentar dan konfigurasi dibuang. */
function kueri() {
  // ⛔ CRLF dinormalkan LEBIH DULU — pelajaran yang sudah tercatat di
  // `pecahPernyataan` (apps/kasir/src/lokal/skema.ts) dan yang saya ulangi di
  // sini: `#.*$` TIDAK PERNAH cocok pada baris berakhiran `\r`, karena `.` di
  // JavaScript tidak mencocokkan `\r` sehingga `$` tidak pernah tercapai.
  // Akibatnya seluruh komentar lolos ke dalam teks query, dan penjaga di
  // bawah membaca kata `cost` dari KOMENTAR yang menjelaskan kenapa `cost`
  // tidak ada.
  const teks = readFileSync(KONFIG, 'utf8').replace(/\r\n?/g, '\n');
  const baris = teks.split('\n');
  const hasil = [];
  let kini = null;
  for (const b of baris) {
    const bersih = b.replace(/#.*$/, '').trimEnd();
    if (/^\s+- SELECT/.test(bersih)) {
      if (kini) hasil.push(kini);
      kini = bersih.trim().replace(/^- /, '');
    } else if (kini && /^\s{6,}\S/.test(bersih) && !/^\s+-/.test(bersih)) {
      kini += ' ' + bersih.trim();
    } else if (kini && bersih.trim() === '') {
      hasil.push(kini);
      kini = null;
    }
  }
  if (kini) hasil.push(kini);
  return hasil;
}

test('parser benar-benar melihat query — bukan hijau karena kosong', () => {
  const q = kueri();
  assert.ok(q.length >= 10, `hanya ${q.length} query terbaca; parser kemungkinan rusak`);
  assert.ok(q.some((s) => /FROM item_variation/.test(s)));
  assert.ok(q.some((s) => /FROM "user"/.test(s)));
});

test('⛔ `cost` tidak pernah turun ke perangkat (FR-F5)', () => {
  // `spec-f:66`: "kolom dan field yang memuat cost/margin TIDAK ADA di
  // respons — bukan sekadar disembunyikan di UI." Sampai 14 Agustus 2026 ia
  // turun lewat `SELECT *`, dan tidak ada apa pun yang mengeluh.
  //
  // ⛔ POLANYA SUBSTRING, BUKAN `\bcost\b` — dan versi `\b` yang berdiri di
  // sini sampai 29 Agustus 2026 adalah penjaga yang BUTA terhadap satu-satunya
  // kolom cost yang tersisa di skema.
  //
  // `\bcost\b` TIDAK cocok dengan `cost_at_sale`: `_` adalah word character,
  // jadi batas kata sesudah `cost` tidak pernah tercapai. Diverifikasi dengan
  // menjalankannya, bukan dengan membacanya.
  //
  // Akibatnya, pada hari `order_line` masuk sync rules — hari ini — HPP setiap
  // produk akan turun ke setiap tablet di setiap outlet sementara penjaga ini
  // tetap hijau. FR-F5 ditutup 25 Agustus 2026 dan akan dibatalkan empat hari
  // kemudian oleh task yang tidak menyebut FR-F5 sama sekali.
  //
  // Substring karena itu yang benar: tidak ada satu pun kolom sah di skema ini
  // yang memuat kata `cost` dan boleh turun, dan penjaga yang menuntut
  // ketepatan nama akan dilewati oleh nama berikutnya (`unit_cost`,
  // `cost_method`, `avg_cost`).
  for (const q of kueri()) {
    assert.equal(
      /cost/i.test(q),
      false,
      `query membawa kolom ber-\`cost\` — INI kebocoran HPP ke perangkat: ${q}`
    );
  }
});

test('⛔ tabel yang punya kolom sensitif TIDAK boleh memakai SELECT *', () => {
  // `SELECT *` aman hanya selama tidak ada kolom sensitif di tabelnya — dan
  // itu jaminan yang berubah setiap kali seseorang menambah kolom. Untuk
  // tabel di bawah, kolomnya WAJIB ditulis satu per satu.
  const wajibEksplisit = ['item_variation', '"user"', 'outlet', 'price_history'];
  for (const q of kueri()) {
    for (const tabel of wajibEksplisit) {
      if (!new RegExp(`FROM ${tabel.replace(/"/g, '"')}\\b`).test(q)) continue;
      assert.equal(
        /SELECT \*/.test(q),
        false,
        `${tabel} wajib berkolom eksplisit, bukan SELECT *: ${q}`
      );
    }
  }
});

/**
 * Tabel mana yang PUNYA `tenant_id`, dibaca dari DDL server.
 *
 * ⛔ Diturunkan, bukan didaftar tangan. Aturan yang sebenarnya berlaku adalah
 * "setiap query atas tabel BER-TENANT menyaring tenant" — dan satu-satunya
 * sumber yang tahu tabel mana ber-tenant adalah skema itu sendiri.
 *
 * Daftar pengecualian yang ditulis tangan akan bertambah panjang setiap kali
 * seseorang menabrak penjaga ini, sampai ia tidak menjaga apa pun. Daftar
 * yang dibaca dari DDL bertambah hanya bila skemanya benar-benar berubah.
 */
function tabelBerTenant() {
  const dir = join(__dirname, '..', '..', 'db', 'migrations');
  const punya = new Set();
  for (const berkas of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, berkas), 'utf8').replace(/\r\n?/g, '\n');
    // `[^]` — "karakter apa pun", dipakai karena tidak butuh backslash yang
    // dapat hilang satu lapis (pelajaran dari helper uji-cetak).
    for (const m of sql.matchAll(/CREATE TABLE\s+"?(\w+)"?\s*\(([^]*?)\n\)/g)) {
      if (/\btenant_id\b/.test(m[2])) punya.add(m[1]);
    }
    // `ALTER TABLE x ADD COLUMN tenant_id` juga menjadikannya ber-tenant.
    for (const m of sql.matchAll(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+tenant_id/g)) {
      punya.add(m[1]);
    }
  }
  return punya;
}

/**
 * Nama tabel yang di-`FROM` sebuah query.
 *
 * ⛔ `\bFROM` — batas kata di DEPAN wajib, dan tanpanya penjaga tenant
 * melewatkan satu query sepenuhnya.
 *
 * Versi tanpa `\b` mencocokkan potongan `from` di dalam **nama kolom**.
 * `price_history` diseleksi dengan `effective_from` sebagai kolom terakhir,
 * jadi regexnya menemukan `from` di ujung nama kolom itu, lalu menangkap kata
 * `FROM` berikutnya sebagai nama tabel. `tabelDari` mengembalikan `"FROM"`,
 * `"FROM"` tidak ada di daftar tabel ber-tenant, dan query itu **dilewati**
 * oleh penjaga yang seharusnya memeriksanya.
 *
 * Hari ini `price_history` memang menyaring tenant, jadi tidak ada yang bocor.
 * Yang tidak ada adalah penjaganya: klausa itu dapat dihapus dan seluruh suite
 * tetap hijau — bentuk kegagalan yang sama persis dengan sabotase T5 prototipe
 * 05, hanya saja kali ini penjaganya sendiri yang buta.
 *
 * Ditemukan 29 Agustus 2026 saat menambahkan stream `riwayat`, dengan mencetak
 * apa yang parser LIHAT alih-alih memercayai bahwa suite hijau berarti suite
 * memeriksa.
 */
function tabelDari(q) {
  const m = /\bFROM\s+"?(\w+)"?/i.exec(q);
  return m ? m[1] : null;
}

test('⛔ pengekstrak nama tabel tidak tertipu kolom berakhiran `_from`', () => {
  // Penjaga untuk penjaga. Kalau `\b` hilang lagi, yang gagal adalah test ini
  // — dengan kalimat yang menyebut sebabnya — bukan penjaga tenant yang
  // diam-diam berhenti memeriksa satu baris.
  assert.equal(
    tabelDari('SELECT id, effective_from FROM price_history WHERE x = 1'),
    'price_history'
  );
  assert.equal(tabelDari('SELECT * FROM item WHERE x = 1'), 'item');
  assert.equal(tabelDari('SELECT c.id FROM "check" c JOIN "order" o ON o.id = c.order_id'), 'check');
});

test('⛔ setiap query di berkas menghasilkan nama tabel yang dikenal DDL', () => {
  // Nama tabel yang tidak dapat diekstrak menghasilkan `null` atau kata kunci
  // SQL, dan keduanya membuat penjaga tenant di bawah melewatinya diam-diam.
  // Yang dijaga di sini: setiap query benar-benar teridentifikasi.
  const KATA_KUNCI = new Set(['from', 'select', 'where', 'join', 'on']);
  for (const q of kueri()) {
    const t = tabelDari(q);
    assert.ok(t, `nama tabel tidak dapat diekstrak: ${q}`);
    assert.equal(
      KATA_KUNCI.has(t.toLowerCase()),
      false,
      `nama tabel terbaca sebagai kata kunci SQL "${t}" — penjaga tenant akan melewati query ini: ${q}`
    );
  }
});

test('pembaca DDL benar-benar menemukan tabel ber-tenant', () => {
  const t = tabelBerTenant();
  assert.ok(t.size > 15, `hanya ${t.size} tabel ber-tenant terbaca; pembaca DDL rusak`);
  for (const wajib of ['item', 'order', 'tax_rate', 'user']) {
    assert.ok(t.has(wajib), `${wajib} seharusnya ber-tenant`);
  }
  // Dan tabel referensi global TIDAK boleh ikut terbaca sebagai ber-tenant —
  // kalau ia ikut, penjaga di bawah menuntut sesuatu yang mustahil.
  assert.equal(t.has('printer_profile'), false, 'printer_profile bukan tabel ber-tenant');
});

test('⛔ setiap query atas tabel BER-TENANT menyaring tenant', () => {
  // Sabotase prototipe 05 T5: satu klausa dilepas dari SATU baris, dan
  // katalog merchant lain mendarat di perangkat yang salah tanpa error.
  // Pemeriksaan harus menyentuh SETIAP query — kebocoran satu baris tidak
  // terlihat oleh pemeriksaan pada baris lain.
  //
  // ⛔ Yang dikecualikan hanya tabel yang MEMANG tidak punya `tenant_id`,
  // dan itu dibaca dari DDL. `printer_profile` adalah satu-satunya sekarang:
  // `db/migrations/0012` menyebutnya "data referensi hardware global" dan
  // membebaskannya dari RLS. Tabel tanpa tenant tidak dapat bocor antar
  // tenant — tidak ada yang tenant-spesifik di dalamnya.
  const berTenant = tabelBerTenant();
  for (const q of kueri()) {
    const tabel = tabelDari(q);
    if (tabel && !berTenant.has(tabel)) continue;
    assert.match(
      q,
      /auth\.parameter\('tenant_id'\)/,
      `query tanpa klausa tenant — INI kebocoran lintas merchant: ${q}`
    );
  }
});

test('⛔ klaim yang dipakai adalah `auth.parameter`, tidak pernah `subscription.parameter`', () => {
  const teks = readFileSync(KONFIG, 'utf8');
  const baris = teks.split('\n').filter((b) => !/^\s*#/.test(b));
  // `subscription.parameter(...)` membawa klaim dari klien yang TIDAK
  // diverifikasi. Namanya sendiri sudah memperingatkan, dan memakainya untuk
  // batas tenant berarti membiarkan perangkat memilih tenant mana yang
  // diunduhnya.
  assert.equal(
    baris.some((b) => /subscription\.parameter/.test(b)),
    false,
    'batas tenant tidak boleh memakai klaim yang tidak diverifikasi'
  );
});

test('data yang di-scope per outlet benar-benar disaring per outlet', () => {
  // `spec-f:250`: "Perangkat hanya mereplikasi data outletnya. Perangkat
  // curian tidak memberi akses ke outlet lain, apalagi tenant lain."
  const perOutlet = ['"user"', 'user_role', 'user_outlet', 'outlet'];
  for (const q of kueri()) {
    for (const tabel of perOutlet) {
      if (!new RegExp(`FROM ${tabel}\\b`).test(q) && !new RegExp(`JOIN ${tabel}\\b`).test(q)) continue;
      assert.match(q, /auth\.parameter\('outlet_id'\)/, `${tabel} harus disaring per outlet: ${q}`);
    }
  }
});
