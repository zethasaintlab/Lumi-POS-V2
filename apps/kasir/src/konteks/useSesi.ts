import { useEffect, useState } from 'react';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { bolehLogout, type Sesi } from '../identitas/login.ts';
import { ringkasanAntrean } from '../../../../packages/sync-client/src/status.ts';
import { lokalSekarang } from './DbLokalProvider.tsx';

/* Sesi kasir yang sedang berjalan.

   ⛔ MURNI LOKAL dan tidak pernah kedaluwarsa. `spec-f:183`: "sesi
   back-office kedaluwarsa; sesi kasir TIDAK — shift yang menentukan."
   Sesi yang habis di tengah antrean pelanggan adalah tepat friksi yang
   `spec-f:116` sebut menyebabkan berbagi akun. */

export async function bacaSesi(db: DbLokal): Promise<Sesi | null> {
  const baris = await db.getAll<{
    user_id: string;
    nama: string;
    peran: string;
    masuk_pada: string;
    wajib_ganti_pin: number;
  }>(`SELECT user_id, nama, peran, masuk_pada, wajib_ganti_pin FROM sesi_lokal WHERE id = 1`);

  const b = baris[0];
  if (!b) return null;
  return {
    userId: b.user_id,
    nama: b.nama,
    peran: JSON.parse(b.peran) as string[],
    masukPada: b.masuk_pada,
    wajibGantiPin: b.wajib_ganti_pin === 1,
  };
}

export async function simpanSesi(sesi: Sesi): Promise<void> {
  const { db } = await lokalSekarang();
  await db.execute(
    `INSERT OR REPLACE INTO sesi_lokal (id, user_id, nama, peran, masuk_pada, wajib_ganti_pin)
     VALUES (1, ?, ?, ?, ?, ?)`,
    [sesi.userId, sesi.nama, JSON.stringify(sesi.peran), sesi.masukPada, sesi.wajibGantiPin ? 1 : 0]
  );
  pemberitahuSesi.forEach((f) => f());
}

/**
 * FR-H4 — logout, dan alasan ia bisa ditolak.
 *
 * `spec-f:207`: "Logout diblokir saat antrean upload tidak kosong, dengan
 * pesan yang menjelaskan — pelajaran dari Toast, di mana logout offline
 * mengunci pengguna."
 *
 * Antrean diperiksa DI SINI, tepat sebelum menghapus sesi, bukan di layar
 * yang menampilkan tombolnya. Tombol yang dinonaktifkan berdasarkan angka
 * yang dibaca beberapa detik sebelumnya akan meloloskan penjualan yang masuk
 * di antara keduanya.
 */
export async function keluar(): Promise<{ berhasil: boolean; pesan: string }> {
  const { db } = await lokalSekarang();
  const ringkasan = await ringkasanAntrean(db);
  // `menunggu + gagal`, bukan `menunggu` saja. Item yang GAGAL terkirim tetap
  // penjualan yang hanya ada di perangkat ini — membiarkannya lolos berarti
  // FR-H4 justru tidak berlaku pada keadaan yang paling membutuhkannya.
  const izin = bolehLogout({ jumlahBelumTerkirim: ringkasan.menunggu + ringkasan.gagal });
  if (!izin.boleh) return { berhasil: false, pesan: izin.pesan };

  await db.execute(`DELETE FROM sesi_lokal WHERE id = 1`);
  pemberitahuSesi.forEach((f) => f());
  return { berhasil: true, pesan: '' };
}

/* Pemberitahu sederhana, pola yang sama dengan `buatPemberitahu()` di
   packages/sync-client: `watch()` PowerSync butuh ~1.000 ms untuk melihat
   perubahan raw table, dan `sesi_lokal` bahkan bukan raw table sama sekali —
   ia tidak akan pernah terlihat `watch()`. */
const pemberitahuSesi = new Set<() => void>();

export function useSesi(): { sesi: Sesi | null; siap: boolean } {
  const [sesi, setSesi] = useState<Sesi | null>(null);
  const [siap, setSiap] = useState(false);

  useEffect(() => {
    let hidup = true;
    const baca = () => {
      void lokalSekarang()
        .then(({ db }) => bacaSesi(db))
        .then((s) => {
          if (!hidup) return;
          setSesi(s);
          setSiap(true);
        })
        .catch(() => hidup && setSiap(true));
    };
    baca();
    pemberitahuSesi.add(baca);
    return () => {
      hidup = false;
      pemberitahuSesi.delete(baca);
    };
  }, []);

  return { sesi, siap };
}
