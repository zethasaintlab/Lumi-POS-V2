import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import {
  bacaKonfigPerangkat,
  simpanKonfigPerangkat,
  type KonfigPerangkat,
} from '../../../../packages/sync-client/src/perangkat.ts';
import { ringkasanAntrean } from '../../../../packages/sync-client/src/status.ts';
import {
  identitasBerubah,
  periksaOperasiDestruktif,
} from '../../../../packages/domain/src/operasi-destruktif.ts';

/**
 * FR-H4 — menyimpan identitas perangkat, dengan blokirnya. `spec-h:279`.
 *
 * ## ⛔ Kenapa ia BUKAN bagian dari komponen layar
 *
 * AC ketiga menuntut blokirnya "ditegakkan di lapisan domain, bukan hanya
 * menyembunyikan tombol", dan itu bukan soal kemurnian. Aturan yang hidup di
 * dalam `Perangkat.tsx` hanya dapat diuji lewat DOM, dan yang hanya dapat
 * diuji lewat DOM biasanya diuji lewat penjaga struktural — yang, terbukti
 * lewat sabotase, tetap lolos bila pemanggilnya dihapus tapi import-nya
 * tertinggal.
 *
 * Bentuknya menyalin `keluar()` di `konteks/useSesi.ts`: satu fungsi yang
 * membaca antrean tepat sebelum menulis, dan mengembalikan penolakan alih-alih
 * melempar.
 *
 * ## ⛔ Antrean dibaca TEPAT SEBELUM menulis
 *
 * Bukan saat layar dibuka. Angka yang dibaca beberapa detik sebelumnya sudah
 * basi begitu satu penjualan masuk, dan penjualan yang masuk di antara
 * keduanya adalah tepat penjualan yang hilang.
 */
export async function simpanIdentitasPerangkat(
  db: DbLokal,
  baru: KonfigPerangkat
): Promise<{ berhasil: boolean; pesan: string }> {
  const lama = await bacaKonfigPerangkat(db);

  // ⛔ Hanya perubahan IDENTITAS yang diblokir. Alamat server dan kredensial
  // adalah jalan MEMPERBAIKI antrean yang macet — memblokir keduanya karena
  // antreannya tidak kosong mengunci merchant di dalam keadaan itu selamanya.
  if (identitasBerubah(lama, baru)) {
    const { menunggu, gagal } = await ringkasanAntrean(db);
    // `menunggu + gagal`: item yang GAGAL tetap penjualan yang hanya ada di
    // perangkat ini. Menghitung yang menunggu saja membuat FR-H4 tidak berlaku
    // pada keadaan yang paling membutuhkannya.
    const izin = periksaOperasiDestruktif('ganti_identitas_perangkat', {
      jumlahBelumTerkirim: menunggu + gagal,
    });
    if (!izin.boleh) return { berhasil: false, pesan: izin.pesan };
  }

  await simpanKonfigPerangkat(db, baru);
  return { berhasil: true, pesan: '' };
}
