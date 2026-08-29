/**
 * F.5 — akses support. `spec-f:391`.
 *
 * *"Untuk mendukung ratusan merchant, akses support diperlukan — tetapi harus
 * menjadi fitur SISTEM, bukan akses database langsung."*
 *
 * Alternatif yang tidak dibangun adalah alternatif yang akan dipakai: staf
 * yang tidak punya jalan resmi akan diberi kredensial database, dan sejak saat
 * itu tidak ada satu pun baris yang mencatat siapa membaca apa milik merchant
 * mana.
 *
 * Murni: tanpa I/O, tanpa jam sendiri. Waktu selalu diserahkan pemanggil —
 * di server ia jam DATABASE (`CLAUDE.md`: tidak pernah `new Date()` di Node).
 */

/** `spec-f:400` — "Default 2 jam, maksimum 24 jam". */
export const DURASI_BAWAAN_MENIT = 120;
export const DURASI_MAKS_MENIT = 24 * 60;
export const DURASI_MIN_MENIT = 5;

/**
 * Alasan akses — daftar TERTUTUP.
 *
 * ⛔ Sama seperti alasan void dan alasan kas: teks bebas tidak dapat
 * diagregasi menjadi laporan (`spec-f:378`), dan "berapa sering support
 * meminta akses ke data merchant, dan untuk apa" adalah persis pertanyaan yang
 * harus dapat dijawab tanpa membaca ratusan kalimat satu per satu.
 *
 * `lainnya` tetap ada dan menuntut catatan — daftar yang tidak punya jalan
 * keluar akan dipakai dengan alasan yang salah oleh orang yang sedang
 * terburu-buru.
 */
export const ALASAN_SUPPORT = [
  'investigasi_laporan_bug',
  'pemulihan_data',
  'bantuan_konfigurasi',
  'audit_atas_permintaan_merchant',
  'lainnya',
] as const;

export type AlasanSupport = (typeof ALASAN_SUPPORT)[number];

export function adalahAlasanSupport(nilai: unknown): nilai is AlasanSupport {
  return typeof nilai === 'string' && (ALASAN_SUPPORT as readonly string[]).includes(nilai);
}

export interface PermintaanSesiSupport {
  adminLabel: string;
  alasan: string;
  catatan: string | null;
  durasiMenit: number | null;
  /** `spec-f:403` — menulis menuntut persetujuan TERPISAH. */
  bolehMenulis: boolean;
}

export type HasilPeriksa =
  | { ok: true; durasiMenit: number }
  | { ok: false; kode: string; pesan: string };

/**
 * Memeriksa satu permintaan pemberian akses.
 *
 * ⛔ `durasiMenit` yang tidak disebut memakai BAWAAN, bukan maksimum. Owner
 * yang menyetujui tanpa memikirkan durasinya tidak boleh diberi jendela 24 jam
 * — bawaan yang paling permisif adalah bawaan yang berlaku untuk hampir
 * semua orang.
 */
export function periksaPermintaanSupport(p: PermintaanSesiSupport): HasilPeriksa {
  if (typeof p.adminLabel !== 'string' || p.adminLabel.trim() === '') {
    return {
      ok: false,
      kode: 'VALIDATION_ERROR',
      pesan: 'Nama petugas support wajib diisi — akses tanpa nama tidak dapat dipertanggungjawabkan.',
    };
  }
  if (!adalahAlasanSupport(p.alasan)) {
    return {
      ok: false,
      kode: 'REASON_INVALID',
      pesan: `Alasan harus salah satu dari: ${ALASAN_SUPPORT.join(', ')}.`,
    };
  }
  if (p.alasan === 'lainnya' && (p.catatan === null || p.catatan.trim() === '')) {
    return {
      ok: false,
      kode: 'REASON_NOTE_REQUIRED',
      pesan: 'Alasan "lainnya" wajib disertai catatan.',
    };
  }

  const durasi = p.durasiMenit ?? DURASI_BAWAAN_MENIT;
  if (!Number.isInteger(durasi)) {
    return { ok: false, kode: 'VALIDATION_ERROR', pesan: 'Durasi harus bilangan bulat menit.' };
  }
  if (durasi < DURASI_MIN_MENIT || durasi > DURASI_MAKS_MENIT) {
    return {
      ok: false,
      kode: 'VALIDATION_ERROR',
      pesan: `Durasi harus antara ${DURASI_MIN_MENIT} dan ${DURASI_MAKS_MENIT} menit (maksimum 24 jam).`,
    };
  }
  return { ok: true, durasiMenit: durasi };
}

