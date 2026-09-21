'use strict';

// ⛔ TIGA keadaan kartu produk, dan yang diuji di sini adalah bahwa DUA di
// antaranya tidak dapat tertukar.
//
// | Keadaan | Baris `item_image` | Kartu |
// |---|---|---|
// | belum difoto | tidak ada | NORMAL — tanpa penanda apa pun |
// | gagal dimuat | ada, verifikasi gagal | keadaan bernama, terlihat berbeda |
// | utuh | ada, verifikasi lolos | gambarnya |
//
// Keputusan user 2 September 2026: *"kartu tanpa gambar bukan keadaan
// menunggu"*. Kalau keduanya menghasilkan bentuk yang sama, merchant yang
// fotonya rusak di transport tidak punya cara tahu — ia mengunggah ulang,
// lalu lagi, dan tidak ada satu pun error di mana pun. Itu persis kekosongan
// menyamar yang membuat `bytea` dicabut.
//
// ⛔ Test ini memakai SQLite SUNGGUHAN, bukan fake. `byte` adalah kolom
// `INTEGER`, dan driver yang berbeda mengembalikannya sebagai `bigint`,
// `number`, atau `string` (`CLAUDE.md` § jalur turun). Guard yang hanya
// memeriksa `number` tidak pernah mengambil cabangnya — hijau di seluruh
// test, dan di aplikasi SETIAP gambar dinyatakan rusak.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const modul = () => import('../../apps/kasir/src/katalog/gambar.ts');
const domain = () => import('../../packages/domain/src/gambar-produk.ts');

