import { periksaPassword } from '../../../../packages/domain/src/password.ts';
import { zonaSah } from '../../../../packages/domain/src/zona-waktu.ts';

/**
 * B-00b — muatan pendaftaran merchant.
 *
 * Murni: form masuk → muatan `POST /tenants` keluar. Tanpa DOM, tanpa
 * jaringan, tanpa `randomUUID` — seluruh aturannya dapat diuji di `node
 * --test`, dan yang tidak dapat diuji di sana tidak ada di sini.
 *
 * ## ⛔ Id DITERIMA, tidak di-generate
 *
 * Ini bukan sekadar demi testabilitas. `POST /tenants` idempoten **hanya**
 * lewat PK `tenant.id` (`register.ts`): id yang sama diulang menjawab 409, id
 * BARU menghasilkan tenant KEDUA.
 *
 * Kalau fungsi ini memanggil `randomUUID()` sendiri, setiap penekanan tombol
 * "Daftar" membawa id baru — dan merchant yang menekannya dua kali karena
 * responsnya lambat mendapat dua tenant. Yang kedua tidak dapat dihapus lewat
 * API mana pun, dan ia ikut terhitung di kuota.
 *
 * Karena itu identitasnya dibuat SEKALI per kunjungan layar dan dipakai ulang
 * di setiap percobaan.
 *
 * ## Aturan password dari DOMAIN, bukan disalin
 *
 * `packages/domain/src/password.ts` adalah satu-satunya definisi FR-F2b, dan
 * server menegakkannya pada request yang sama. Salinan di klien akan
 * menyimpang — dan yang menyimpang di sini menghasilkan form yang menerima
 * password lalu server menolaknya, di layar yang tidak dapat menjelaskan
 * kenapa.
 */

export interface FormPendaftaran {
  namaMerchant: string;
  namaOutlet: string;
  zonaWaktu: string;
  namaOwner: string;
  email: string;
  password: string;
  alamat?: string;
}

export interface IdentitasPendaftaran {
  tenantId: string;
  outletId: string;
  ownerId: string;
}

export interface MuatanPendaftaran {
  tenant: { id: string; name: string };
  outlet: { id: string; name: string; timezone: string; address: string | null };
  owner: { id: string; name: string; email: string; password: string };
}

export type HasilMuatan =
  | { ok: true; muatan: MuatanPendaftaran }
  | { ok: false; bidang: keyof FormPendaftaran; pesan: string };

/**
 * Field wajib beserta pesannya.
 *
 * ⛔ Penolakan MENUNJUK fieldnya. Pesan tanpa field membuat form berisi enam
 * isian menampilkan satu baris merah di bawah tombol, dan merchant memeriksa
 * keenamnya satu per satu untuk menemukan mana yang dimaksud.
 */
const WAJIB: readonly [keyof FormPendaftaran, string][] = [
  ['namaMerchant', 'Nama usaha wajib diisi.'],
  ['namaOutlet', 'Nama outlet wajib diisi.'],
  ['namaOwner', 'Nama Anda wajib diisi.'],
  ['email', 'Email wajib diisi.'],
];

export function buatMuatanPendaftaran(
  form: FormPendaftaran,
  identitas: IdentitasPendaftaran
): HasilMuatan {
  for (const [bidang, pesan] of WAJIB) {
    if (String(form[bidang] ?? '').trim().length === 0) {
      return { ok: false, bidang, pesan };
    }
  }

  if (!zonaSah(form.zonaWaktu)) {
    // CHECK constraint di `0002_tenancy.sql` juga menjaga kolom ini, tapi ia
    // menjawab lewat error PostgreSQL yang tidak dikenal — 500, bukan pesan.
    return { ok: false, bidang: 'zonaWaktu', pesan: 'Pilih salah satu zona waktu.' };
  }

  // ⛔ Password TIDAK dipangkas, dan diperiksa apa adanya. Spasi di tepi adalah
  // karakter yang sah; memangkasnya membuat password yang diterima saat
  // mendaftar ditolak saat masuk — di jalur yang menjawab satu pesan yang sama
  // untuk setiap sebab, jadi merchant tidak akan pernah tahu kenapa.
  const periksa = periksaPassword(form.password);
  if (!periksa.ok) {
    return { ok: false, bidang: 'password', pesan: periksa.pesan };
  }

  const alamat = String(form.alamat ?? '').trim();

  return {
    ok: true,
    muatan: {
      tenant: { id: identitas.tenantId, name: form.namaMerchant.trim() },
      outlet: {
        id: identitas.outletId,
        name: form.namaOutlet.trim(),
        timezone: form.zonaWaktu,
        address: alamat.length > 0 ? alamat : null,
      },
      owner: {
        id: identitas.ownerId,
        name: form.namaOwner.trim(),
        email: form.email.trim(),
        password: form.password,
      },
    },
  };
}
