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
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

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
  for (const q of kueri()) {
    assert.equal(/\bcost\b/.test(q), false, `query membawa \`cost\`: ${q}`);
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

test('⛔ setiap query menyaring tenant', () => {
  // Sabotase prototipe 05 T5: satu klausa dilepas dari SATU baris, dan
  // katalog merchant lain mendarat di perangkat yang salah tanpa error.
  // Pemeriksaan harus menyentuh SETIAP query — kebocoran satu baris tidak
  // terlihat oleh pemeriksaan pada baris lain.
  for (const q of kueri()) {
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
