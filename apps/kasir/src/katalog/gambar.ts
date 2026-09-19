import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import {
  verifikasiGambar,
  MIME_SIMPAN,
  type KeadaanGambar,
} from '../../../../packages/domain/src/gambar-produk.ts';

/**
 * Gambar produk di perangkat — dibaca dari raw table `item_image`, diverifikasi
 * sebelum dirender.
 *
 * ## ⛔ TIGA keadaan, dan hanya DUA di antaranya punya baris
 *
 * | Keadaan | Baris `item_image` | Yang kartu tampilkan |
 * |---|---|---|
 * | belum difoto | tidak ada | kartu NORMAL, tanpa penanda apa pun |
 * | gagal dimuat | ada, verifikasi gagal | keadaan bernama, terlihat berbeda |
 * | utuh | ada, verifikasi lolos | gambarnya |
 *
 * ⛔ **Keadaan pertama BUKAN keadaan menunggu** (keputusan user, 2 September
 * 2026). Layar kasir harus dapat dipakai penuh selagi gambar menyusul — 19,5 MB
 * di jaringan warung butuh waktu, dan kasir tidak boleh menunggunya. Kartu
 * tanpa gambar karena itu tidak menampilkan spinner, tidak menampilkan kotak
 * abu-abu, dan tidak menyisakan ruang kosong berbentuk gambar. Ia kartu yang
 * sama persis dengan kartu di hari sebelum fitur ini ada.
 *
 * ⛔ **Keadaan kedua wajib BERBEDA dari yang pertama**, dan itu seluruh alasan
 * `byte` + `checksum` menempel di baris yang sama. Tanpanya, gambar yang rusak
 * di transport menghasilkan kartu tanpa gambar — tidak dapat dibedakan dari
 * produk yang memang belum difoto, dan merchant yang sudah mengunggah fotonya
 * akan mengunggahnya lagi, lalu lagi. Kekosongan yang menyamar
 * (`docs/verifikasi/KELAS-GAGAL.md`).
 *
 * ## ⛔ Query TERPISAH dari `bacaKatalog`, bukan JOIN
 *
 * `bacaKatalog` berjalan pada SETIAP pembukaan K-03 dan hasilnya masuk state
 * React. Men-JOIN teks base64 ke dalamnya berarti setiap `useMemo` atas
 * katalog, setiap penyaringan kategori, dan setiap pengurutan menyalin ~20 MB
 * string. Yang dibutuhkan grid adalah dua peta kecil.
 */

/** Satu baris `item_image` seperti yang mendarat di SQLite lokal. */
interface BarisGambar {
  id: string;
  data_base64: string;
  byte: number | bigint | string;
  checksum: string;
  mime: string;
}

export interface GambarItem {
  keadaan: KeadaanGambar;
  /** `data:` URL siap pakai. `null` bila `keadaan === 'rusak'`. */
  src: string | null;
}

/**
 * ⛔ Ketiga bentuk diterima untuk `byte`.
 *
 * `@powersync/web` mengembalikan kolom `INTEGER` besar sebagai `bigint`,
 * `node:sqlite` sebagai `number`, dan sebagian jalur sebagai `string`
 * (`CLAUDE.md` § jalur turun). Guard yang hanya memeriksa `number` **tidak
 * pernah mengambil cabangnya** — hijau di seluruh test, salah di aplikasi.
 *
 * Di sini akibatnya lebih tajam daripada biasa: `byte` yang dibaca salah
 * membuat SETIAP gambar dinyatakan rusak, dan merchant melihat armada yang
 * seluruh fotonya gagal.
 */
function bacaByte(nilai: number | bigint | string): number {
  return typeof nilai === 'number' ? nilai : Number(nilai);
}

const SQL_GAMBAR = `SELECT id, data_base64, byte, checksum, mime FROM item_image`;

/**
 * Peta `itemId` → gambar, untuk seluruh katalog sekaligus.
 *
 * ⛔ Item yang TIDAK punya baris tidak muncul di peta sama sekali — bukan
 * dipetakan ke `null`. Pemanggil karena itu tidak dapat membedakan "belum
 * difoto" dari "rusak" secara tidak sengaja: yang pertama adalah ketiadaan
 * kunci, yang kedua adalah nilai ber-`keadaan: 'rusak'`.
 */
export async function bacaGambarKatalog(db: DbLokal): Promise<Map<string, GambarItem>> {
  const baris = await db.getAll<BarisGambar>(SQL_GAMBAR);
  const peta = new Map<string, GambarItem>();

  for (const b of baris) {
    const keadaan = verifikasiGambar({
      base64: b.data_base64 ?? '',
      byte: bacaByte(b.byte),
      checksum: b.checksum ?? '',
    });

    /* ⛔ Mime yang tidak dikenal diperlakukan RUSAK, bukan dipercaya.
       `data:` URL merender apa pun yang mime-nya sebut, dan mime dari baris
       database adalah nilai yang perjalanannya sama panjangnya dengan
       byte-nya. Yang tersimpan selalu WebP; apa pun selain itu berarti
       barisnya sudah tidak seperti saat ditulis. */
    const mimeSah = b.mime === MIME_SIMPAN;

    peta.set(b.id, {
      keadaan: keadaan === 'utuh' && mimeSah ? 'utuh' : 'rusak',
      src: keadaan === 'utuh' && mimeSah ? `data:${b.mime};base64,${b.data_base64}` : null,
    });
  }

  return peta;
}

/**
 * Kalimat untuk kartu yang gambarnya rusak.
 *
 * ⛔ Ia menyebut AKIBATNYA bagi kasir, dan akibatnya adalah: tidak ada. Kasir
 * tidak dapat memperbaiki gambar dan tidak boleh berhenti berjualan karenanya.
 * Yang perlu ia tahu hanya bahwa ini BUKAN produk tanpa foto — supaya laporan
 * ke merchant benar, bukan supaya ia melakukan sesuatu.
 */
export const PESAN_GAMBAR_RUSAK = 'Gambar gagal dimuat';
