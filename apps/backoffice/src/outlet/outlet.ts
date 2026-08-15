import { zonaSah } from '../../../../packages/domain/src/zona-waktu.ts';

/**
 * B-23 — Outlet. Murni.
 *
 * ## ⛔ Kontraknya hanya punya DUA operasi
 *
 * `listOutlets` dan `createOutlet`. **Tidak ada** `PATCH /outlets/{id}`,
 * tidak ada archive maupun restore — meski kolom `outlet.archived_at` ada di
 * migrasi `0002` dan ikut di respons daftar.
 *
 * Ketiadaan itu mudah dikira kelalaian layar, jadi layar menyatakannya, dan
 * ada test yang menyematkan daftar operasinya. Kalau kelak endpointnya
 * ditambahkan, test itu merah — dan itulah sinyal untuk membangun tombolnya.
 */

export interface Outlet {
  id: string;
  name: string;
  timezone: string;
  address: string | null;
  archivedAt: string | null;
}

export interface FormOutlet {
  nama: string;
  zonaWaktu: string;
  alamat: string;
}

interface MuatanOutlet {
  id: string;
  name: string;
  timezone: string;
  address: string | null;
}

export type HasilOutlet =
  | { ok: true; muatan: MuatanOutlet }
  | { ok: false; bidang: keyof FormOutlet; pesan: string };

export function buatMuatanOutlet(form: FormOutlet, id: string): HasilOutlet {
  const nama = String(form.nama ?? '').trim();
  if (nama.length === 0) {
    return { ok: false, bidang: 'nama', pesan: 'Nama outlet wajib diisi.' };
  }

  if (!zonaSah(form.zonaWaktu)) {
    return { ok: false, bidang: 'zonaWaktu', pesan: 'Pilih salah satu zona waktu.' };
  }

  const alamat = String(form.alamat ?? '').trim();

  // ⛔ `verticalProfileId` TIDAK disertakan sama sekali.
  //
  // OQ-09: profil vertikal per outlet MEWARISI default tenant, dan
  // resolusinya `COALESCE(profil_outlet, default_tenant)`. Kontraknya menyebut
  // "dikosongkan berarti mewarisi".
  //
  // Layar ini tidak punya pemilih profil, jadi mengirim nilai apa pun berarti
  // memutuskan sesuatu yang tidak ditanyakannya kepada siapa pun. Pemilihnya
  // milik B-24 (Profil vertikal).
  return {
    ok: true,
    muatan: {
      id,
      name: nama,
      timezone: form.zonaWaktu,
      address: alamat.length > 0 ? alamat : null,
    },
  };
}

/**
 * Aktif lebih dulu, lalu nama.
 *
 * Server menjaminnya lewat `ORDER BY`, dan jaminan yang hanya hidup di SQL
 * tidak dapat diuji sama sekali (`CLAUDE.md`). Kalau urutannya penting bagi
 * pengguna, ia dimiliki di titik data disusun.
 */
export function urutkanOutlet(semua: readonly Outlet[]): Outlet[] {
  return [...semua].sort((a, b) => {
    const arsipA = a.archivedAt === null ? 0 : 1;
    const arsipB = b.archivedAt === null ? 0 : 1;
    if (arsipA !== arsipB) return arsipA - arsipB;
    return a.name.localeCompare(b.name, 'id');
  });
}
