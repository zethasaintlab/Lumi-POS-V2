'use strict';

// PowerSync menolak raw table tanpa kolom bernama `id`:
//
//   Table item_modifier_list has no id column.
//
// Bukan konvensi kami -- ekstensi core yang menolaknya
// (`InferredTableStructure::read_from_database`), diukur di
// prototypes/04-powersync-raw-tables (T1g). `item_modifier_list` adalah
// katalog: ia HARUS turun ke perangkat, dan tanpa `id` ia tidak dapat
// direplikasi sama sekali -- kasir tidak akan melihat modifier apa pun.
//
// Yang dijaga test ini bukan kolom `id`-nya. Yang dijaga adalah apa yang
// HILANG saat primary key pindah ke sana:
//
//   PRIMARY KEY (item_id, modifier_list_id)
//
// adalah satu-satunya yang menjamin satu item tidak menunjuk modifier list
// yang sama dua kali. Memindahkannya tanpa pengganti menukar satu masalah
// PowerSync dengan satu cacat data -- satu item dengan dua baris "Tingkat
// gula", dan kasir melihat daftar modifier ganda.
//
// `ux_item_modifier_list_pair` adalah penggantinya, dan ia juga yang membuat
// `ON CONFLICT (item_id, modifier_list_id) DO UPDATE` di handler tetap
// valid; tanpanya PostgreSQL menolak klausa itu dan attach-ulang untuk
// mengubah sortOrder patah.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { connectAsOwner } = require('../isolation/helpers/db');

let owner;

before(async () => {
  owner = await connectAsOwner();
});

after(async () => {
  await owner.end();
});

test('item_modifier_list punya kolom id, text NOT NULL', async () => {
  const { rows } = await owner.query(
    `SELECT data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'item_modifier_list' AND column_name = 'id'`
  );
  assert.equal(rows.length, 1, 'kolom id tidak ditemukan di item_modifier_list');
  assert.equal(rows[0].data_type, 'text');
  assert.equal(rows[0].is_nullable, 'NO', 'id harus NOT NULL -- PowerSync memakainya sebagai kunci baris');
});

test('primary key item_modifier_list adalah (id) saja', async () => {
  const { rows } = await owner.query(
    `SELECT a.attname
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = 'item_modifier_list' AND c.contype = 'p'
      ORDER BY k.ord`
  );
  assert.deepEqual(
    rows.map((r) => r.attname),
    ['id'],
    'primary key harus pindah ke id -- PK komposit tidak diterima PowerSync'
  );
});

test('ux_item_modifier_list_pair menjaga pasangan (item_id, modifier_list_id) tetap unik', async () => {
  const { rows } = await owner.query(
    `SELECT a.attname
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = 'item_modifier_list'
        AND c.contype = 'u'
        AND c.conname = 'ux_item_modifier_list_pair'
      ORDER BY k.ord`
  );
  assert.deepEqual(
    rows.map((r) => r.attname),
    ['item_id', 'modifier_list_id'],
    'constraint unik pengganti PK lama tidak ada -- relasi ganda jadi mungkin'
  );
});

