import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { PinHasher } from '../../../../packages/domain/src/pin.ts';
import { bolehkah } from '../../../../packages/domain/src/rbac.ts';
import {
  catatanCukup,
  KODE_LAINNYA,
  MIN_PANJANG_CATATAN,
} from '../../../../packages/domain/src/alasan.ts';
import { catatGagal, type BarisKunci } from './login.ts';

/**
 * Otorisasi step-up (K-11 — FR-B8/B9, `spec-f` §F.3).
 *
 * ## ⛔ Kenapa ini BUKAN `masuk()` dengan parameter lain
 *
 * AC `spec-f:279`: "Sesi kasir identik sebelum dan sesudah otorisasi."
 * Godaannya besar untuk memakai ulang `masuk()` — keduanya mencocokkan PIN
 * terhadap daftar pengguna yang sama. Tapi `masuk()` MENULIS `sesi_lokal`,
 * dan dialog otorisasi yang melakukannya akan menukar sesi kasir dengan sesi
 * manajer diam-diam.
 *
 * Akibatnya tidak terlihat di layar sama sekali: penjualan berikutnya
 * dinisbatkan ke manajer, dan itu baru muncul di laporan berminggu-minggu
 * kemudian — persis jenis kerusakan atribusi yang membuat delapan laporan
 * exception Modul G tidak berguna (`spec-f:116`).
 *
 * Karena itu berkas ini berdiri sendiri dan **tidak pernah menyentuh
 * `sesi_lokal`**, dan test-nya memeriksa itu lewat pernyataan yang dijalankan
 * — bukan lewat nilai akhirnya, karena tulis-lalu-tulis-balik akan lolos.
 *
 * ## Yang dibagi dengan login, dan kenapa
 *
 * Penguncian PIN (`catatGagal`, `hitungPenguncian`) dipakai ulang apa adanya.
 * AC `spec-f:280` menuntut rate limiting berlaku pada PIN penyetuju, dan
 * alasannya langsung: dialog ini adalah permukaan tebak-PIN yang jauh lebih
 * sering terbuka daripada layar login — ia muncul setiap refund.
 */

export type HasilOtorisasi =
  | { status: 'disetujui'; approverId: string; approverNama: string }
  | { status: 'pin_salah'; pesan: string }
  | { status: 'tidak_berhak'; pesan: string }
  | { status: 'sama_dengan_aktor'; pesan: string }
  | { status: 'terkunci'; pesan: string; detikTersisa: number };

interface BarisPengguna {
  id: string;
  name: string;
  pin_hash: string | null;
  is_active: number;
}

const KUNCI_PERANGKAT = '@perangkat';

export async function otorisasi({
  db,
  hasher,
  waktu,
  pin,
  aktorId,
  operasi,
}: {
  db: DbLokal;
  hasher: PinHasher;
  waktu: () => Date;
  pin: string;
  /** Kasir yang sedang masuk. Sesinya TIDAK boleh berubah. */
  aktorId: string;
  operasi: string;
}): Promise<HasilOtorisasi> {
  const sekarang = waktu();

  const pengguna = await db.getAll<BarisPengguna>(
    `SELECT id, name, pin_hash, pin_must_change, is_active
       FROM "user" WHERE is_active = 1 AND pin_hash IS NOT NULL`
  );

  let cocok: BarisPengguna | null = null;
  for (const u of pengguna) {
    if (u.is_active !== 1 || !u.pin_hash) continue;
    if (await hasher.verifikasi(pin, u.pin_hash)) {
      cocok = u;
      break;
    }
  }

  if (!cocok) {
    // Dual-layer, sama seperti login: hitungan tak-ternisbat pada perangkat.
    const kunciPerangkat = await bacaKunci(db, KUNCI_PERANGKAT);
    const sampai = kunciPerangkat?.terkunci_sampai ? Date.parse(kunciPerangkat.terkunci_sampai) : null;
    if (sampai !== null && sampai > sekarang.getTime()) return terkunci(sampai, sekarang);

    const hasil = await catatGagal(db, KUNCI_PERANGKAT, sekarang);
    if (hasil.terkunci) {
      return {
        status: 'terkunci',
        pesan: `Otorisasi terkunci. Coba lagi dalam ${hasil.detik} detik.`,
        detikTersisa: hasil.detik,
      };
    }
    return { status: 'pin_salah', pesan: 'PIN salah.' };
  }

  const kunci = await bacaKunci(db, cocok.id);
  const sampai = kunci?.terkunci_sampai ? Date.parse(kunci.terkunci_sampai) : null;
  if (sampai !== null && sampai > sekarang.getTime()) return terkunci(sampai, sekarang);

  // ⛔ Diperiksa SEBELUM hak akses, dan urutannya penting.
  //
  // Manajer outlet yang menjalankan kasir sendiri adalah hal biasa di kafe
  // kecil — ia PUNYA `approve_authorization`, jadi pemeriksaan hak tidak akan
  // menangkapnya. `audit_event` punya CHECK yang menolak aktor menyetujui
  // dirinya sendiri di server, tapi kalau dialog di perangkat meloloskannya,
  // kasir baru tahu setelah refund gagal terkirim — dan saat itu uangnya
  // sudah keluar laci.
  if (cocok.id === aktorId) {
    return {
      status: 'sama_dengan_aktor',
      pesan: 'Anda tidak dapat menyetujui operasi Anda sendiri. Minta persetujuan orang lain.',
    };
  }

  const peran = await db.getAll<{ role: string }>(
    `SELECT role FROM user_role WHERE user_id = ?`,
    [cocok.id]
  );
  if (!bolehkah(peran.map((p) => p.role), operasi)) {
    // Pesan BERBEDA dari "PIN salah". Membocorkan keberadaan pengguna di sini
    // tidak menambah risiko — orangnya sedang berdiri di depan mesin dan baru
    // saja membuktikan ia tahu PIN yang sah. Yang berisiko justru pesan
    // seragam: manajer yang perannya kurang akan mengetik ulang PIN yang
    // benar sampai terkunci.
    return {
      status: 'tidak_berhak',
      pesan: `${cocok.name} tidak berhak menyetujui operasi ini.`,
    };
  }

  // Penguncian penyetuju dibersihkan — PIN-nya terbukti benar.
  await db.execute(`DELETE FROM pin_lockout_lokal WHERE user_id = ?`, [cocok.id]);

  return { status: 'disetujui', approverId: cocok.id, approverNama: cocok.name };
}

