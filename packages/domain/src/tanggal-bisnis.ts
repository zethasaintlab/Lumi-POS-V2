/**
 * Tanggal bisnis dan nomor struk.
 *
 * ## Kenapa tanggal bisnis bukan tanggal kalender
 *
 * `CLAUDE.md`: "Tanggal bisnis: berakhir saat tutup shift, bukan tengah
 * malam. Default 04:00." Kafe takeaway yang tutup pukul 02:00 menjual
 * sepanjang malam ke "hari" yang sama; memotongnya di tengah malam memecah
 * satu shift jadi dua tanggal, dan laporan harian merchant tidak lagi cocok
 * dengan uang di laci.
 *
 * ## Kenapa di packages/domain
 *
 * Sampai berkas ini ada, `business_date` SELALU disuplai klien di kontrak
 * API dan tidak ada satu pun kode yang menghitungnya — aturannya hidup hanya
 * di dokumen. Server memakainya untuk laporan dan untuk
 * `UNIQUE(device_id, business_date, sequence)`; klien memakainya untuk nomor
 * struk dan untuk memilih shift. Dua salinan menghasilkan struk
 * `K1-20260812-0001` untuk penjualan yang laporannya catat sebagai
 * 11 Agustus — dan tidak ada apa pun yang akan mengeluh.
 *
 * Murni: tanpa I/O, tanpa `Date.now()`. Momennya di-inject.
 */

const POLA_BATAS = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/**
 * Tanggal bisnis untuk satu momen, `YYYY-MM-DD`.
 *
 * ⛔ Dihitung di zona **OUTLET**, bukan zona perangkat. Tablet yang zonanya
 * salah set — atau dipindah antar kota — akan menanggalkan penjualan ke hari
 * yang keliru, dan `UNIQUE(device_id, business_date, sequence)` menolak struk
 * berikutnya dengan galat yang tidak menunjuk ke sebabnya sama sekali.
 *
 * `Intl.DateTimeFormat` dipakai, bukan aritmetika offset: offset zona bukan
 * konstanta (Asia/Jakarta kebetulan tetap, tapi aturan ini tidak boleh
 * bergantung pada kebetulan), dan `Intl` ada di Node maupun browser.
 *
 * @param batas `outlet.business_day_ends_at` — `HH:MM` atau `HH:MM:SS`
 *              (PostgreSQL mengembalikan `time` dengan detik).
 */
export function tanggalBisnis(momen: Date, timezone: string, batas: unknown): string {
  if (typeof batas !== 'string' || !POLA_BATAS.test(batas)) {
    throw new Error(`Batas hari bisnis tidak valid: ${String(batas)}. Bentuknya HH:MM.`);
  }
  const [jamBatas, menitBatas] = batas.split(':').map(Number);

  const bagian = bagianLokal(momen, timezone);
  const menitSekarang = bagian.jam * 60 + bagian.menit;

  // Batas INKLUSIF ke bawah: 04:00 memulai hari baru, bukan mengakhirinya.
  // Eksklusif akan meninggalkan satu menit yang tidak masuk hari mana pun.
  if (menitSekarang >= jamBatas * 60 + menitBatas) {
    return `${bagian.tahun}-${dua(bagian.bulan)}-${dua(bagian.hari)}`;
  }

  // Masih hari bisnis kemarin. Dikurangi lewat UTC atas komponen tanggal
  // LOKAL yang sudah diekstrak -- bukan `momen.getTime() - 86400000`, yang
  // akan meleset satu jam pada zona ber-DST.
  const kemarin = new Date(Date.UTC(bagian.tahun, bagian.bulan - 1, bagian.hari));
  kemarin.setUTCDate(kemarin.getUTCDate() - 1);
  return `${kemarin.getUTCFullYear()}-${dua(kemarin.getUTCMonth() + 1)}-${dua(kemarin.getUTCDate())}`;
}

interface BagianLokal {
  tahun: number;
  bulan: number;
  hari: number;
  jam: number;
  menit: number;
}

function bagianLokal(momen: Date, timezone: string): BagianLokal {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const bagian: Record<string, string> = {};
  for (const p of fmt.formatToParts(momen)) {
    if (p.type !== 'literal') bagian[p.type] = p.value;
  }
  return {
    tahun: Number(bagian.year),
    bulan: Number(bagian.month),
    hari: Number(bagian.day),
    jam: Number(bagian.hour),
    menit: Number(bagian.minute),
  };
}

function dua(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Nomor struk: `K1-20260726-0007` (`CLAUDE.md`).
 *
 * Tanggalnya adalah tanggal BISNIS, bukan kalender — itu yang membuat struk
 * pukul 01:00 sekelompok dengan penjualan sore sebelumnya, seperti yang
 * merchant lihat di laci.
 *
 * ⛔ Urutan di atas 9999 TIDAK dipotong. Padding hanya kosmetik; memotongnya
 * menghasilkan nomor struk duplikat, dan
 * `UNIQUE(device_id, business_date, sequence)` akan menolak penjualan di
 * tengah antrean — pada outlet tersibuk, di hari tersibuk.
 */
export function nomorStruk(prefiksDevice: string, tanggalBisnisIso: string, urutan: number): string {
  return `${prefiksDevice}-${tanggalBisnisIso.replace(/-/g, '')}-${String(urutan).padStart(4, '0')}`;
}
