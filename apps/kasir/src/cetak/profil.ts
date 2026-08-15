import type { PrinterProfile } from './escpos.ts';

/**
 * Profil printer BASELINE — dua, dan sengaja bukan daftar model.
 *
 * ## ⛔ Ini tidak melanggar "Data, bukan kode"
 *
 * `ERD:445` menetapkan `printer_profile` adalah "**Data, bukan kode** —
 * menambah model printer = menambah baris". Yang dimaksud adalah profil
 * SPESIFIK MODEL: Epson TM-T82, Xprinter XP-58, dan seterusnya, yang perintah
 * potong dan codepage-nya berbeda-beda.
 *
 * Dua profil di bawah bukan model. Keduanya adalah **baseline ESC/POS** —
 * perintah yang dipatuhi hampir setiap printer termal, pada dua lebar kertas
 * yang ada di pasar. Ia yang membuat perangkat tanpa satu pun profil
 * tersinkron tetap dapat mencetak, alih-alih menampilkan daftar kosong.
 *
 * ## Kenapa tabelnya belum diturunkan
 *
 * `printer_profile` **dikecualikan dari RLS** (`db/migrations/0012` — "data
 * referensi hardware global"), jadi ia tidak punya `tenant_id`. Penjaga
 * `tests/kasir/sync-rules.test.js` menuntut SETIAP query jalur turun
 * menyaring tenant, dan tuntutan itu benar: sync rules adalah satu-satunya
 * batas tenant di sana.
 *
 * Menurunkan tabel ini menuntut penjaganya diubah dari "setiap query
 * menyaring tenant" menjadi "setiap query atas tabel BER-TENANT menyaring
 * tenant" — dan perbedaannya harus dibaca dari DDL server, bukan dari daftar
 * pengecualian yang ditulis tangan. Daftar tangan akan bertambah panjang
 * sampai penjaganya tidak menjaga apa pun.
 *
 * Itu pekerjaan tersendiri, dan dicatat sebagai langkah berikutnya alih-alih
 * dikerjakan setengah di sini.
 */

export const PROFIL_58MM: PrinterProfile = {
  id: 'baseline-58',
  nama: 'Termal 58 mm (baseline)',
  paperWidthMm: 58,
  charsPerLine: 32,
  codepage: 'cp437',
  // Baseline tidak mengasumsikan pemotong: printer 58 mm murah umumnya tidak
  // punya, dan perintah potong ke printer tanpa pemotong tercetak sebagai
  // karakter sampah.
  hasCutter: false,
  initCommand: '1B 40',
  cutCommand: '',
  drawerCommand: '1B 70 00 19 FA',
  imageSupport: false,
};

export const PROFIL_80MM: PrinterProfile = {
  ...PROFIL_58MM,
  id: 'baseline-80',
  nama: 'Termal 80 mm (baseline)',
  paperWidthMm: 80,
  charsPerLine: 48,
  hasCutter: true,
  cutCommand: '1D 56 00',
};

export const PROFIL_BASELINE: readonly PrinterProfile[] = [PROFIL_58MM, PROFIL_80MM];

/**
 * Dokumen uji cetak K-15.
 *
 * ⛔ Memuat hal-hal yang paling sering SALAH di printer, bukan sekadar kata
 * "tes": lebar penuh, angka rata kanan, karakter tipografi yang harus
 * diterjemahkan, dan garis pemisah. Uji cetak yang hanya mencetak satu kata
 * lolos di printer yang lebarnya salah dikonfigurasi.
 */
export function dokumenUjiCetak(profil: PrinterProfile) {
  return {
    baris: [
      { jenis: 'teks' as const, isi: 'UJI CETAK', rata: 'tengah' as const, tebal: true },
      { jenis: 'teks' as const, isi: profil.nama, rata: 'tengah' as const },
      { jenis: 'garis' as const },
      // Penggaris: kalau lebar profil salah, ia melipat dan terlihat seketika.
      { jenis: 'teks' as const, isi: '1234567890'.repeat(6).slice(0, profil.charsPerLine) },
      { jenis: 'duaKolom' as const, kiri: '2× Kopi Susu', kanan: '50.000' },
      { jenis: 'duaKolom' as const, kiri: 'Diskon', kanan: '− 9.000' },
      { jenis: 'duaKolom' as const, kiri: 'TOTAL', kanan: '41.000', tebal: true },
      { jenis: 'garis' as const },
      { jenis: 'teks' as const, isi: 'Angka rata kanan · minus & kali terbaca' },
      { jenis: 'kosong' as const },
    ],
    potong: true,
  };
}

/**
 * Profil yang tersedia di perangkat ini: yang tersinkron DULU, baseline
 * sesudahnya.
 *
 * ⛔ Baseline tidak pernah dibuang. Perangkat yang katalog profilnya belum
 * turun — atau merchant yang memang tidak pernah menambahkan model — harus
 * tetap dapat mencetak. Daftar kosong di layar uji cetak adalah jalan buntu
 * yang tidak dapat diselesaikan kasir sendiri.
 *
 * Duplikat berdasarkan `id` disingkirkan, dengan yang tersinkron menang: bila
 * merchant menambahkan baris ber-id `baseline-58`, itu koreksi yang disengaja
 * dan harus berlaku.
 */
export async function bacaProfilPrinter(
  db: { getAll<T>(sql: string, params?: unknown[]): Promise<T[]> }
): Promise<PrinterProfile[]> {
  let tersinkron: PrinterProfile[] = [];
  try {
    const baris = await db.getAll<{
      id: string;
      name: string;
      paper_width_mm: number | null;
      chars_per_line: number | null;
      codepage: string | null;
      has_cutter: number;
      init_command: string | null;
      cut_command: string | null;
      drawer_command: string | null;
      image_support: number;
    }>(
      `SELECT id, name, paper_width_mm, chars_per_line, codepage,
              has_cutter, init_command, cut_command, drawer_command, image_support
         FROM printer_profile`
    );
    tersinkron = baris.map((b) => ({
      id: b.id,
      nama: b.name,
      paperWidthMm: Number(b.paper_width_mm ?? 58),
      // ⛔ `chars_per_line` yang kosong TIDAK boleh menjadi 0: lebar nol
      // membuat setiap baris struk dipotong habis. Baseline 58 mm yang dipakai.
      charsPerLine: Number(b.chars_per_line) > 0 ? Number(b.chars_per_line) : 32,
      codepage: b.codepage ?? 'cp437',
      // `boolean` server mendarat sebagai INTEGER; dibandingkan eksplisit ke 1
      // supaya `'0'` dari driver yang mengembalikan string tidak terbaca true.
      hasCutter: Number(b.has_cutter) === 1,
      initCommand: b.init_command ?? '',
      cutCommand: b.cut_command ?? '',
      drawerCommand: b.drawer_command ?? '',
      imageSupport: Number(b.image_support) === 1,
    }));
  } catch {
    // Tabelnya belum ada di perangkat lama — bukan alasan untuk kehilangan
    // kemampuan cetak.
    tersinkron = [];
  }

  const hasil = [...tersinkron];
  for (const b of PROFIL_BASELINE) {
    if (!hasil.some((p) => p.id === b.id)) hasil.push(b);
  }
  return hasil;
}
