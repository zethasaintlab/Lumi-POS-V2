// Skema database lokal: siapa yang direplikasi, siapa yang tidak, dan
// bagaimana baris yang turun ditulis ke tabel kami.
//
// Berkas ini SENGAJA tidak mengimpor Vite (`?raw`), PowerSync, maupun React.
// Teks SQL-nya di-INJECT: di browser lewat `import SQL from '...?raw'`, di
// test lewat `fs`. Kalau modul ini memuat SQL-nya sendiri, ia tidak akan bisa
// diuji di `node --test` sama sekali -- dan justru inilah bagian yang paling
// perlu diuji.
//
// Sumber kebenaran kolom adalah `db/local/001-initial.sql`, bukan daftar yang
// diketik ulang di sini. Daftar yang diketik ulang akan hanyut, dan hanyutnya
// tidak memunculkan error: `put` yang kehilangan satu kolom hanya membuat
// kolom itu selalu NULL di perangkat.

/**
 * Tabel yang direplikasi dari server -- WAJIB didaftarkan sebagai raw table.
 *
 * Mendeklarasikannya sebagai tabel PowerSync biasa membuat core membuat VIEW
 * bernama sama di atas `ps_data__<nama>`, dan ia bertabrakan dengan tabel
 * nyata kami (prototipe 04, `CLAUDE.md` bagian F2).
 */
export const TABEL_RAW = [
  'category',
  'item',
  'item_variation',
  'modifier_list',
  'modifier',
  'item_modifier_list',
  'tax_rate',
  'order',
  'check',
  'order_line',
  'order_line_modifier',
  'payment',
  'refund',
  'stock_movement',
  'cash_drawer_shift',
  'cash_movement',
  'audit_event',
  // §6 PLAN-modul-f-identitas.md. FR-F3 menuntut login berfungsi dengan
  // jaringan dimatikan sepenuhnya, dan itu hanya mungkin bila hash PIN ADA
  // di perangkat (`spec-f:124`). Ketiganya turun; kolomnya disaring sync
  // rules, bukan SELECT * -- `password_hash` dan `mfa_secret` tidak pernah
  // menyentuh perangkat kasir.
  'user',
  'user_role',
  'user_outlet',
];

/**
 * Tabel yang TIDAK didaftarkan sama sekali.
 *
 * `outbox_local` aman justru karena PowerSync tidak tahu ia ada:
 * `powersync_replace_schema` hanya menyentuh objek yang cocok `GLOB 'ps_data_*'`
 * atau view bertanda `-- powersync-auto-generated`. Mendaftarkannya berarti
 * membangun jalur naik kedua yang diam-diam.
 */
export const TABEL_LOKAL_SAJA = [
  'stock_snapshot',
  'outbox_local',
  'device_config',
  'skema_lokal',
  // Keduanya SENGAJA tidak didaftarkan: sesi kasir tidak punya padanan di
  // server (`spec-f:183` -- shift yang menentukan, bukan kedaluwarsa sesi),
  // dan penguncian PIN yang berlaku saat offline adalah milik perangkat ini
  // sendiri.
  'sesi_lokal',
  'pin_lockout_lokal',
];

/**
 * Kolom yang tipenya BERBEDA antara PostgreSQL dan skema lokal, beserta
 * skalanya.
 *
 * ⛔ `CLAUDE.md` bagian F2: "`put` yang disimpulkan PowerSync menyalin nilai
 * apa adanya." Terukur pada `tax_rate.rate` (`numeric(6,4)` di server,
 * `INTEGER` ×10000 di lokal): `0.1100` mendarat sebagai `0.11` -- 10.000×
 * terlalu kecil -- DAN tersimpan sebagai `real` di kolom `INTEGER`, tanpa satu
 * pun error, karena affinity SQLite hanya mengubah nilai bila lossless.
 *
 * Dua kolom lain punya bentuk cacat yang persis sama dan BELUM pernah
 * terukur; keduanya ditemukan dengan membandingkan DDL, bukan dengan
 * menjalankan sync:
 *
 *   - `item_variation.conversion_factor` — `numeric` (1) → `INTEGER` ×1000
 *   - `order_line.tax_rate` — `numeric(6,4)` → `INTEGER` ×10000
 *
 * `ROUND` bukan hiasan: nilainya sudah menjadi double dalam perjalanan, dan
 * 0,1075 × 10000 menghasilkan 1075.0000000000002.
 */
