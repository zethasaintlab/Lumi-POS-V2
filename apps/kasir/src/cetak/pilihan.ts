import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';

/**
 * Pilihan profil printer perangkat ini — baca dan tulis.
 *
 * ## ⛔ Kenapa BUKAN di `KonfigPerangkat`
 *
 * `packages/sync-client/src/perangkat.ts` memegang identitas SINKRONISASI:
 * siapa perangkat ini, tenant mana, dan rahasianya. Relay memakainya pada
 * setiap putaran. Profil printer tidak dipakai relay sama sekali, dan
 * menaruhnya di sana berarti setiap pembacaan konfigurasi sinkronisasi ikut
 * membawa kolom yang tidak ada hubungannya — lalu kolom berikutnya menyusul,
 * sampai `KonfigPerangkat` menjadi tempat penyimpanan setelan apa pun.
 *
 * Kolomnya tetap di `device_config` karena tabel itu memang "setelan perangkat
 * ini", dan menambah tabel murni-lokal kedua untuk satu kolom lebih mahal
 * daripada nilainya.
 *
 * ## ⛔ Kegagalan membaca TIDAK menghentikan cetak
 *
 * Perangkat lama yang migrasi lokalnya belum jalan menjawab
 * `no such column: printer_profile_id`. Yang benar untuk itu adalah `null` —
 * "belum memilih" — bukan lemparan yang menggagalkan layar cetak ulang. Aturan
 * yang sama dengan `bacaProfilPrinter` terhadap tabel yang belum ada.
 */

export async function bacaPilihanProfil(db: DbLokal): Promise<string | null> {
  try {
    const baris = await db.getAll<{ printer_profile_id: string | null }>(
      `SELECT printer_profile_id FROM device_config WHERE id = 1`
    );
    const nilai = baris[0]?.printer_profile_id ?? null;
    return nilai === null || nilai === '' ? null : String(nilai);
  } catch {
    return null;
  }
}

/**
 * Menyimpan pilihan.
 *
 * ⛔ `UPDATE`, bukan `INSERT ... ON CONFLICT`. Baris `device_config` sudah ada
 * — perangkat yang belum dikonfigurasi tidak punya layar ini. Dan
 * `ON CONFLICT(id)` adalah bentuk SQL yang `wa-sqlite` pernah TOLAK sementara
 * `node:sqlite` menerimanya: hijau di seluruh test, gagal hanya di aplikasi.
 */
export async function simpanPilihanProfil(
  db: DbLokal,
  profilId: string,
  peripheralId: string
): Promise<void> {
  await db.execute(
    `UPDATE device_config SET printer_profile_id = ?, peripheral_id = ? WHERE id = 1`,
    [profilId, peripheralId]
  );
}
