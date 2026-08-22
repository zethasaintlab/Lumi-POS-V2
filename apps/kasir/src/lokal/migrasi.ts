// Migrasi skema lokal, dan aturan yang menyertainya.
//
// ⛔ `CLAUDE.md` bagian F2: "Membangun ulang raw table lokal TIDAK memicu
// unduh ulang. Checkpoint PowerSync hidup di tabel `ps_*`, terpisah dari tabel
// kami; `waitForFirstSync()` selesai dalam 0 ms dan MELAPORKAN SUKSES
// sementara katalog kosong permanen. Setiap migrasi skema lokal yang menyentuh
// raw table wajib diikuti `disconnectAndClear()`, dan itu harus masuk prosedur
// migrasi klien -- bukan diingat-ingat."
//
// Berkas ini adalah "masuk prosedur"-nya. Seluruh I/O di-inject, jadi
// keputusannya dapat diuji di node tanpa browser; yang tersisa untuk browser
// hanya membuktikan bahwa `disconnectAndClear()` sungguh memulihkan (T9).

import {
  TABEL_LOKAL_SAJA,
  TABEL_RAW,
  kolomPerTabel,
  pecahPernyataan,
  sidikJariRawTable,
} from './skema.ts';

export interface RencanaDdl {
  /** Dijalankan lebih dulu: PRAGMA. */
  pragma: string[];
  /** `DROP TABLE IF EXISTS` -- HANYA untuk raw table. */
  drop: string[];
  /** `CREATE TABLE` / `CREATE INDEX`, sudah disesuaikan per jenis tabel. */
  buat: string[];
}

function namaTabelDari(pernyataan: string): string | null {
  const t = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?/i.exec(pernyataan);
  if (t) return t[1];
  const i = /^CREATE(?:\s+UNIQUE)?\s+INDEX\s+(?:IF NOT EXISTS\s+)?[a-z_]+\s+ON\s+"?([a-z_]+)"?/i.exec(
    pernyataan
  );
  return i ? i[1] : null;
}

/**
 * Menyusun rencana DDL dari teks skema.
 *
 * ⛔ Yang paling penting di fungsi ini adalah apa yang TIDAK dilakukannya:
 * `outbox_local` tidak pernah ikut di-drop. Ia antrean penjualan yang belum
 * terkirim; men-drop-nya saat migrasi berarti menghapus uang merchant yang
 * belum tercatat di server, dan tidak ada apa pun yang dapat memulihkannya.
 * Tabel murni lokal karena itu hanya dibuat `IF NOT EXISTS`.
 *
 * Raw table sebaliknya dibuat dengan `CREATE TABLE` biasa: kalau drop-nya
 * entah bagaimana tidak berjalan, kita ingin gagal keras di sini, bukan
 * melanjutkan di atas tabel berbentuk lama.
 */
export function rencanaDdl(sqlSkema: string): RencanaDdl {
  const pragma: string[] = [];
  const buat: string[] = [];
  const lokalSaja = new Set(TABEL_LOKAL_SAJA);

  for (const p of pecahPernyataan(sqlSkema)) {
    if (/^PRAGMA\b/i.test(p)) {
      pragma.push(p);
      continue;
    }
    const tabel = namaTabelDari(p);
    if (!tabel) continue;
    buat.push(
      lokalSaja.has(tabel)
        ? p.replace(/^CREATE(\s+UNIQUE)?\s+(TABLE|INDEX)\s+/i, (_m, u, jenis) =>
            `CREATE${u ?? ''} ${jenis} IF NOT EXISTS `
          )
        : p
    );
  }

  return {
    pragma,
    drop: TABEL_RAW.map((t) => `DROP TABLE IF EXISTS "${t}"`),
    buat,
  };
}

export interface KeputusanMigrasi {
  perluBangunUlang: boolean;
  perluBersihkanSync: boolean;
  alasan: string;
}

