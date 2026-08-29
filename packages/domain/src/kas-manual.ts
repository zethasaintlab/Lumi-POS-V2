/**
 * FR-D5 — kas masuk dan kas keluar di luar penjualan.
 *
 * `spec-d:189` mendaftarkan `paid_in` dan `paid_out` di enum `cash_movement`
 * sejak awal, dan `spec-d:202` menetapkan aturannya: *"`paid_in` dan
 * `paid_out` selalu memerlukan alasan."* Sampai 24 Agustus 2026 tidak ada satu
 * pun jalan untuk membuatnya.
 *
 * ## ⛔ Kenapa ketiadaannya adalah cacat, bukan fitur yang tertunda
 *
 * Saldo laci adalah `saldo_awal + SUM(cash_movement.delta)` (invariant
 * `spec-d:14`), dan tutup kas membandingkannya dengan hitungan fisik. Owner
 * yang mengambil Rp 500.000 dari laci untuk membayar pemasok tidak punya cara
 * mencatatnya — jadi tutup kas melaporkan **kekurangan Rp 500.000**, menuntut
 * otorisasi manajer untuk selisih yang sepenuhnya dapat dijelaskan, dan
 * laporan exception FR-G5 menandai kasirnya.
 *
 * Ini bentuk KEEMPAT dari cacat yang `CLAUDE.md` catat tiga kali — laci yang
 * angkanya berbeda dari uang yang benar-benar ada di dalamnya. Tiga yang
 * pertama adalah uang yang tidak pernah masuk; ini uang yang keluar dengan
 * sah dan tidak pernah tercatat.
 *
 * ## ⛔ TANPA PIN manajer, dan itu keputusan yang ditiru dari void
 *
 * Keputusan 1 Agustus 2026 menetapkan void berjalan **tanpa PIN manajer** —
 * cukup alasan daftar tertutup + audit + kontrol pelaporan. Alasannya berlaku
 * persis sama di sini, dan lebih kuat: di kafe kecil orang yang mengambil uang
 * dari laci SERING satu-satunya orang yang ada, dan ia adalah pemiliknya.
 * Menuntut penyetuju yang berbeda dari aktor (`CHECK` di `audit_event`
 * menegakkannya) membuat fiturnya mustahil dipakai justru oleh yang paling
 * membutuhkannya — dan orang yang tidak dapat mencatat akan tetap mengambil
 * uangnya.
 *
 * `[ASUMSI]` — `spec-d` tidak menyatakan siapa yang boleh. Yang dinyatakan
 * hanya bahwa alasannya wajib.
 *
 * Murni: tanpa I/O, tanpa waktu, tanpa database.
 */

export const EVENT_KAS_MASUK = 'cash_paid_in';
export const EVENT_KAS_KELUAR = 'cash_paid_out';

export type ArahKas = 'masuk' | 'keluar';

/**
 * Alasan kas masuk — daftar TERTUTUP.
 *
 * Free text tidak dapat diagregasi menjadi laporan (`spec-f:378`), dan itu
 * seluruh gunanya. Daftar ini tidak berpotongan dengan alasan no-sale: yang
 * dijelaskan bukan kenapa laci dibuka melainkan **dari mana uangnya datang**.
 */
export const ALASAN_KAS_MASUK = [
  'tambah_modal',
  'kembalian_dari_bank',
  'setoran_pemilik',
  'koreksi_pencatatan',
  'lainnya',
] as const;

/**
 * Alasan kas keluar — daftar TERTUTUP.
 *
 * ⛔ `setor_ke_bank` ADA di sini meski enum `cash_movement.type` punya
 * `bank_deposit` tersendiri. `spec-d:339` mencatatnya sebagai pertanyaan
 * terbuka ("apakah fitur setoran ke brankas dibutuhkan di v1 atau v1.1?"), dan
 * fitur itu belum diputuskan. Yang TIDAK boleh terjadi sementara itu adalah
 * merchant yang menyetor ke bank tidak punya cara mencatatnya sama sekali —
 * jadi ia dicatat sebagai `paid_out` beralasan, dan `counterpart_type` tetap
 * `bank` supaya baris itu dapat ditemukan lagi bila `bank_deposit` kelak
 * dibangun.
 */
export const ALASAN_KAS_KELUAR = [
  'bayar_pemasok',
  'biaya_operasional',
  'ambil_pemilik',
  'setor_ke_bank',
  'koreksi_pencatatan',
  'lainnya',
] as const;

export type AlasanKasMasuk = (typeof ALASAN_KAS_MASUK)[number];
export type AlasanKasKeluar = (typeof ALASAN_KAS_KELUAR)[number];

export function alasanUntuk(arah: ArahKas): readonly string[] {
  return arah === 'masuk' ? ALASAN_KAS_MASUK : ALASAN_KAS_KELUAR;
}