// Yang membuktikan constraint di atas benar-benar MENAHAN, bukan sekadar
// terdaftar di katalog sistem. Test bentuk saja lolos untuk constraint yang
// ada tapi tidak pernah dievaluasi.
test('INSERT pasangan ganda ditolak database, bukan hanya oleh aplikasi', async () => {
  const suffix = `imlid-${Date.now()}`;
  await owner.query('BEGIN');
  try {
    // Kolom NOT NULL tanpa default disebut lengkap. Versi pertama test ini
    // hanya mengirim (id, name) dan gagal atas `plan` -- gagal karena
    // fixture-nya, bukan karena constraint yang diuji. Kegagalan yang salah
    // pada test yang belum hijau terbaca seperti kegagalan yang benar.
    await owner.query(
      `INSERT INTO tenant (id, name, plan, status, deployment_mode)
       VALUES ($1, 'Uji pair unik', 'standard', 'active', 'cloud')`,
      [suffix]
    );
    // `tenant` sendiri RLS-exempt; seluruh tabel di bawahnya tidak. Owner pun
    // tunduk -- FORCE ROW LEVEL SECURITY berlaku untuk pemilik tabel juga
    // (invariant #8), jadi tanpa baris ini INSERT berikutnya gagal atas
    // "unrecognized configuration parameter", bukan atas constraint.
    await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [suffix]);
    await owner.query(`INSERT INTO category (id, tenant_id, name) VALUES ($1, $2, 'Kopi')`, [
      `cat-${suffix}`,
      suffix,
    ]);
    await owner.query(
      `INSERT INTO item (id, tenant_id, name, category_id) VALUES ($1, $2, 'Kopi Susu', $3)`,
      [`itm-${suffix}`, suffix, `cat-${suffix}`]
    );
    await owner.query(
      `INSERT INTO modifier_list (id, tenant_id, name, selection_type) VALUES ($1, $2, 'Gula', 'single')`,
      [`ml-${suffix}`, suffix]
    );

    await owner.query(
      `INSERT INTO item_modifier_list (id, tenant_id, item_id, modifier_list_id, sort_order)
       VALUES ($1, $2, $3, $4, 0)`,
      [`iml-a-${suffix}`, suffix, `itm-${suffix}`, `ml-${suffix}`]
    );

    // id BERBEDA, pasangan SAMA. Inilah yang dulu mustahil karena PK komposit
    // dan kini hanya ditahan constraint unik.
    await assert.rejects(
      owner.query(
        `INSERT INTO item_modifier_list (id, tenant_id, item_id, modifier_list_id, sort_order)
         VALUES ($1, $2, $3, $4, 1)`,
        [`iml-b-${suffix}`, suffix, `itm-${suffix}`, `ml-${suffix}`]
      ),
      (err) => err.constraint === 'ux_item_modifier_list_pair',
      'pasangan ganda tersimpan -- satu item dapat menunjuk modifier list yang sama dua kali'
    );
  } finally {
    await owner.query('ROLLBACK');
  }
});

// ---------------------------------------------------------------------------
// Penjaga: setiap PRIMARY KEY tekstual di skema lokal wajib NOT NULL
// ---------------------------------------------------------------------------

/* ⛔ Predikat per-KOLOM, bukan per-baris.
 *
 * Versi pertama penjaga ini memakai predikat per-BARIS:
 *
 *     if (!/\bTEXT\s+PRIMARY\s+KEY/i.test(bersih)) continue;
 *     if (/\bNOT\s+NULL\b/i.test(bersih)) continue;   // ← celahnya
 *
 * Baris kedua memaafkan SELURUH BARIS bila ada `NOT NULL` di mana pun padanya,
 * dan 16 dari 17 tabel menulis primary key-nya sebaris dengan kolom lain:
 *
 *     id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
 *
 * `NOT NULL` di sana milik `tenant_id` dan `name`. Penjaga membacanya sebagai
 * milik `id`, melaporkan NOL pelanggar, dan memaafkan 17 tabel. `item_image`
 * tertangkap hanya karena `id`-nya kebetulan berdiri sendiri di barisnya —
 * bukan karena penjaganya lebih teliti untuk tabel itu.
 *
 * ⛔ Pemecah kolomnya DIIMPOR, tidak ditulis ulang. `bagiKolom` dan
 * `AWALAN_BATASAN` di `apps/kasir/src/lokal/skema.ts` adalah fungsi yang SAMA
 * yang `batasanNotNull` pakai, dan `batasanNotNull` sudah akurat per kolom
 * sejak lahir. Pemecah kedua akan menyimpang dari yang pertama, dan yang
 * menyimpang menghasilkan penjaga yang tidak sepakat dengan sidik jari skema
 * tentang kolom mana yang `NOT NULL`.
 *
 * Node 24.7 melucuti tipe secara bawaan, jadi `.ts` dapat diimpor dari berkas
 * CJS ini tanpa flag apa pun dan tanpa mengubah `test:schema`.
 */
