/**
 * FR-H8 — antrean yang menua. Murni: tanpa I/O, tanpa jam.
 *
 * `spec-h:304`: *"Antrean yang tua berarti uang merchant belum tercatat —
 * metrik kesehatan #1."*
 *
 * | Umur antrean tertua | Tindakan (`spec-h:308-312`) |
 * |---|---|
 * | > 4 jam | Peringatan di layar kasir |
 * | > 24 jam | Notifikasi ke owner + dashboard kesehatan internal |
 * | > 72 jam | Kontak proaktif dari support |
 *
 * ## ⛔ Kenapa ini di `packages/domain` dan bukan di `sync-client`
 *
 * Ambangnya dibaca DUA sisi yang tidak berbagi kode lain: aplikasi kasir
 * membacanya dari antrean lokalnya sendiri, dan back-office membacanya dari
 * `device.last_seen_at` — dua sumber data yang sama sekali berbeda untuk
 * pertanyaan yang sama. Angka yang dipanggang di satu sisi akan menyimpang
 * dari sisi lain, dan gejalanya adalah kasir yang melihat peringatan
 * sementara layar owner tetap hijau. Aturan yang sama dengan
 * `AMBANG_SELISIH`.
 *
 * ## ⛔ Yang TIDAK dapat dilihat server, dan itu menentukan bentuk fitur ini
 *
 * Antrean yang menua adalah penjualan yang **belum pernah sampai** ke server.
 * Server karena itu tidak dapat melihatnya sama sekali — tidak ada baris
 * untuk dihitung. Yang dapat dilihatnya adalah perangkat yang **berhenti
 * menyapa**: `device.last_seen_at` yang basi.
 *
 * Keduanya bukan hal yang sama, dan menyamakannya akan berbohong ke dua arah:
 * perangkat yang mati (bukan offline) terlihat seperti antrean menua meski
 * tidak ada penjualan tertahan, dan perangkat yang online tapi selalu ditolak
 * server terlihat sehat. Karena itu keduanya dinamai berbeda di UI, dan
 * hanya AMBANGNYA yang dibagi.
 */

export interface AmbangAntrean {
  /** Peringatan di layar kasir. */
  peringatanJam: number;
  /** Notifikasi ke owner. */
  kritisJam: number;
  /** Kontak proaktif dari support. */
  daruratJam: number;
}

/**
 * Angka `spec-h:308-312`. AC FR-H8 pertama menuntut ambang **dapat
 * dikonfigurasi**; yang dapat diganti adalah nilainya lewat
 * `bacaAmbangAntrean`, bukan bentuk tangganya.
 */
export const AMBANG_ANTREAN: AmbangAntrean = {
  peringatanJam: 4,
  kritisJam: 24,
  daruratJam: 72,
};

export type TingkatAntrean = 'aman' | 'peringatan' | 'kritis' | 'darurat';

/**
 * Umur antrean dalam jam, atau `null` bila tidak ada yang mengantre.
 *
 * ⛔ Umur NEGATIF dijepit ke nol. Jam perangkat dapat mundur (`spec-h:351`),
 * dan `-3` jam yang lolos ke perbandingan di bawah membaca "aman" — untuk
 * antrean yang bisa saja berumur tiga hari.
 *
 * `sekarang` di-INJECT, tidak dibaca dari `Date.now()`. Prasyarat DST
 * (`spec-h:326`), dan ia yang membuat setiap ambang di bawah dapat diuji
 * tanpa menunggu 72 jam.
 */
export function umurAntreanJam(tertuaPada: string | null | undefined, sekarang: number): number | null {
  if (!tertuaPada) return null;
  const t = Date.parse(tertuaPada);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (sekarang - t) / 3_600_000);
}

