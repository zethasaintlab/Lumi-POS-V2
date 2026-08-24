import { AMBANG_DISKON_NOMINAL, AMBANG_DISKON_PERSEN } from './diskon.ts';
import { SKALA_TARIF } from './numeric.ts';
import { AMBANG_SELISIH } from './buku-kas.ts';
import { AMBANG_NO_SALE } from './no-sale.ts';

/**
 * B-26 Ambang Otorisasi — ketiga ambang yang merchant dapat setel. `IA:205`.
 *
 * Keputusan 1 Agustus 2026 menyebut ketiganya dalam satu kalimat: *"diskon
 * >20% atau >Rp50.000 · selisih kas >Rp20.000 · no-sale wajib alasan, PIN di
 * atas 3×/shift"*, dan mencatat bahwa **angkanya `[ASUMSI]`, belum divalidasi
 * ke merchant**. Itu justru alasannya dapat diubah.
 *
 * ## ⛔ Yang dapat diubah ANGKANYA, bukan keberadaan kontrolnya
 *
 * Tidak ada nilai yang berarti "tidak pernah menuntut otorisasi". Ambang yang
 * dapat dimatikan adalah kontrol yang hilang pada hari seseorang
 * membutuhkannya — dan yang mematikannya adalah orang yang paling ingin ia
 * mati. Merchant yang menginginkan "praktis tanpa PIN" menyetel angkanya
 * tinggi; itu terlihat sebagai angka di layar, tercatat di `audit_event`
 * sebagai `threshold_changed` dengan nilai lama dan barunya, dan dapat dibaca
 * kembali. Sebuah toggle `false` tidak menceritakan apa pun tentang seberapa
 * jauh.
 *
 * ## ⛔ `null` BERBEDA dari nol
 *
 * `null` berarti "pakai bawaan"; nol adalah nilai yang dipilih dan berarti
 * *setiap* kejadian menuntut otorisasi. Menyamakan keduanya membuang pilihan
 * yang sah — dan membuangnya diam-diam, karena merchant yang menyetel nol
 * melihat layarnya menampilkan 20.000.
 *
 * ## Kenapa di sini
 *
 * Bawaannya sudah hidup di tiga berkas domain yang berbeda
 * (`diskon.ts`, `buku-kas.ts`, `no-sale.ts`), masing-masing bersama aturan
 * yang memakainya. Berkas ini **tidak menyalinnya** — ia mengimpornya. Yang
 * ditambahkan hanya satu hal: bentuk yang menggabungkan "apa yang outlet
 * setel" dengan "apa yang berlaku kalau ia tidak menyetel", sekali, untuk
 * server dan klien.
 *
 * Murni: tanpa I/O, tanpa waktu, tanpa database.
 */

/** Apa yang tersimpan di `outlet` — `null` berarti belum disetel. */
export interface AmbangTersimpan {
  /** Persen berskala 10.000 (20% → `2000n`). */
  diskonPersenSkala: bigint | null;
  diskonNominal: bigint | null;
  selisihKas: bigint | null;
  /** Berapa pembukaan laci yang BEBAS PIN dalam satu shift. */
  noSale: number | null;
}

/** Apa yang benar-benar berlaku. Tidak ada `null` di sini. */
export interface AmbangBerlaku {
  diskonPersenSkala: bigint;
  diskonNominal: bigint;
  selisihKas: bigint;
  noSale: number;
}

export const AMBANG_BAWAAN: AmbangBerlaku = {
  diskonPersenSkala: AMBANG_DISKON_PERSEN,
  diskonNominal: AMBANG_DISKON_NOMINAL,
  selisihKas: BigInt(AMBANG_SELISIH),
  noSale: AMBANG_NO_SALE,
};

/**
 * Ambang yang berlaku untuk sebuah outlet.
 *
 * ⛔ `??`, bukan `||`. Nol adalah nilai yang dipilih, dan `0n || bawaan`
 * mengembalikan bawaan — persis kesalahan yang membuang pilihan "setiap
 * selisih menuntut otorisasi" tanpa satu pun error.
 */