async function bacaKunci(db: DbLokal, userId: string): Promise<BarisKunci | null> {
  const baris = await db.getAll<BarisKunci>(
    `SELECT gagal_berturut, terkunci_sampai, jumlah_penguncian, jendela_mulai
       FROM pin_lockout_lokal WHERE user_id = ?`,
    [userId]
  );
  return baris[0] ?? null;
}

function terkunci(sampaiMs: number, sekarang: Date): HasilOtorisasi {
  const detikTersisa = Math.ceil((sampaiMs - sekarang.getTime()) / 1000);
  return {
    status: 'terkunci',
    pesan: `Otorisasi terkunci. Coba lagi dalam ${detikTersisa} detik.`,
    detikTersisa,
  };
}

// ---------------------------------------------------------------------------
// Alasan dari daftar tertutup (FR-F11, `spec-b` §B.4)
// ---------------------------------------------------------------------------

export interface Alasan {
  kode: string;
  label: string;
}

/**
 * `spec-b` §B.4. Daftarnya TERTUTUP karena free text tidak dapat diagregasi
 * jadi laporan fraud — dan itu seluruh gunanya (`spec-f:378`).
 *
 * Harus sama persis dengan daftar server (`packages/domain/src/cancellation.ts`);
 * daftar yang berbeda menghasilkan alasan yang diterima perangkat lalu
 * ditolak server setelah antrean terkuras.
 */
export const ALASAN_REFUND: readonly Alasan[] = [
  { kode: 'barang_rusak', label: 'Barang rusak' },
  { kode: 'pesanan_salah', label: 'Pesanan salah' },
  { kode: 'pelanggan_tidak_puas', label: 'Pelanggan tidak puas' },
  { kode: 'kelebihan_bayar', label: 'Kelebihan bayar' },
  { kode: 'lainnya', label: 'Lainnya' },
];

export const ALASAN_VOID: readonly Alasan[] = [
  { kode: 'salah_input', label: 'Salah input' },
  { kode: 'pelanggan_batal', label: 'Pelanggan batal' },
  { kode: 'item_habis', label: 'Item habis' },
  { kode: 'uji_coba', label: 'Uji coba' },
  { kode: 'lainnya', label: 'Lainnya' },
];

/**
 * `null` bila sah; pesan bila tidak.
 *
 * ⛔ Panjang minimum catatan datang dari `packages/domain/src/alasan.ts`, dan
 * ia TIDAK disalin ke sini. Angka yang punya dua salinan akan menyimpang pada
 * perubahan berikutnya — menghasilkan satu operasi yang menerima catatan lima
 * karakter sementara server menolaknya, lalu berhenti permanen di antrean.
 *
 * `catatanCukup` juga menghitung per TITIK KODE, bukan per unit UTF-16;
 * versi sebelumnya di sini memakai `.length` mentah.
 */
export function validasiAlasan(
  daftar: readonly Alasan[],
  kode: string,
  catatan: string | null
): string | null {
  if (!daftar.some((a) => a.kode === kode)) {
    return 'Pilih alasan dari daftar.';
  }
  if (kode === KODE_LAINNYA && !catatanCukup(catatan)) {
    return `Alasan "Lainnya" wajib disertai catatan minimal ${MIN_PANJANG_CATATAN} karakter.`;
  }
  return null;
}
