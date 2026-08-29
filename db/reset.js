// Membuang database eksplorasi supaya `db:bootstrap` + `db:migrate` dapat
// membangunnya kembali dari nol.
//
// Jalankan:  npm run db:reset
//
// ## ⛔ Kenapa ini perlu ada sama sekali
//
// `db/bootstrap.js` IDEMPOTEN — ia melewati database yang sudah ada, dan
// `db/migrate.js` melewati migrasi yang sudah tercatat di `schema_migrations`.
// Keduanya benar. Konsekuensinya: tidak ada satu pun perintah di repo ini yang
// menghasilkan database BERSIH, dan "uji coba dari instalasi bersih" yang
// dijalankan di atas database lama menguji hal yang berbeda dari yang
// dimaksud — migrasi yang urutannya sudah tercatat tidak pernah benar-benar
// dijalankan lagi, jadi migrasi yang rusak tetap terlihat hijau.
//
// Yang paling sering menyembunyikan diri di sana adalah migrasi yang hanya
// benar terhadap data yang KEBETULAN ada di mesin pengembang.
//
// ## ⛔ Penjaga localhost, sejajar `tools/seed-explore.mjs`
//
// Berkas ini MENGHAPUS SELURUH DATA. Diarahkan ke database sungguhan ia
// menghapus penjualan merchant, dan tidak ada satu pun langkah di repo ini
// yang dapat mengembalikannya. Ia karena itu menolak berjalan kecuali
// databasenya jelas-jelas lokal, dan penolakannya keras.
//
// **Batas yang dinyatakan:** penjaganya adalah HOSTNAME, bukan isi database.
// Database lokal yang memuat pekerjaan eksplorasi berjam-jam akan dihapus
// tanpa pertanyaan — itu memang gunanya, dan itu sebabnya perintah ini tidak
// pernah dirangkai ke dalam perintah lain.
const { Client } = require('pg');

function parsePgUrl(str, label) {
  if (!str) throw new Error(`${label} tidak di-set di .env`);
  const u = new URL(str);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.slice(1)),
  };
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function pastikanLokal(host) {
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error(
      `Menolak jalan: database menunjuk "${host}", bukan localhost.\n` +
        'Perintah ini MENGHAPUS SELURUH DATA dan tidak dapat dibatalkan. ' +
        'Ia hanya untuk database eksplorasi di mesin sendiri.'
    );
  }
}

async function main() {
  const admin = parsePgUrl(process.env.DATABASE_ADMIN_URL, 'DATABASE_ADMIN_URL');
  const owner = parsePgUrl(process.env.DATABASE_MIGRATION_URL, 'DATABASE_MIGRATION_URL');

  pastikanLokal(admin.host);
  pastikanLokal(owner.host);

  const dbName = owner.database;
  if (!IDENTIFIER_RE.test(dbName)) {
    throw new Error(`Nama database "${dbName}" tidak valid.`);
  }

  const client = new Client({
    host: admin.host,
    port: admin.port,
    user: admin.user,
    password: admin.password,
    database: admin.database,
  });
  await client.connect();

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (rowCount === 0) {
      console.log(`Database "${dbName}" tidak ada — tidak ada yang dibuang.`);
      return;
    }

    // ⛔ Koneksi yang masih hidup membuat DROP ditolak `database is being
    // accessed by other users` — dan yang memegangnya biasanya server yang
    // lupa dimatikan di terminal lain. Pesan bawaan PostgreSQL tidak menyebut
    // siapa, jadi jumlahnya dicetak: "3 koneksi diputus" memberi tahu bahwa
    // ada sesuatu yang masih berjalan, sementara DROP yang diam-diam berhasil
    // tidak.
    const { rows } = await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName]
    );
    if (rows.length > 0) {
      console.log(`${rows.length} koneksi ke "${dbName}" diputus.`);
    }

    await client.query(`DROP DATABASE "${dbName}"`);
    console.log(`Database "${dbName}" dibuang.`);
    console.log('Lanjutkan dengan: npm run db:bootstrap && npm run db:migrate');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