/**
 * Memutuskan apa yang harus dilakukan saat boot.
 *
 * Perhatikan bahwa `perluBersihkanSync` tidak pernah berbeda dari
 * `perluBangunUlang`. Itu disengaja dan bukan penyederhanaan yang menunggu
 * diperbaiki: kombinasi "bangun ulang tanpa bersihkan" adalah satu-satunya
 * yang menghasilkan katalog kosong permanen, jadi ia dibuat MUSTAHIL, bukan
 * sekadar tidak dipilih. Harganya satu unduh ulang penuh pada perangkat baru
 * -- di mana tidak ada apa pun untuk diunduh ulang.
 */
export function putuskanMigrasi({
  sidikTersimpan,
  sidikSekarang,
}: {
  sidikTersimpan: string | null;
  sidikSekarang: string;
}): KeputusanMigrasi {
  if (!sidikTersimpan) {
    return {
      perluBangunUlang: true,
      perluBersihkanSync: true,
      alasan: 'Skema lokal belum pernah dipasang di perangkat ini.',
    };
  }
  if (sidikTersimpan !== sidikSekarang) {
    return {
      perluBangunUlang: true,
      perluBersihkanSync: true,
      alasan: `Bentuk raw table berubah (${sidikTersimpan} -> ${sidikSekarang}).`,
    };
  }
  return { perluBangunUlang: false, perluBersihkanSync: false, alasan: 'Skema lokal sudah mutakhir.' };
}


/**
 * Migrasi ADITIF untuk tabel murni lokal.
 *
 * ⛔ Ditemukan dengan menjalankan aplikasi, bukan dengan membaca kode.
 * `device_config` dan `outbox_local` mendapat kolom baru, dan database yang
 * sudah ada menolaknya: *"table device_config has no column named id"*. Sidik
 * jari tidak melihatnya — ia hanya menghitung raw table — dan tabel lokal-saja
 * memang sengaja tidak pernah di-drop.
 *
 * Jalan keluarnya HARUS aditif, bukan bangun ulang:
 *
 *   - `outbox_local` adalah antrean penjualan yang belum terkirim;
 *   - `device_config` menyimpan `receipt_sequence`, dan meresetnya ke nol
 *     melanggar I4 (nomor struk per device+tanggal berurutan rapat).
 *
 * Kolom yang HILANG ditambahkan. Kolom yang berlebih dibiarkan — SQLite tidak
 * dapat membuangnya tanpa menulis ulang tabel, dan menulis ulang tabel adalah
 * hal yang justru dihindari di sini.
 *
 * @param aktual kolom yang BENAR-BENAR ada, dari `PRAGMA table_info`.
 */
export function rencanaAlterLokal(
  sqlSkema: string,
  aktual: Record<string, string[]>
): string[] {
  const diinginkan = kolomPerTabel(sqlSkema);
  const alter: string[] = [];

  for (const tabel of TABEL_LOKAL_SAJA) {
    const ada = aktual[tabel];
    // Tabel yang belum ada sama sekali bukan urusan ALTER: `CREATE TABLE IF
    // NOT EXISTS` di rencana DDL yang menanganinya.
    if (!ada) continue;
    const punya = new Set(ada);
    for (const kolom of diinginkan[tabel] ?? []) {
      if (punya.has(kolom)) continue;
      // Tanpa tipe dan tanpa DEFAULT: SQLite menuntut kolom yang ditambahkan
      // ke tabel berisi data punya nilai untuk baris lama, dan NULL adalah
      // satu-satunya yang tidak mengarang apa pun.
      alter.push(`ALTER TABLE "${tabel}" ADD COLUMN "${kolom}"`);
    }
  }

  return alter;
}