export const SKALA_KOLOM: Record<string, Record<string, number>> = {
  tax_rate: { rate: 10000 },
  order_line: { tax_rate: 10000 },
  item_variation: { conversion_factor: 1000 },
};

/**
 * Perlakuan untuk setiap KELAS perbedaan tipe antara PostgreSQL dan skema
 * lokal. Kelasnya kasar dengan sengaja: yang dijaga bukan kesamaan nama tipe
 * (`bigint` vs `INTEGER` memang beda nama dan itu tidak apa-apa), melainkan
 * apakah nilainya sampai utuh.
 *
 * Kelas baru yang muncul dan tidak ada di sini membuat test merah. Itulah
 * gunanya: kolom `numeric` yang ditambahkan ke tabel katalog kelak tidak akan
 * pernah lolos diam-diam seperti `tax_rate.rate` dulu.
 */
export const PERLAKUAN_DIVERGENSI: Record<string, { perlakuan: 'skala' | 'aman' | 'belum-diukur'; alasan: string }> = {
  'desimal->bulat': {
    perlakuan: 'skala',
    alasan:
      'Terukur cacat pada tax_rate.rate: nilai mendarat apa adanya sebagai `real` di kolom INTEGER, tanpa error. Wajib `put` ditulis sendiri.',
  },
  'waktu->teks': {
    perlakuan: 'aman',
    alasan:
      'JSON tidak punya tipe waktu, jadi timestamptz sudah berupa string ISO saat tiba. Tidak ada konversi yang mungkin hilang.',
  },
  'tanggal->teks': {
    perlakuan: 'aman',
    alasan: 'Sama dengan waktu->teks: `date` tiba sebagai string.',
  },
  'bool->bulat': {
    perlakuan: 'belum-diukur',
    alasan:
      'Boolean JavaScript yang di-bind ke kolom INTEGER SQLite BELUM pernah kami ukur lewat PowerSync. Yang diharapkan 1/0; yang mungkin terjadi adalah nilai ditolak atau disimpan bertipe lain.',
  },
  'json->teks': {
    perlakuan: 'belum-diukur',
    alasan:
      'jsonb bisa tiba sebagai objek, bukan string. Objek yang di-bind ke kolom TEXT belum pernah kami ukur.',
  },
  'larik->teks': {
    perlakuan: 'belum-diukur',
    alasan: '`text[]` PostgreSQL belum pernah kami lihat mendarat di kolom TEXT.',
  },
};

/**
 * Kolom yang perlakuannya `belum-diukur`, ditulis satu per satu.
 *
 * Daftar per-kolom ini ada supaya kolom BARU berkelas sama tidak menyelinap
 * di bawah kelas yang sudah "diketahui" -- menambah satu kolom jsonb ke tabel
 * yang direplikasi harus menjadi keputusan sadar, bukan konsekuensi diam.
 */