export function ambangBerlaku(tersimpan: Partial<AmbangTersimpan> | null): AmbangBerlaku {
  const t = tersimpan ?? {};
  return {
    diskonPersenSkala: t.diskonPersenSkala ?? AMBANG_BAWAAN.diskonPersenSkala,
    diskonNominal: t.diskonNominal ?? AMBANG_BAWAAN.diskonNominal,
    selisihKas: t.selisihKas ?? AMBANG_BAWAAN.selisihKas,
    noSale: t.noSale ?? AMBANG_BAWAAN.noSale,
  };
}

/**
 * Batas atas yang WAJAR, bukan batas yang mungkin.
 *
 * ⛔ Ia ada supaya salah ketik tidak menjadi kontrol yang mati. Merchant yang
 * mengetik satu nol berlebih pada ambang selisih kas menaikkannya dari
 * Rp 20.000 menjadi Rp 200.000, dan tidak ada apa pun di layar yang akan
 * memberitahunya — selisih kas yang seharusnya dipertanyakan hanya berhenti
 * muncul.
 *
 * Angkanya sendiri `[ASUMSI]`: dipilih supaya seluruh nilai yang masuk akal
 * untuk kafe 2–20 outlet muat, dan salah ketik satu digit tidak.
 */
export const BATAS_DISKON_PERSEN_SKALA = SKALA_TARIF; // 100%
export const BATAS_DISKON_NOMINAL = 10_000_000n; // Rp 10 juta
export const BATAS_SELISIH_KAS = 10_000_000n; // Rp 10 juta
export const BATAS_NO_SALE = 50;

export type HasilAmbang = { ok: true } | { ok: false; bidang: keyof AmbangTersimpan; pesan: string };

/**
 * Memeriksa satu setelan ambang.
 *
 * ⛔ Menerima `null` untuk setiap bidang — "kembalikan ke bawaan" adalah
 * perintah yang sah, dan menolaknya memaksa merchant mengetik ulang angka
 * bawaan yang tidak pernah ia lihat.
 */
export function periksaAmbang(a: AmbangTersimpan): HasilAmbang {
  // ⛔ Nama bidangnya DISEBUT di kedua pesan. Penolakan yang hanya berbunyi
  // "nilai tidak valid" pada layar dengan empat isian membuat pengetiknya
  // menebak yang mana — dan yang menebak salah menyimpan tiga ambang yang
  // benar untuk memperbaiki satu yang tidak.
  const batas = (
    nilai: bigint | number | null,
    maks: bigint | number,
    bidang: keyof AmbangTersimpan,
    nama: string,
    maksTampil: string
  ): HasilAmbang | null => {
    if (nilai === null) return null;
    if (nilai < 0) return { ok: false, bidang, pesan: `${nama} tidak boleh negatif.` };
    if (nilai > maks) {
      return { ok: false, bidang, pesan: `${nama} tidak boleh melebihi ${maksTampil}.` };
    }
    return null;
  };

  return (
    batas(
      a.diskonPersenSkala,
      BATAS_DISKON_PERSEN_SKALA,
      'diskonPersenSkala',
      'Ambang diskon persen',
      '100%'
    ) ??
    batas(
      a.diskonNominal,
      BATAS_DISKON_NOMINAL,
      'diskonNominal',
      'Ambang diskon rupiah',
      'Rp 10.000.000'
    ) ??
    batas(
      a.selisihKas,
      BATAS_SELISIH_KAS,
      'selisihKas',
      'Ambang selisih kas',
      'Rp 10.000.000'
    ) ??
    batas(a.noSale, BATAS_NO_SALE, 'noSale', 'Ambang buka laci', '50 kali per shift') ?? {
      ok: true,
    }
  );
}
