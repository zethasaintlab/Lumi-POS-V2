'use strict';

// Implementasi `DbLokal` di atas `node:sqlite`, untuk test.
//
// Ia sengaja memakai skema SUNGGUHAN dari db/local/001-initial.sql, bukan
// tabel outbox tiruan. Relay yang diuji terhadap skema tiruan tidak mengatakan
// apa pun tentang skema yang benar-benar dipakai perangkat.
//
// Port-nya async meski node:sqlite sinkron, karena PowerSync async. Test yang
// berjalan di atas port sinkron akan meloloskan bug urutan yang hanya muncul
// saat ada await di antara dua pernyataan.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SKEMA = path.join(__dirname, '..', '..', '..', 'db', 'local', '001-initial.sql');

function bungkus(sqlite) {
  const jalankan = (sql, params = []) => sqlite.prepare(sql).run(...params);

  const api = {
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      jalankan(sql, params);
    },
    async transaction(fn) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        // `fn` menerima objek yang SAMA. node:sqlite tidak punya koneksi
        // terpisah per transaksi, dan memalsukannya akan menyembunyikan
        // kesalahan pemakaian yang nyata di PowerSync.
        const hasil = await fn(api);
        sqlite.exec('COMMIT');
        return hasil;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api;
}

/** Database in-memory dengan skema lokal sungguhan terpasang. */
function buatDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(SKEMA, 'utf8'));
  const api = bungkus(sqlite);
  api.tutup = () => sqlite.close();
  return api;
}

/**
 * Database berbasis berkas — dipakai uji "bertahan melewati restart".
 * Menutup lalu membuka kembali berkas yang sama menirukan force-close
 * aplikasi; in-memory tidak dapat menguji itu sama sekali.
 */
function buatDbBerkas(berkas) {
  const baru = !fs.existsSync(berkas);
  const sqlite = new DatabaseSync(berkas);
  if (baru) sqlite.exec(fs.readFileSync(SKEMA, 'utf8'));
  const api = bungkus(sqlite);
  api.tutup = () => sqlite.close();
  return api;
}

module.exports = { buatDb, buatDbBerkas };