export function adalahAlasanKas(arah: ArahKas, nilai: unknown): boolean {
  return typeof nilai === 'string' && alasanUntuk(arah).includes(nilai);
}

/**
 * `counterpart_type` untuk sebuah alasan. FR-D6.
 *
 * `spec-d:216`: *"Field ini tidak dipakai v1 tetapi wajib diisi. Ia menjaga
 * jalur ke double-entry penuh tanpa harus menebak dari data historis nanti."*
 *
 * ⛔ Diturunkan dari ALASANNYA, bukan dari arahnya. "Ambil pemilik" dan "bayar
 * pemasok" keduanya `paid_out` dan keduanya mengurangi laci dengan jumlah yang
 * sama — tapi yang pertama `owner_draw` dan yang kedua `expense`, dan
 * pembukuan yang menyamakannya melaporkan biaya operasional yang tidak pernah
 * terjadi. Menebaknya belakangan dari `reason_code` adalah persis yang
 * `spec-d:216` ingin hindari.
 *
 * ⛔ `unidentified` untuk `lainnya`, dan itu JUJUR. Alasan bebas tidak dapat
 * dipetakan ke akun mana pun tanpa membaca catatannya, dan menebaknya
 * `expense` membuat setiap koreksi kecil masuk laporan biaya.
 */
const COUNTERPART: Readonly<Record<string, string>> = {
  // Masuk
  tambah_modal: 'owner_draw',
  kembalian_dari_bank: 'bank',
  setoran_pemilik: 'owner_draw',
  // Keluar
  bayar_pemasok: 'expense',
  biaya_operasional: 'expense',
  ambil_pemilik: 'owner_draw',
  setor_ke_bank: 'bank',
  // Keduanya
  koreksi_pencatatan: 'unidentified',
  lainnya: 'unidentified',
};

export function counterpartUntuk(alasan: string): string {
  return COUNTERPART[alasan] ?? 'unidentified';
}

export interface PermintaanKas {
  arah: ArahKas;
  /** Rupiah utuh, selalu POSITIF. Arahnya dinyatakan `arah`, bukan tandanya. */
  jumlah: bigint;
  alasan: string;
  catatan: string | null;
}

export type HasilKas =
  | { ok: true; delta: bigint; counterpart: string; eventType: string }
  | { ok: false; kode: string; pesan: string };

/**
 * Memeriksa satu permintaan dan menurunkan `delta` bertandanya.
 *
 * ⛔ Jumlah masuk POSITIF dan tandanya diturunkan di sini, bukan diterima dari
 * pemanggil. Klien yang mengirim `-50000` untuk kas MASUK akan mengurangi laci
 * yang seharusnya bertambah, dan tidak ada apa pun di layar yang berbeda —
 * angkanya benar, tandanya tidak, dan tutup kas baru menemukannya berjam-jam
 * kemudian sebagai selisih dua kali lipat.
 *
 * ⛔ Nol DITOLAK. Movement bernilai nol tidak memindahkan uang dan membuat
 * buku kas memuat baris yang tidak menjelaskan apa pun — aturan yang sama
 * dengan no-sale, yang justru TIDAK menulis `cash_movement` karena alasan itu.
 *
 * ⛔ Catatan WAJIB untuk `lainnya`. Alasan bebas yang tidak dijelaskan adalah
 * baris yang tidak dapat dibaca siapa pun enam bulan kemudian — dan `lainnya`
 * adalah yang paling sering dipilih orang yang sedang terburu-buru.
 */
export function periksaKas(p: PermintaanKas): HasilKas {
  if (!adalahAlasanKas(p.arah, p.alasan)) {
    return {
      ok: false,
      kode: 'REASON_INVALID',
      pesan: `Alasan harus salah satu dari: ${alasanUntuk(p.arah).join(', ')}.`,
    };
  }
  if (p.jumlah <= 0n) {
    return {
      ok: false,
      kode: 'VALIDATION_ERROR',
      pesan: 'Jumlah harus lebih dari nol. Arah uang ditentukan pilihan masuk/keluar, bukan tandanya.',
    };
  }
  if (p.alasan === 'lainnya' && (p.catatan === null || p.catatan.trim() === '')) {
    return {
      ok: false,
      kode: 'REASON_NOTE_REQUIRED',
      pesan: 'Alasan "lainnya" wajib disertai catatan — tanpa itu barisnya tidak menjelaskan apa pun.',
    };
  }
  return {
    ok: true,
    delta: p.arah === 'masuk' ? p.jumlah : -p.jumlah,
    counterpart: counterpartUntuk(p.alasan),
    eventType: p.arah === 'masuk' ? EVENT_KAS_MASUK : EVENT_KAS_KELUAR,
  };
}

/** Tipe `cash_movement` untuk arah ini. */
export function tipeMovement(arah: ArahKas): 'paid_in' | 'paid_out' {
  return arah === 'masuk' ? 'paid_in' : 'paid_out';
}
