import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { FITUR } from '../../../../packages/domain/src/fitur.ts';

/**
 * Feature flag di perangkat. `ARCH:358`.
 *
 * ## ⛔ Yang TIDAK punya baris mengikuti bawaan KODE, bukan "mati"
 *
 * Perangkat yang baru dipasang belum pernah menyegarkan apa pun, dan
 * perangkat yang berbulan-bulan offline tidak akan pernah menyegarkannya.
 * Membaca ketiadaan baris sebagai "mati" berarti kasir kehilangan diskon,
 * QRIS, dan buka laci pada perangkat yang justru paling sulit dijangkau —
 * kill switch yang menyala sendiri.
 *
 * ## ⛔ Baris yang ADA bertahan meski basi
 *
 * Tidak ada kedaluwarsa. Kill switch yang berhenti berlaku setelah N jam
 * offline adalah kill switch yang tidak berlaku pada perangkat yang paling
 * membutuhkannya, dan merchant yang sedang diselidiki adalah merchant yang
 * paling mungkin mencabut internetnya.
 */

export type PetaFitur = Readonly<Record<string, boolean>>;

interface BarisFitur {
  kunci: string;
  aktif: number | bigint | string;
}

/**
 * Seluruh fitur beserta keadaannya di perangkat ini.
 *
 * ⛔ Selalu memuat SETIAP kunci di `FITUR`, apa pun isi tabelnya. Pemanggil
 * yang harus memeriksa `undefined` akan lupa memeriksanya di satu tempat, dan
 * `undefined` di `if` adalah "mati".
 */
export async function bacaFitur(db: DbLokal): Promise<PetaFitur> {
  const hasil: Record<string, boolean> = {};
  for (const f of FITUR) hasil[f.kunci] = f.bawaan;

  let baris: BarisFitur[] = [];
  try {
    baris = await db.getAll<BarisFitur>(`SELECT kunci, aktif FROM fitur_lokal`);
  } catch {
    // ⛔ Ditelan, alasan yang sama dengan `rekam()` telemetri: perangkat yang
    // migrasi lokalnya belum jalan menjawab `no such table`, dan flag yang
    // menjatuhkan layar kasir jauh lebih berbahaya daripada flag yang tidak
    // ada. Bawaan kode sudah terisi di atas.
    return hasil;
  }

  for (const b of baris) {
    // Kunci yang tidak dikenal DIABAIKAN, tidak ditambahkan. Baris yang
    // tertinggal untuk fitur yang sudah dihapus dari kode tidak boleh muncul
    // sebagai fitur apa pun.
    if (!(b.kunci in hasil)) continue;
    // ⛔ Menerima ketiga bentuk yang benar-benar keluar dari driver SQLite:
    // `@powersync/web` mengembalikan INTEGER besar sebagai `bigint`,
    // `node:sqlite` sebagai `number` (`CLAUDE.md`).
    hasil[b.kunci] = Number(b.aktif) === 1;
  }
  return hasil;
}

/** `false` untuk kunci asing — sama dengan `resolusiFitur` di domain. */
export function fiturAktif(peta: PetaFitur, kunci: string): boolean {
  return peta[kunci] ?? false;
}

/**
 * Menulis keadaan yang baru diambil dari server.
 *
 * ⛔ `INSERT OR REPLACE` per baris, BUKAN hapus-lalu-tulis. Jendela antara
 * `DELETE` dan `INSERT` adalah jendela tempat pembacaan lain melihat tabel
 * kosong — dan tabel kosong berarti seluruh fitur kembali ke bawaan, yaitu
 * kill switch yang mati sesaat setiap kali disegarkan.
 *
 * ⛔ Kunci yang HILANG dari respons TIDAK dihapus. Server yang menghapus
 * sebuah fitur dari daftarnya sudah menyatakan fitur itu tidak ada lagi;
 * barisnya tidak berbahaya karena `bacaFitur` mengabaikan kunci asing, dan
 * menghapusnya menuntut membedakan "server tidak menyebutnya" dari "respons
 * terpotong".
 */
export async function simpanFitur(
  db: DbLokal,
  fitur: Record<string, boolean>,
  pada: string
): Promise<void> {
  for (const [kunci, aktif] of Object.entries(fitur)) {
    await db.execute(
      `INSERT OR REPLACE INTO fitur_lokal (kunci, aktif, disegarkan_pada) VALUES (?, ?, ?)`,
      [kunci, aktif ? 1 : 0, pada]
    );
  }
}