export interface BarisSesiSupport {
  expiresAt: Date;
  endedAt: Date | null;
  isWriteEnabled: boolean;
}

/**
 * Apakah sesi ini sedang berlaku pada `pada`.
 *
 * ⛔ Kedaluwarsa adalah PERHITUNGAN, bukan pekerjaan terjadwal. `spec-f:410`
 * menuntut "sesi berakhir otomatis saat `expires_at`", dan job pembersih yang
 * tidak berjalan — deploy yang gagal, worker yang mati — akan membiarkan akses
 * hidup melewati batas yang merchant setujui, tanpa siapa pun melihatnya.
 * Yang dihitung saat dibaca tidak dapat gagal berjalan.
 *
 * ⛔ Batas atasnya EKSKLUSIF: sesi berakhir PADA `expires_at`, tidak
 * sesudahnya. "Sampai jam 5" yang berarti "termasuk detik pertama jam 5"
 * adalah jenis kelonggaran yang tidak ada alasannya dan yang akan dipakai.
 */
export function sesiBerlaku(s: BarisSesiSupport, pada: Date): boolean {
  if (s.endedAt !== null) return false;
  return pada.getTime() < s.expiresAt.getTime();
}

export type KeadaanSesi = 'aktif' | 'diakhiri' | 'kedaluwarsa';

/**
 * ⛔ "Diakhiri" DIBEDAKAN dari "kedaluwarsa", dan perbedaannya sampai ke
 * layar. Keduanya berarti akses sudah tidak berlaku, tetapi yang pertama
 * berarti merchant MENCABUTNYA — dan riwayat yang menyamakannya menghapus satu
 * -satunya sinyal bahwa seseorang merasa perlu memutus akses lebih awal.
 */
export function keadaanSesi(s: BarisSesiSupport, pada: Date): KeadaanSesi {
  if (s.endedAt !== null) return 'diakhiri';
  return pada.getTime() < s.expiresAt.getTime() ? 'aktif' : 'kedaluwarsa';
}

/**
 * Apakah operasi ini boleh dijalankan atas nama sesi support.
 *
 * ⛔ Read-only adalah BAWAAN (`spec-f:403`). Sesi yang tidak berlaku menolak
 * SEGALANYA, termasuk membaca — sesi yang kedaluwarsa masih dapat membaca
 * adalah sesi yang tidak benar-benar berbatas waktu.
 */
export function bolehLewatSupport(
  s: BarisSesiSupport,
  pada: Date,
  mutasi: boolean
): { boleh: true } | { boleh: false; kode: string; pesan: string } {
  if (!sesiBerlaku(s, pada)) {
    return {
      boleh: false,
      kode: 'SUPPORT_SESSION_EXPIRED',
      pesan: 'Sesi support sudah berakhir. Mintalah persetujuan baru dari merchant.',
    };
  }
  if (mutasi && !s.isWriteEnabled) {
    return {
      boleh: false,
      kode: 'SUPPORT_SESSION_READ_ONLY',
      pesan:
        'Sesi support ini hanya baca. Menulis memerlukan persetujuan terpisah dari merchant.',
    };
  }
  return { boleh: true };
}

/** Kedaluwarsa dari waktu mulai + durasi. Jamnya milik pemanggil. */
export function hitungKedaluwarsa(mulai: Date, durasiMenit: number): Date {
  return new Date(mulai.getTime() + durasiMenit * 60_000);
}

/**
 * Sisa waktu dalam menit, dibulatkan KE ATAS, minimum nol.
 *
 * ⛔ Ke atas, bukan ke bawah: banner yang berkata "0 menit tersisa" selama 59
 * detik terakhir memberi tahu merchant bahwa akses sudah berakhir sementara ia
 * masih berlaku.
 */
export function sisaMenit(s: BarisSesiSupport, pada: Date): number {
  const ms = s.expiresAt.getTime() - pada.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}