/**
 * Pernyataan `CREATE` untuk tabel murni lokal yang BELUM ADA di perangkat.
 *
 * ## ⛔ Kenapa ini perlu, dan kenapa `ALTER` saja tidak cukup
 *
 * `jalankanDdl` — satu-satunya tempat `CREATE TABLE` dijalankan — hanya
 * berjalan saat `perluBangunUlang`, dan itu hanya terjadi bila **sidik jari
 * raw table** berubah. Sidik jari itu tidak menghitung tabel murni lokal sama
 * sekali (`sidikJariRawTable`).
 *
 * Akibatnya: tabel murni lokal BARU yang ditambahkan ke `001-initial.sql`
 * tidak pernah dibuat di perangkat yang sudah ada. Query pertama yang
 * menyentuhnya gagal dengan `no such table`, dan gejalanya muncul di fitur
 * yang tampaknya tidak berhubungan.
 *
 * `rencanaAlterLokal` tidak dapat menutupinya: ia melewati tabel yang belum
 * ada (`if (!ada) continue`) karena `ALTER TABLE` pada tabel yang tidak ada
 * memang tidak berarti apa-apa.
 *
 * Ditemukan saat menambahkan `telemetry_local` — tabel murni lokal PERTAMA
 * yang ditambahkan setelah `001-initial.sql` ditulis. Tabel lokal sebelumnya
 * semuanya lahir bersama berkas itu, jadi celah ini tidak pernah tersentuh.
 *
 * ⛔ Indeksnya ikut. Tabel yang ada tanpa indeksnya adalah tabel yang bekerja
 * benar dan lambat — kelas masalah yang paling sulit dihubungkan ke sebabnya.
 */
export function rencanaBuatLokalHilang(
  sqlSkema: string,
  aktual: Record<string, string[]>
): string[] {
  const lokalSaja = new Set(TABEL_LOKAL_SAJA);
  const buat: string[] = [];

  for (const p of pecahPernyataan(sqlSkema)) {
    const tabel = namaTabelDari(p);
    if (!tabel || !lokalSaja.has(tabel)) continue;
    // Sudah ada di perangkat — `rencanaAlterLokal` yang mengurus kolomnya.
    if (aktual[tabel]) continue;
    buat.push(
      p.replace(/^CREATE(\s+UNIQUE)?\s+(TABLE|INDEX)\s+/i, (_m, u, jenis) =>
        `CREATE${u ?? ''} ${jenis} IF NOT EXISTS `
      )
    );
  }

  return buat;
}

export interface DepsMigrasi {
  /** Isi `db/local/001-initial.sql`. Di browser di-import dengan `?raw`. */
  sqlSkema: string;
  bacaSidik: () => Promise<string | null>;
  jalankanDdl: (rencana: RencanaDdl) => Promise<void>;
  /** `db.disconnectAndClear()` PowerSync. */
  bersihkanSync: () => Promise<void>;
  simpanSidik: (sidik: string) => Promise<void>;
}

/**
 * Menjalankan migrasi lokal sesuai keputusan di atas.
 *
 * Urutannya mengikat, dan bukan pilihan gaya:
 *
 *   1. `disconnectAndClear()` LEBIH DULU, lalu DDL. Ini urutan yang benar-benar
 *      dijalankan dan diukur di prototipe 05 (`buka()`: init -> clear -> pasang
 *      tabel -> updateSchema). Urutan sebaliknya belum pernah dijalankan, dan
 *      `disconnectAndClear` mengenal raw table kami -- apa yang dilakukannya
 *      terhadap tabel yang baru saja dibuat tidak kami ketahui.
 *   2. Sidik jari disimpan TERAKHIR. Menyimpannya lebih dulu berarti kegagalan
 *      di tengah membuat boot berikutnya menyimpulkan "tidak ada yang berubah"
 *      di atas skema setengah jadi -- dan itu tidak akan pernah pulih sendiri.
 */
export async function jalankanMigrasi(deps: DepsMigrasi): Promise<KeputusanMigrasi> {
  const sidikSekarang = sidikJariRawTable(kolomPerTabel(deps.sqlSkema));
  const sidikTersimpan = await deps.bacaSidik();
  const keputusan = putuskanMigrasi({ sidikTersimpan, sidikSekarang });

  if (!keputusan.perluBangunUlang) return keputusan;

  if (keputusan.perluBersihkanSync) await deps.bersihkanSync();
  await deps.jalankanDdl(rencanaDdl(deps.sqlSkema));
  await deps.simpanSidik(sidikSekarang);

  return keputusan;
}