export const KOLOM_BELUM_DIUKUR = [
  'item_variation.track_stock',
  'modifier_list.allow_duplicate',
  'modifier_list.is_required',
  'modifier.is_default',
  'tax_rate.is_inclusive',
  'tax_rate.applies_to_ids',
  'order.has_calculation_variance',
  'order_line.is_tax_inclusive',
  'order_line.modifier_snapshot',
  'payment.confirmed_manually',
  'cash_drawer_shift.count_attempts',
  'audit_event.before',
  'audit_event.after',
  // §6 PLAN-modul-f-identitas.md. Ditemukan oleh penjaga drift ini, bukan
  // oleh review: keduanya `boolean` di PostgreSQL dan `INTEGER` di lokal --
  // kelas divergensi yang sama persis dengan `tax_rate.is_inclusive`.
  //
  // `user.is_active` yang mendarat salah tidak menghasilkan error apa pun;
  // ia menghasilkan kasir nonaktif yang tetap dapat login saat offline, atau
  // kasir aktif yang terkunci di luar. Belum diukur lewat sync sungguhan.
  'user.is_active',
  'user.pin_must_change',
];

/**
 * Memecah berkas skema jadi pernyataan tunggal.
 *
 * `db.execute()` PowerSync menjalankan seluruh isi string tapi hanya
 * mengembalikan hasil pernyataan PERTAMA. Memecahnya membuat kegagalan DDL
 * menunjuk ke pernyataan yang benar-benar gagal.
 */
