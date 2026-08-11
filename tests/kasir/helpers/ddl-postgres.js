'use strict';

// Pembaca tipe kolom dari migrasi PostgreSQL, HANYA untuk test.
//
// Ia sengaja tidak tinggal di `apps/kasir`: aplikasi tidak pernah perlu tahu
// bentuk DDL server. Yang perlu tahu adalah penjaga yang membandingkan kedua
// skema, dan itu test.
//
// Parser ini bisa saja melewatkan kolom, dan kalau itu terjadi diam-diam
// penjaganya jadi hampa. Karena itu test pemakainya WAJIB memeriksa bahwa
// setiap kolom lokal ketemu padanannya di sini -- kegagalan membaca menjadi
// merah, bukan menjadi "tidak ada divergensi".

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', '..', 'db', 'migrations');

function buangKomentar(sql) {
  return sql
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((b) => b.replace(/--.*$/, ''))
    .join('\n');
}

function bagiKoma(isi) {
  const hasil = [];
  let dalam = 0;
  let kutip = false;
  let buf = '';
  for (const c of isi) {
    if (c === "'") kutip = !kutip;
    if (!kutip) {
      if (c === '(') dalam += 1;
      if (c === ')') dalam -= 1;
      if (c === ',' && dalam === 0) {
        hasil.push(buf);
        buf = '';
        continue;
      }
    }
    buf += c;
  }
  hasil.push(buf);
  return hasil;
}

const AWALAN_BATASAN = /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT|EXCLUDE|LIKE)\b/i;

/** `bigint NOT NULL DEFAULT 0` -> `bigint`; `numeric(6,4)` -> `numeric(6,4)`. */
function tipeSaja(sisa) {
  const m = /^((?:double precision|character varying|timestamp with time zone|[a-z]+)(?:\s*\([^)]*\))?(?:\s*\[\])?)/i.exec(
    sisa.trim()
  );
  return m ? m[1].replace(/\s+/g, ' ').toLowerCase() : null;
}

function bacaCreateTable(sql, keluaran) {
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const nama = m[1];
    let i = re.lastIndex;
    let dalam = 1;
    while (dalam > 0 && i < sql.length) {
      if (sql[i] === '(') dalam += 1;
      if (sql[i] === ')') dalam -= 1;
      i += 1;
    }
    keluaran[nama] = keluaran[nama] ?? {};
    for (const bagian of bagiKoma(sql.slice(re.lastIndex, i - 1))) {
      const t = bagian.trim();
      if (t.length === 0 || AWALAN_BATASAN.test(t)) continue;
      const nk = /^"?([a-z_]+)"?\s+([\s\S]+)$/i.exec(t);
      if (!nk) continue;
      const tipe = tipeSaja(nk[2]);
      if (tipe) keluaran[nama][nk[1]] = tipe;
    }
  }
}

function bacaAlterTable(sql, keluaran) {
  const re = /ALTER TABLE\s+(?:IF EXISTS\s+)?"?([a-z_]+)"?\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?\s+([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(sql))) {
    const tipe = tipeSaja(m[3]);
    if (!tipe) continue;
    keluaran[m[1]] = keluaran[m[1]] ?? {};
    keluaran[m[1]][m[2]] = tipe;
  }
}

/** `{ tabel: { kolom: tipe } }` gabungan seluruh migrasi, berurutan nomor. */
function tipeKolomPostgres() {
  const hasil = {};
  for (const berkas of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = buangKomentar(fs.readFileSync(path.join(DIR, berkas), 'utf8'));
    bacaCreateTable(sql, hasil);
    bacaAlterTable(sql, hasil);
  }
  return hasil;
}

/**
 * Kelas tipe yang kasar dengan sengaja.
 *
 * Yang dijaga bukan kesamaan nama tipe -- `bigint` dan `INTEGER` memang beda
 * nama dan itu tidak apa-apa. Yang dijaga adalah apakah nilainya sampai utuh.
 */
function kelasPostgres(tipe) {
  if (tipe.endsWith('[]')) return 'larik';
  if (/^numeric|^decimal|^real|^double/.test(tipe)) return 'desimal';
  if (/^(bigint|integer|int|smallint|serial|bigserial)\b/.test(tipe)) return 'bulat';
  if (/^bool/.test(tipe)) return 'bool';
  if (/^(timestamptz|timestamp)/.test(tipe)) return 'waktu';
  if (/^date\b/.test(tipe)) return 'tanggal';
  // `time` DIPISAH dari `timestamp`, meski keduanya sama-sama tiba sebagai
  // string. Alasannya bukan mekanisme melainkan BENTUK: timestamptz selalu
  // ISO-8601 penuh, sementara `time` dapat tiba "04:00" atau "04:00:00" dan
  // pembacanya harus menerima keduanya. Menggabungkannya ke `waktu` akan
  // menyembunyikan pertanyaan itu di bawah kelas yang sudah dinyatakan aman.
  //
  // Urutannya penting: cek ini HARUS setelah `timestamp`, karena
  // /^time/ juga cocok dengan `timestamptz`.
  if (/^time\b/.test(tipe)) return 'time';
  if (/^jsonb?\b/.test(tipe)) return 'json';
  if (/^(text|varchar|character|uuid|citext)/.test(tipe)) return 'teks';
  return `TAK-DIKENAL:${tipe}`;
}

function kelasLokal(tipe) {
  const t = tipe.toLowerCase();
  if (t.startsWith('integer')) return 'bulat';
  if (t.startsWith('text')) return 'teks';
  if (t.startsWith('real')) return 'desimal';
  if (t.startsWith('blob')) return 'blob';
  return `TAK-DIKENAL:${tipe}`;
}

/** Tipe kolom dari `db/local/001-initial.sql`, `{ tabel: { kolom: tipe } }`. */
function tipeKolomLokal() {
  const sql = buangKomentar(
    fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'db', 'local', '001-initial.sql'),
      'utf8'
    )
  );
  const hasil = {};
  bacaCreateTable(sql, hasil);
  return hasil;
}

module.exports = { tipeKolomPostgres, tipeKolomLokal, kelasPostgres, kelasLokal };