/** `DbLokal` di atas `node:sqlite` — hanya `getAll` yang dipakai modul ini. */
function dbDari(sqlite) {
  return {
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

function buatDb() {
  const s = new DatabaseSync(':memory:');
  s.exec(`CREATE TABLE item_image (
            id TEXT PRIMARY KEY, data_base64 TEXT NOT NULL, byte INTEGER NOT NULL,
            checksum TEXT NOT NULL, mime TEXT NOT NULL, width INTEGER, height INTEGER,
            updated_at TEXT)`);
  return s;
}

async function sisip(s, id, base64, ubah = {}) {
  const { byteDariBase64, checksumGambar } = await domain();
  const baris = {
    byte: byteDariBase64(base64),
    checksum: checksumGambar(base64),
    mime: 'image/webp',
    ...ubah,
  };
  s.prepare(
    `INSERT INTO item_image (id, data_base64, byte, checksum, mime, width, height, updated_at)
          VALUES (?, ?, ?, ?, ?, 400, 400, '2026-09-02T00:00:00Z')`
  ).run(id, base64, baris.byte, baris.checksum, baris.mime);
}

/** Base64 sah sepanjang `n` byte. */
const b64 = (n) => Buffer.alloc(n, 0x57).toString('base64');

test('item TANPA baris tidak muncul di peta sama sekali', async () => {
  // ⛔ Bukan dipetakan ke `null`. Ketiadaan kunci adalah satu-satunya bentuk
  // yang tidak dapat tertukar dengan "ada tetapi rusak" — pemanggil yang lupa
  // membedakan `null` dari `{keadaan:'rusak'}` akan menyamakan keduanya, dan
  // itu tepat kegagalan yang fitur ini ada untuk mencegah.
  const s = buatDb();
  const { bacaGambarKatalog } = await modul();
  const peta = await bacaGambarKatalog(dbDari(s));
  assert.equal(peta.size, 0);
  assert.equal(peta.get('item-belum-difoto'), undefined);
  assert.equal(peta.has('item-belum-difoto'), false);
});

test('baris utuh → keadaan `utuh` dengan data: URL siap pakai', async () => {
  const s = buatDb();
  const isi = b64(900);
  await sisip(s, 'item-1', isi);

  const { bacaGambarKatalog } = await modul();
  const g = (await bacaGambarKatalog(dbDari(s))).get('item-1');
  assert.equal(g.keadaan, 'utuh');
  assert.equal(g.src, `data:image/webp;base64,${isi}`);
});

test('⛔ checksum tidak cocok → `rusak`, dan `src` NULL', async () => {
  // Isi berubah tanpa mengubah panjang. Hanya checksum yang menangkapnya;
  // pemeriksaan "ada isinya" dan pemeriksaan panjang keduanya bernilai BENAR.
  const s = buatDb();
  await sisip(s, 'item-1', b64(900), { checksum: 'deadbeef' });

  const { bacaGambarKatalog } = await modul();
  const g = (await bacaGambarKatalog(dbDari(s))).get('item-1');
  assert.equal(g.keadaan, 'rusak');
  assert.equal(g.src, null, 'src wajib null — `data:` URL rusak merender kotak patah browser');
});

test('⛔ teks DIPOTONG tetapi tetap base64 sah → `rusak`', async () => {
  // Bentuk kerusakan yang paling berbahaya: `base64Sah` lolos, dan tanpa
  // `byte` tidak ada apa pun yang tahu bahwa muatannya lebih pendek. Ini
  // padanan langsung dari "15 byte jadi 4" yang membuat `bytea` dicabut.
  const s = buatDb();
  const isi = b64(900);
  const potong = isi.slice(0, 400);
  const { base64Sah } = await domain();
  assert.equal(base64Sah(potong), true, 'prasyarat: potongannya HARUS tetap base64 sah');

  const { byteDariBase64, checksumGambar } = await domain();
  s.prepare(
    `INSERT INTO item_image (id, data_base64, byte, checksum, mime, width, height, updated_at)
          VALUES ('item-1', ?, ?, ?, 'image/webp', 400, 400, 'x')`
  ).run(potong, byteDariBase64(isi), checksumGambar(isi));

  const { bacaGambarKatalog } = await modul();
  assert.equal((await bacaGambarKatalog(dbDari(s))).get('item-1').keadaan, 'rusak');
});

test('⛔ mime selain WebP diperlakukan RUSAK, tidak dipercaya', async () => {
  // `data:` URL merender apa pun yang mime-nya sebut, dan mime dari baris
  // database menempuh perjalanan yang sama panjangnya dengan byte-nya. Yang
  // tersimpan selalu WebP; apa pun selain itu berarti barisnya sudah berubah.
  const s = buatDb();
  await sisip(s, 'item-1', b64(900), { mime: 'text/html' });

  const { bacaGambarKatalog } = await modul();
  const g = (await bacaGambarKatalog(dbDari(s))).get('item-1');
  assert.equal(g.keadaan, 'rusak');
  assert.equal(g.src, null);
});

test('⛔ `byte` bertipe string maupun bigint tetap dibaca benar', async () => {
  // `@powersync/web` mengembalikan kolom INTEGER besar sebagai `bigint`,
  // `node:sqlite` sebagai `number`. Guard yang hanya menerima `number`
  // menyatakan SETIAP gambar rusak di aplikasi sambil hijau di seluruh test.
  const { bacaGambarKatalog } = await modul();
  const { byteDariBase64, checksumGambar } = await domain();
  const isi = b64(900);

  for (const bentuk of [byteDariBase64(isi), BigInt(byteDariBase64(isi)), String(byteDariBase64(isi))]) {
    const db = {
      async getAll() {
        return [
          { id: 'x', data_base64: isi, byte: bentuk, checksum: checksumGambar(isi), mime: 'image/webp' },
        ];
      },
      async execute() {},
      async transaction(fn) {
        return fn(this);
      },
    };
    assert.equal(
      (await bacaGambarKatalog(db)).get('x').keadaan,
      'utuh',
      `byte bertipe ${typeof bentuk} dibaca salah`
    );
  }
});

test('campuran: utuh, rusak, dan yang tidak punya baris — dalam satu peta', async () => {
  // Bentuk yang paling sering nyata: merchant memfoto menu andalannya lebih
  // dulu dan sisanya menyusul. Grid yang seluruhnya bergambar tidak pernah
  // menguji apa pun yang penting di sini.
  const s = buatDb();
  await sisip(s, 'item-1', b64(900));
  await sisip(s, 'item-2', b64(600), { checksum: '00000000' });
  await sisip(s, 'item-3', b64(1200));

  const { bacaGambarKatalog } = await modul();
  const peta = await bacaGambarKatalog(dbDari(s));

  assert.equal(peta.get('item-1').keadaan, 'utuh');
  assert.equal(peta.get('item-2').keadaan, 'rusak');
  assert.equal(peta.get('item-3').keadaan, 'utuh');
  assert.equal(peta.has('item-4'), false, 'item tanpa baris tidak boleh muncul');
  assert.equal(peta.size, 3);
});

test('⛔ layar merender ketiga keadaan, dan `tanpa` TANPA penanda apa pun', async () => {
  // ⛔ Penjaga BENTUK KODE, bukan render — dan ia ada karena aturan yang
  // dijaganya adalah aturan yang paling mudah "diperbaiki" oleh orang
  // berikutnya: kartu tanpa gambar terlihat kurang rapi di grid campuran,
  // dan menambahkan placeholder abu-abu terasa seperti peningkatan.
  //
  // Ia bukan peningkatan. Katalog merchant BARU seluruhnya belum difoto, dan
  // grid penuh placeholder terbaca sebagai aplikasi yang rusak pada hari
  // pertama pemakaian.
  const fs = require('node:fs');
  const path = require('node:path');
  const sumber = fs.readFileSync(
    path.resolve(__dirname, '../../apps/kasir/src/layar/Kasir.tsx'),
    'utf8'
  );

  assert.match(sumber, /data-gambar=\{gbr \? gbr\.keadaan : 'tanpa'\}/, 'kartu tidak menyatakan ketiga keadaan');
  assert.match(sumber, /gbr\?\.keadaan === 'utuh'/, 'keadaan utuh tidak dirender');
  assert.match(sumber, /gbr\?\.keadaan === 'rusak'/, 'keadaan rusak tidak dirender');

  // Tidak ada cabang untuk `tanpa`: ketiadaan cabang ITULAH aturannya.
  assert.ok(
    !/keadaan === 'tanpa'|gbr === undefined \?|!gbr &&/.test(sumber),
    'ada cabang render untuk kartu tanpa gambar — kartu tanpa gambar harus NORMAL'
  );

  const css = fs.readFileSync(
    path.resolve(__dirname, '../../apps/kasir/src/kasir.css'),
    'utf8'
  );
  // Satu-satunya aturan yang boleh menyentuh `tanpa` adalah TATA LETAK.
  //
  // ⛔ Properti dicocokkan per NAMA, bukan lewat substring. Versi pertama
  // penjaga ini memakai `/content/` dan menandai `justify-content: center` —
  // aturan tata letak yang justru menjadi seluruh isi keputusannya. Penjaga
  // yang menuduh kode yang benar akan dimatikan, dan yang mematikannya benar.
  const DILARANG = new Set([
    'background',
    'background-color',
    'background-image',
    'border',
    'content',
    'min-height',
    'height',
    'aspect-ratio',
    'opacity',
    'box-shadow',
  ]);
  const aturanTanpa = [...css.matchAll(/\[data-gambar='tanpa'\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(aturanTanpa.length > 0, 'penjaga tidak memindai apa pun — apakah selektornya berubah?');
  for (const isi of aturanTanpa) {
    for (const deklarasi of isi.split(';')) {
      const properti = deklarasi.split(':')[0]?.trim().toLowerCase();
      if (!properti) continue;
      assert.ok(
        !DILARANG.has(properti),
        `kartu tanpa gambar diberi tampilan tersendiri: \`${deklarasi.trim()}\`. ` +
          'Kartu tanpa gambar adalah keadaan NORMAL, bukan keadaan menunggu.'
      );
    }
  }

  // ⛔ Dan penjaganya sendiri harus dapat menolak sesuatu. Penjaga yang
  // daftarnya tidak pernah cocok dengan apa pun hijau selamanya.
  assert.ok(DILARANG.has('background'), 'daftar larangan kosong');
});