export function pecahPernyataan(sqlText: string): string[] {
  return sqlText
    // CRLF dinormalkan LEBIH DULU, dan itu bukan kerapian. `--.*$` tidak
    // pernah cocok pada baris berakhiran `\r`: `.` di JavaScript tidak
    // mencocokkan `\r`, jadi `$` tidak pernah tercapai dan seluruh komentar
    // lolos. Berkas ini ber-CRLF di Windows. Akibatnya halus -- SQLite tetap
    // menerima `-- komentar\nCREATE TABLE …` sebagai pernyataan sah, jadi DDL
    // tetap jalan sementara parser kolom melihat baris yang diawali komentar
    // dan melewatkan tabelnya diam-diam.
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((b) => b.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const AWALAN_BATASAN = /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i;

/** Memecah isi `CREATE TABLE (...)` pada koma di kedalaman nol. */
function bagiKolom(isi: string): string[] {
  const hasil: string[] = [];
  let dalam = 0;
  let buf = '';
  for (const c of isi) {
    if (c === '(') dalam += 1;
    if (c === ')') dalam -= 1;
    if (c === ',' && dalam === 0) {
      hasil.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  hasil.push(buf);
  return hasil;
}

/**
 * Membaca nama kolom setiap tabel dari teks skema, BERURUTAN.
 *
 * Urutannya penting: `put` menyusun `VALUES (?, ?, …)` mengikuti urutan ini,
 * dan urutan yang berbeda menaruh nilai di kolom yang salah tanpa error
 * selama tipenya kebetulan cocok.
 */
export function kolomPerTabel(sqlText: string): Record<string, string[]> {
  const hasil: Record<string, string[]> = {};
  for (const p of pecahPernyataan(sqlText)) {
    // Nama tabel boleh dikutip -- `"order"` dan `"check"` adalah kata kunci
    // SQL. Parser yang melewatkannya membuat `put` untuk order kehilangan
    // seluruh kolomnya, dan penjualan turun kosong tanpa satu pun error.
    const m = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?\s*\(/i.exec(p);
    if (!m) continue;

    const buka = p.indexOf('(');
    const tutup = p.lastIndexOf(')');
    const kolom: string[] = [];
    for (const bagian of bagiKolom(p.slice(buka + 1, tutup))) {
      const t = bagian.trim();
      if (t.length === 0 || AWALAN_BATASAN.test(t)) continue;
      const nama = /^"?([a-z_]+)"?/i.exec(t);
      if (nama) kolom.push(nama[1]);
    }
    hasil[m[1]] = kolom;
  }
  return hasil;
}

/**
 * Ekspresi nilai untuk satu kolom di dalam `put`.
 *
 * `?` untuk kolom yang tipenya sepakat di kedua sisi; konversi berskala untuk
 * yang tidak.
 */
export function ekspresiNilai(tabel: string, kolom: string): string {
  const skala = SKALA_KOLOM[tabel]?.[kolom];
  return skala ? `CAST(ROUND(? * ${skala}) AS INTEGER)` : '?';
}

/**
 * Sidik jari bentuk raw table -- nama tabel dan kolomnya, berurutan.
 *
 * Ia menggantikan nomor versi skema yang ditulis tangan, dan alasannya bukan
 * kerapian: nomor versi harus DIINGAT untuk dinaikkan, dan yang lupa dinaikkan
 * menghasilkan tepat keadaan paling berbahaya di jalur turun -- tabel dibangun
 * ulang tanpa `disconnectAndClear()`, katalog kosong permanen, sinkronisasi
 * melaporkan sukses.
 *
 * Tabel murni lokal TIDAK ikut: bentuk `outbox_local` tidak ada hubungannya
 * dengan checkpoint PowerSync, dan memaksa unduh ulang karenanya berarti
 * membuang jendela riwayat 90 hari tanpa alasan.
 *
 * FNV-1a, bukan hash kriptografis: yang dibutuhkan deteksi PERUBAHAN, bukan
 * ketahanan terhadap lawan, dan ia tersedia sama persis di node dan browser
 * tanpa API asinkron.
 */
export function sidikJariRawTable(kolom: Record<string, string[]>): string {
  const kanonik = TABEL_RAW.map((t) => `${t}(${(kolom[t] ?? []).join(',')})`).join(';');
  let h = 0x811c9dc5;
  for (let i = 0; i < kanonik.length; i += 1) {
    h ^= kanonik.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}-${kanonik.length}`;
}

/**
 * Cerminan `PendingStatementParameter` PowerSync, ditulis ulang di sini supaya
 * modul ini tetap bebas impor -- `node --test` tidak dapat memuat berkas yang
 * mengimpor `@powersync/web`. Kalau bentuknya hanyut, `tsc` di `db.ts` yang
 * menangkapnya: di sanalah nilai ini benar-benar diserahkan ke PowerSync.
 */
export type ParamRaw = 'Id' | { Column: string };

export interface DefinisiRaw {
  schema: { tableName: string };
  put: { sql: string; params: ParamRaw[] };
  delete: { sql: string; params: ['Id'] };
}

/**
 * Menyusun definisi raw table untuk `withRawTables`.
 *
 * Setiap tabel mendapat `put` yang DITULIS SENDIRI, bukan yang disimpulkan --
 * termasuk tabel yang seluruh kolomnya sepakat. Alasannya bukan kehati-hatian
 * berlebihan: kalau hanya tabel bermasalah yang punya `put` sendiri, kolom
 * berskala yang ditambahkan kelak ke tabel "aman" akan diam-diam kembali
 * memakai jalur yang disimpulkan. Di sini ia melewati `ekspresiNilai`, dan
 * `SKALA_KOLOM` adalah satu-satunya tempat yang perlu diperbarui.
 */
export function buatDefinisiRaw(kolom: Record<string, string[]>): Record<string, DefinisiRaw> {
  const hasil: Record<string, DefinisiRaw> = {};
  for (const tabel of TABEL_RAW) {
    const kolomnya = kolom[tabel];
    if (!kolomnya) throw new Error(`Tabel ${tabel} tidak ada di skema lokal.`);

    hasil[tabel] = {
      schema: { tableName: tabel },
      put: {
        sql:
          `INSERT OR REPLACE INTO "${tabel}" (${kolomnya.map((k) => `"${k}"`).join(', ')}) ` +
          `VALUES (${kolomnya.map((k) => ekspresiNilai(tabel, k)).join(', ')})`,
        // `Id` adalah id baris menurut PowerSync; sisanya dibaca dari kolom
        // yang namanya sama.
        params: kolomnya.map((k) => (k === 'id' ? 'Id' : { Column: k })),
      },
      delete: {
        sql: `DELETE FROM "${tabel}" WHERE id = ?`,
        params: ['Id'],
      },
    };
  }
  return hasil;
}