/**
 * Tingkat peringatan untuk umur ini.
 *
 * ⛔ Perbandingannya `>=`, bukan `>`, dan itu keputusan yang dinyatakan:
 * `spec-h:308` menulis "> 4 jam". Selisihnya satu titik waktu, dan yang
 * dipilih adalah yang memperingatkan LEBIH DULU — antrean tepat 4 jam sudah
 * berarti uang merchant belum tercatat sejak sarapan.
 */
export function tingkatAntrean(
  umurJam: number | null,
  ambang: AmbangAntrean = AMBANG_ANTREAN
): TingkatAntrean {
  if (umurJam === null) return 'aman';
  if (umurJam >= ambang.daruratJam) return 'darurat';
  if (umurJam >= ambang.kritisJam) return 'kritis';
  if (umurJam >= ambang.peringatanJam) return 'peringatan';
  return 'aman';
}

/**
 * Kalimat peringatan untuk kasir. `null` berarti tidak ada yang perlu
 * ditampilkan.
 *
 * ⛔ Membawa ANGKANYA, pola `spec-e:152`. "Antrean menua" tanpa angka tidak
 * dapat dipakai memutuskan apa pun; "belum terkirim sejak 2 hari lalu"
 * dapat.
 *
 * ⛔ Kalimatnya TIDAK menyalahkan kasir dan tidak menyuruhnya berhenti
 * berjualan. `research/09:213` melarang menghentikan penjualan, dan kalimat
 * yang berbunyi seperti larangan akan dipatuhi seperti larangan.
 */
export function pesanAntreanMenua(tingkat: TingkatAntrean, umurJam: number | null): string | null {
  if (tingkat === 'aman' || umurJam === null) return null;

  const umur =
    umurJam >= 48
      ? `${Math.floor(umurJam / 24)} hari`
      : umurJam >= 24
        ? '1 hari'
        : `${Math.floor(umurJam)} jam`;

  const dasar = `Ada penjualan yang belum tercatat di server sejak ${umur} lalu.`;

  switch (tingkat) {
    case 'peringatan':
      return `${dasar} Penjualan tetap dapat dilanjutkan; sambungkan internet bila memungkinkan.`;
    case 'kritis':
      return `${dasar} Pemilik perlu diberi tahu — buka Status Sinkronisasi untuk melihat rinciannya.`;
    case 'darurat':
      return `${dasar} Hubungi dukungan Lumi, dan simpan ekspor darurat dari Status Sinkronisasi.`;
  }
}

/**
 * Membaca ambang dari konfigurasi lingkungan (AC FR-H8 pertama).
 *
 * Format: tiga bilangan dipisah koma, `"4,24,72"` — satu variabel, bukan tiga,
 * karena ketiganya hanya berarti bersama-sama.
 *
 * ⛔ Apa pun yang cacat jatuh ke bawaan SECARA UTUH, bukan sebagian. Ambang
 * campuran (`peringatan` dari env, `kritis` dari bawaan) adalah tangga yang
 * tidak pernah ditinjau siapa pun, dan ia dapat berakhir tidak menaik.
 * Menaik diperiksa di sini, bukan diasumsikan: `"72,24,4"` yang diterima
 * membuat setiap antrean langsung berstatus `darurat`.
 *
 * Invariant #5 — perbedaan lingkungan hanya lewat environment variable, dan
 * `env` dioper masuk alih-alih dibaca dari global.
 */
export function bacaAmbangAntrean(nilai: string | undefined | null): AmbangAntrean {
  if (typeof nilai !== 'string') return AMBANG_ANTREAN;

  const bagian = nilai.split(',').map((s) => Number(s.trim()));
  if (bagian.length !== 3) return AMBANG_ANTREAN;
  if (!bagian.every((n) => Number.isFinite(n) && n > 0)) return AMBANG_ANTREAN;

  const [peringatanJam, kritisJam, daruratJam] = bagian;
  if (!(peringatanJam < kritisJam && kritisJam < daruratJam)) return AMBANG_ANTREAN;

  return { peringatanJam, kritisJam, daruratJam };
}
