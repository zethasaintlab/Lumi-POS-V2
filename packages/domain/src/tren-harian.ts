/**
 * FR-G6 — delta omzet hari ini terhadap kebiasaannya sendiri.
 *
 * ## ⛔ Pembandingnya HARI YANG SAMA, bukan hari sebelumnya
 *
 * `spec-g:243` menuliskannya sebagai acceptance criteria, dan alasannya nyata:
 * omzet kafe pada Sabtu dan Selasa berbeda jauh, dan itu normal. Delta
 * terhadap hari sebelumnya membuat **setiap Senin terlihat seperti bencana**
 * dan setiap Jumat terlihat seperti rekor — dua sinyal palsu yang muncul
 * setiap minggu, selamanya. Owner yang membukanya pukul 23:00 akan berhenti
 * mempercayai panah itu dalam dua minggu.
 *
 * Yang dibandingkan karena itu adalah Senin dengan rata-rata empat Senin
 * sebelumnya.
 *
 * ## ⛔ `null` BERBEDA dari 0%, dan perbedaannya sampai ke layar
 *
 * Merchant yang baru dua minggu berjualan tidak punya empat Senin sebelumnya.
 * Menampilkan "0%" untuknya adalah **pernyataan yang salah** — ia mengaku
 * omzet hari ini persis sama dengan kebiasaannya, dan kebiasaan itu belum ada.
 * `null` berarti "belum dapat dibandingkan", dan layar menuliskannya begitu.
 *
 * Murni: tanpa I/O, tanpa jam sendiri.
 */

/**
 * Berapa hari-sama yang harus ADA sebelum delta boleh dihitung.
 *
 * ⛔ Dua, bukan empat. Menuntut empat berarti merchant baru tidak melihat panah
 * apa pun selama sebulan penuh — persis periode ia paling ingin tahu apakah
 * dagangannya tumbuh. Dua sudah cukup untuk menjadi "kebiasaan" yang kasar,
 * dan `basisMinggu` di respons menyatakan seberapa kasar.
 *
 * `[ASUMSI]` — `spec-g` menyebut "rata-rata 4 minggu terakhir" tanpa menyatakan
 * apa yang terjadi bila belum ada empat.
 */
export const MINIMUM_HARI_PEMBANDING = 2;

/** Berapa minggu ke belakang yang dilihat. `spec-g:243`. */
export const MINGGU_PEMBANDING = 4;

export interface HariPembanding {
  /** `YYYY-MM-DD`, tanggal bisnis. */
  tanggal: string;
  /** Omzet bersih hari itu, rupiah utuh. Boleh negatif. */
  omzet: bigint;
}

export type Arah = 'naik' | 'turun' | 'datar';

export interface Tren {
  /** `null` = belum dapat dibandingkan. Lihat catatan kepala. */
  deltaPersen: number | null;
  arah: Arah;
  /** Rata-rata pembandingnya, `null` bila tidak dihitung. */
  rataRata: bigint | null;
  /** Berapa hari-sama yang benar-benar dipakai. */
  basisMinggu: number;
}

/**
 * Tanggal-tanggal hari-sama untuk empat minggu ke belakang.
 *
 * ⛔ Aritmetika tanggal dilakukan di UTC apa adanya, dan itu aman justru karena
 * masukannya **tanggal bisnis** — string `YYYY-MM-DD` yang sudah diturunkan
 * dari zona outlet dan jam tutupnya (`tanggal-bisnis.ts`). Menghitung ulang
 * zona di sini akan menjadi tempat kedua yang memutuskan hari apa sebuah
 * penjualan terjadi.
 */
export function tanggalPembanding(
  tanggalBisnis: string,
  minggu: number = MINGGU_PEMBANDING
): string[] {
  const dasar = new Date(`${tanggalBisnis}T00:00:00Z`);
  if (Number.isNaN(dasar.getTime())) {
    throw new TypeError(`Tanggal bisnis tidak sah: ${tanggalBisnis}`);
  }
  const hasil: string[] = [];
  for (let i = 1; i <= minggu; i += 1) {
    const d = new Date(dasar.getTime() - i * 7 * 86_400_000);
    hasil.push(d.toISOString().slice(0, 10));
  }
  return hasil;
}

/**
 * Delta omzet hari ini terhadap rata-rata hari-sama.
 *
 * ⛔ Hari yang TIDAK ADA di `pembanding` tidak dihitung nol. Outlet yang tutup
 * pada satu Senin tidak punya baris untuk hari itu, dan memperlakukannya
 * sebagai omzet nol menyeret rata-rata ke bawah — lalu Senin berikutnya
 * terlihat naik 40% karena outletnya kebetulan buka. Yang dipakai hanya hari
 * yang benar-benar punya data.
 *
 * ⛔ Rata-rata NOL menghasilkan `deltaPersen: null`, bukan pembagian dengan
 * nol maupun "naik tak hingga". Merchant yang empat Senin sebelumnya benar-
 * benar nol tidak punya kebiasaan untuk dibandingkan.
 */
export function trenHarian(omzetHariIni: bigint, pembanding: readonly HariPembanding[]): Tren {
  const dipakai = pembanding.slice(0, MINGGU_PEMBANDING);
  if (dipakai.length < MINIMUM_HARI_PEMBANDING) {
    return { deltaPersen: null, arah: 'datar', rataRata: null, basisMinggu: dipakai.length };
  }

  // ⛔ Rata-rata dihitung dengan `bigint`, dan pembagiannya MEMOTONG. Itu
  // benar di sini: yang dipakai berikutnya adalah persentase, dan selisih satu
  // rupiah pada rata-rata jutaan tidak menggeser satu digit pun yang tampil.
  const total = dipakai.reduce((a, h) => a + h.omzet, 0n);
  const rataRata = total / BigInt(dipakai.length);

  if (rataRata === 0n) {
    return { deltaPersen: null, arah: 'datar', rataRata, basisMinggu: dipakai.length };
  }

  const selisih = omzetHariIni - rataRata;
  // Persen sebagai `number` — ia angka tampilan, bukan uang. Uangnya tetap
  // `bigint` sampai titik ini.
  const persen = Number((selisih * 10000n) / rataRata) / 100;

  return {
    deltaPersen: persen,
    // ⛔ `datar` untuk selisih NOL saja, bukan untuk "kecil". Ambang
    // kekecilan adalah angka yang harus dipilih seseorang, dan tidak ada di
    // dokumen mana pun — jadi ia tidak dikarang di kode. Panah yang muncul
    // untuk 0,3% tetap jujur; layar dapat memilih tidak menonjolkannya.
    arah: selisih === 0n ? 'datar' : selisih > 0n ? 'naik' : 'turun',
    rataRata,
    basisMinggu: dipakai.length,
  };
}

/**
 * Rata-rata nilai per transaksi.
 *
 * ⛔ `null` untuk NOL transaksi, bukan nol rupiah. "Rp 0 per transaksi"
 * mengaku ada transaksi yang nilainya nol; yang benar adalah belum ada
 * transaksi sama sekali, dan itu keadaan yang berbeda.
 */
export function rataRataPerTransaksi(omzet: bigint, jumlah: number): bigint | null {
  if (!Number.isInteger(jumlah) || jumlah <= 0) return null;
  return omzet / BigInt(jumlah);
}