async function pelanggarPk(sqlText) {
  const { pecahPernyataan, bagiKolom, batasanNotNull, AWALAN_BATASAN } = await import(
    '../../apps/kasir/src/lokal/skema.ts'
  );

  const baris = sqlText.replace(/\r\n?/g, '\n').split('\n');
  const wajib = batasanNotNull(sqlText);
  const hasil = [];

  for (const p of pecahPernyataan(sqlText)) {
    const m = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?\s*\(/i.exec(p);
    if (!m) continue;
    const tabel = m[1];

    for (const bagian of bagiKolom(p.slice(p.indexOf('(') + 1, p.lastIndexOf(')')))) {
      const d = bagian.trim();
      // Batasan tingkat tabel — `PRIMARY KEY (a, b)` — bukan kolom.
      if (d.length === 0 || AWALAN_BATASAN.test(d)) continue;
      if (!/\bPRIMARY\s+KEY\b/i.test(d)) continue;
      // ⛔ `INTEGER PRIMARY KEY` dikecualikan dan itu BUKAN kelonggaran: ia
      // alias rowid, dan SQLite mengisinya otomatis — NULL di sana mustahil.
      if (/\bINTEGER\s+PRIMARY\s+KEY\b/i.test(d)) continue;

      const nama = /^"?([a-z_]+)"?/i.exec(d);
      if (!nama) continue;
      if ((wajib[tabel] ?? []).includes(nama[1])) continue;

      // Nomor baris untuk daftar kerja: baris pertama tabel ini yang menyebut
      // PRIMARY KEY. Ia keperluan LAPORAN, bukan bagian dari penilaian.
      const mulai = baris.findIndex((b) =>
        new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?"?${tabel}"?\\s*\\(`, 'i').test(b)
      );
      const pkBaris = baris.findIndex((b, i) => i >= mulai && /\bPRIMARY\s+KEY\b/i.test(b.replace(/--.*$/, '')));
      hasil.push({ tabel, baris: pkBaris + 1, kolom: nama[1], definisi: d.replace(/\s+/g, ' ') });
    }
  }
  return hasil;
}

const SKEMA = () =>
  readFileSync(resolve(__dirname, '../../db/local/001-initial.sql'), 'utf8').replace(/\r\n?/g, '\n');

/**
 * Garis dasar: pelanggar yang SUDAH DIKETAHUI dan sedang menunggu keputusan.
 *
 * ⛔ INI BUKAN DAFTAR PENGECUALIAN, dan bedanya bukan istilah. Daftar
 * pengecualian MEMAAFKAN — test hijau meski pelanggarnya ada. Daftar ini tidak
 * memaafkan apa pun: testnya tetap MERAH untuk kelima nama di bawah. Yang
 * diputuskan daftar ini hanya KALIMAT MANA yang dicetak.
 *
 * ⛔ Kenapa pembedaan itu perlu ada sama sekali: `test:schema` akan merah
 * selama keputusan produk atas kelima tabel ini belum diambil, dan itu bisa
 * lama. Merah yang selalu berbunyi sama adalah merah yang orang berhenti baca
 * — dan pada hari tabel ke-38 ditambahkan tanpa `NOT NULL`, tidak seorang pun
 * akan melihat bedanya. Pelanggar baru karena itu menghasilkan kalimat yang
 * BERBEDA, yang menyebut namanya, dan yang melarang namanya ditambahkan ke
 * sini.
 *
 * ⛔ Jangan menambah nama ke daftar ini untuk membuat pesan jadi tenang.
 * Kelima ini ada di sini karena ongkos perbaikannya sudah dipetakan dan
 * ditolak untuk sementara, bukan karena ia merepotkan:
 *
 *   - `stock_movement`, `cash_drawer_shift`, `cash_movement`, `audit_event`
 *     raw table yang TIDAK ada di sync rules jalur turun. Rebuild membuangnya
 *     tanpa jalan pulang.
 *   - `outbox_local` murni lokal, memegang antrean penjualan yang belum
 *     terkirim, dan `rencanaDdl` sengaja tidak punya jalur untuk men-drop
 *     tabel semacam itu.
 *
 * Nama yang SUDAH diperbaiki juga wajib dihapus dari sini, dan testnya
 * mengatakannya: garis dasar yang lebih panjang daripada kenyataan diam-diam
 * memaafkan tabel yang kelak memakai nama itu lagi.
 */
const PELANGGAR_DIKETAHUI = [
  'stock_movement',
  'cash_drawer_shift',
  'cash_movement',
  'audit_event',
  'outbox_local',
];

/**
 * Batas atas garis dasar — daftar yang hanya boleh MENYUSUT.
 *
 * ⛔ Salinan kedua, dan duplikasinya disengaja. Tanpa ia, `PELANGGAR_DIKETAHUI`
 * adalah daftar pengecualian biasa: siapa pun yang menambahkan tabel ke-38
 * tanpa `NOT NULL` dapat menenangkan testnya dengan menambahkan satu baris ke
 * sana, dan diff-nya terbaca seperti pemeliharaan rutin.
 *
 * Dengan ia, menambah nama menuntut penyuntingan DUA daftar di berkas test ini,
 * dan yang kedua ini berjudul "tidak boleh bertambah". Penjaga tidak dapat
 * mencegah orang mengetik; yang dapat ia lakukan adalah membuat penambahannya
 * mustahil terjadi tanpa disengaja, dan mustahil terbaca sebagai hal lain oleh
 * peninjau.
 *
 * Menyusut tidak menuntut apa pun: nama yang dihapus dari `PELANGGAR_DIKETAHUI`
 * boleh tetap tinggal di sini sebagai catatan bahwa ia pernah ada.
 */
const GARIS_DASAR_TERKUNCI = Object.freeze([
  'stock_movement',
  'cash_drawer_shift',
  'cash_movement',
  'audit_event',
  'outbox_local',
]);

// ---------------------------------------------------------------------------

test('⛔ penjaga PK membedakan NOT NULL milik PK dari milik kolom TETANGGA', async () => {
  /* ⛔ SENTINEL, dan bentuknya dipilih setelah sentinel lama terbukti tidak
     menguji apa pun. Yang lama menghitung baris yang cocok `TEXT PRIMARY KEY`
     dan menuntut `>= 25`. Ia membuktikan penjaga MEMINDAI sesuatu; ia tidak
     membuktikan penjaga dapat MEMBEDAKAN — dan justru ketidakmampuan
     membedakan itulah cacatnya. Ia hijau sepanjang 17 tabel dimaafkan.

     Yang diuji sekarang kemampuannya: dua definisi buatan dengan bentuk yang
     SAMA PERSIS kecuali pada satu hal yang menentukan. Penjaga yang per-baris
     menilai keduanya bersih; penjaga yang per-kolom memisahkannya. */
  const AMAN = `CREATE TABLE uji_aman (
  id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL
);`;
  const CACAT = `CREATE TABLE uji_tetangga (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL
);`;

  assert.deepEqual(
    await pelanggarPk(AMAN),
    [],
    '`id TEXT NOT NULL PRIMARY KEY` ditandai pelanggar — penjaga menuduh kolom yang benar'
  );

  const cacat = await pelanggarPk(CACAT);
  assert.equal(
    cacat.length,
    1,
    '`id TEXT PRIMARY KEY` dengan NOT NULL milik tetangga TIDAK ditandai — ' +
      'penjaga membaca per baris, bukan per kolom, dan itu tepat celah yang ' +
      `memaafkan 17 tabel. Hasil: ${JSON.stringify(cacat)}`
  );
  assert.equal(cacat[0].tabel, 'uji_tetangga');
  assert.equal(cacat[0].kolom, 'id');

  /* ⛔ Batasan tingkat tabel bukan kolom, dan penjaga yang menghitungnya akan
     menandai `stock_snapshot` sebagai kolom bernama "PRIMARY". */
  assert.deepEqual(
    await pelanggarPk(`CREATE TABLE uji_komposit (
  tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, outlet_id)
);`),
    [],
    'PRIMARY KEY tingkat tabel dibaca sebagai kolom'
  );

  /* ⛔ `INTEGER PRIMARY KEY` adalah alias rowid — SQLite mengisinya sendiri. */
  assert.deepEqual(
    await pelanggarPk('CREATE TABLE uji_rowid (id INTEGER PRIMARY KEY CHECK (id = 1), nilai TEXT);'),
    [],
    'INTEGER PRIMARY KEY ditandai pelanggar — ia alias rowid, NULL mustahil di sana'
  );
});

test('⛔ garis dasar PK hanya boleh MENYUSUT, tidak pernah bertambah', () => {
  /* ⛔ Penjaga atas penjaga. Yang ia jaga bukan skema melainkan DAFTARNYA.
     Ratchet yang daftarnya boleh tumbuh bukan ratchet — ia daftar pengecualian
     dengan nama yang lebih baik, dan daftar pengecualian yang tumbuh adalah
     persis bentuk yang membuat 17 tabel dimaafkan selama berminggu-minggu. */
  const asing = PELANGGAR_DIKETAHUI.filter((t) => !GARIS_DASAR_TERKUNCI.includes(t));
  assert.deepEqual(
    asing,
    [],
    '⛔ Nama ini ditambahkan ke `PELANGGAR_DIKETAHUI` dan TIDAK ada di garis dasar ' +
      `terkunci: ${asing.join(', ')}.\n\n` +
      'Garis dasar hanya boleh menyusut. Tabel baru yang PRIMARY KEY tekstualnya ' +
      'tanpa `NOT NULL` diperbaiki di skemanya, bukan didaftarkan di sini — ' +
      'mendaftarkannya mengubah ratchet menjadi daftar pengecualian, dan test ' +
      'yang memaafkan pelanggaran berikutnya tidak menjaga apa pun.'
  );

  assert.ok(
    PELANGGAR_DIKETAHUI.length <= GARIS_DASAR_TERKUNCI.length,
    `⛔ Garis dasar berisi ${PELANGGAR_DIKETAHUI.length} nama, lebih banyak daripada ` +
      `${GARIS_DASAR_TERKUNCI.length} yang terkunci. Ia hanya boleh menyusut.`
  );
});

test('⛔ pelanggar PK skema lokal tepat sama dengan garis dasar, tidak lebih dan tidak kurang', async (t) => {
  // ⛔ SQLite MENERIMA NULL di kolom PRIMARY KEY pada tabel rowid — bug lama
  // yang dipertahankan demi kompatibilitas, dan satu-satunya penawarnya adalah
  // menulis `NOT NULL` sendiri.
  //
  // Akibat kalau lupa: baris ber-id NULL diterima di perangkat sementara
  // PostgreSQL menolaknya, dan selisihnya baru terlihat saat sync — jauh dari
  // tempat dan waktu penyebabnya. PowerSync menuntut kolom `id` pada setiap
  // raw table justru karena identitas baris adalah fondasi replikasinya.
  //
  /* ⛔ RATCHET, dan sampai 21 September 2026 ia assertion mutlak yang MERAH
     permanen.

     Perubahannya bukan pelonggaran, dan bedanya perlu dinyatakan. Yang lama
     menuntut NOL pelanggar; karena kelima tabel itu menunggu keputusan produk
     yang bisa lama, `test:schema` merah di setiap run, selamanya. Merah
     permanen punya satu akibat yang dapat diramalkan: orang berhenti membacanya,
     lalu berhenti melihatnya, dan pada hari tabel ke-38 ditambahkan tanpa
     `NOT NULL` merahnya tidak membawa informasi apa pun. PR juga tidak dapat
     di-merge, dan merge paksa memindahkan merah permanen itu ke `main`.

     Yang dituntut sekarang KESAMAAN PERSIS dengan garis dasar — dan itu lebih
     ketat daripada "nol pelanggar baru" di satu arah yang penting: garis dasar
     yang tertinggal lebih panjang daripada kenyataan juga MERAH. Tanpa arah
     itu, nama yang sudah diperbaiki tetap tinggal di daftar dan diam-diam
     memaafkan tabel berikutnya yang memakai nama itu lagi.

     ⛔ Hijau di sini TIDAK berarti selesai, dan pesannya mengatakan itu lewat
     `t.diagnostic` — hijau yang diam tidak dapat dibedakan dari hijau yang
     benar-benar bersih. Kelima nama tetap tercetak di setiap run.

     Jangan menambahkan daftar pengecualian, jangan melonggarkan assertion, dan
     jangan menandai test ini skip: ketiganya mengembalikan keadaan yang sudah
     selesai diperbaiki, dengan biaya yang sama dan tanpa satu pun error. */
  const pelanggar = await pelanggarPk(SKEMA());
  const nama = pelanggar.map((p) => p.tabel).sort();
  const dasar = [...PELANGGAR_DIKETAHUI].sort();

  const baru = nama.filter((t) => !PELANGGAR_DIKETAHUI.includes(t));
  const hilang = dasar.filter((t) => !nama.includes(t));
  const daftar = pelanggar
    .map((p) => `  L${p.baris}  ${p.tabel}.${p.kolom}  ${p.definisi}`)
    .join('\n');

  /* ⛔ DUA MERAH YANG BERBEDA, dan membedakannya adalah seluruh gunanya.
     Pesan yang selalu berbunyi sama adalah pesan yang orang berhenti baca. */
  assert.deepEqual(
    baru,
    [],
    '⛔ PELANGGAR BARU — tabel ini TIDAK ada di garis dasar:\n' +
      baru.map((t) => `  ${t}`).join('\n') +
      '\n\nSebuah tabel ditambahkan atau diubah dengan PRIMARY KEY tekstual tanpa ' +
      '`NOT NULL`. SQLite menerima id NULL di sana; PostgreSQL menolaknya, jadi ' +
      'selisihnya baru terlihat saat sync, jauh dari sebabnya.\n\n' +
      'Perbaiki tabel BARU-nya — jangan menambahkannya ke `PELANGGAR_DIKETAHUI`. ' +
      'Daftar itu garis dasar yang hanya boleh MENYUSUT, bukan tempat menampung ' +
      'pelanggaran berikutnya, dan penjaga di atas menolak nama yang tidak ada di ' +
      'garis dasar terkunci.\n\n' +
      `Seluruh ${pelanggar.length} pelanggar:\n${daftar}`
  );

  assert.deepEqual(
    hilang,
    [],
    '✔ Sebagian garis dasar SUDAH DIPERBAIKI: ' +
      hilang.join(', ') +
      '\n\nIni kabar baik yang tetap merah, dan merahnya disengaja: hapus nama itu ' +
      'dari `PELANGGAR_DIKETAHUI` supaya daftarnya tetap menggambarkan keadaan ' +
      'sebenarnya. Garis dasar yang lebih panjang daripada kenyataan diam-diam ' +
      'memaafkan tabel yang kelak memakai nama itu lagi — dan ratchet yang tidak ' +
      'pernah menyusut berhenti menjadi ratchet.\n\n' +
      `Sisa ${pelanggar.length} pelanggar:\n${daftar}`
  );

  /* ⛔ HIJAU YANG TETAP BICARA. `assert` yang lolos tidak mencetak apa pun, dan
     hijau yang diam di sini tidak dapat dibedakan dari hijau yang benar-benar
     bersih — padahal kelima tabel itu masih melanggar dan masih menunggu
     keputusan. `t.diagnostic` mencetaknya di setiap run, termasuk di CI. */
  t.diagnostic(
    `garis dasar utuh: ${pelanggar.length} pelanggar PK, semuanya DIHARAPKAN dan ` +
      'sedang MENUNGGU KEPUTUSAN produk — bukan regresi, bukan pelanggar baru.'
  );
  for (const p of pelanggar) {
    t.diagnostic(`  L${p.baris}  ${p.tabel}.${p.kolom}  ${p.definisi}`);
  }
  t.diagnostic(
    'HIJAU DI SINI BUKAN BERARTI SELESAI. Empat pertama raw table yang TIDAK ada di ' +
      'sync rules jalur turun: rebuild membuangnya tanpa jalan pulang. `outbox_local` ' +
      'murni lokal dan memegang antrean penjualan yang belum terkirim; `rencanaDdl` ' +
      'sengaja tidak punya jalur untuk men-drop tabel semacam itu.'
  );
});
