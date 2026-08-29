import {
  AMBANG_BAWAAN,
  ambangBerlaku,
  periksaAmbang,
  type AmbangTersimpan,
} from '../../../../packages/domain/src/ambang.ts';
import { SKALA_TARIF } from '../../../../packages/domain/src/numeric.ts';
import { bacaRupiah, rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/**
 * B-26 — aturan tampilan Ambang Otorisasi (`IA:205`).
 *
 * Murni: form masuk → muatan keluar. Tanpa DOM, tanpa jaringan.
 *
 * ## ⛔ Isian KOSONG berarti "pakai bawaan", dan itu harus terlihat
 *
 * Layar ini punya empat isian yang boleh kosong, dan kosong di sini bukan
 * "belum diisi" melainkan sebuah PILIHAN: outlet mengikuti bawaan, dan ikut
 * berubah bila bawaannya berubah. Isian yang diisi otomatis dengan angka
 * bawaan menghapus pilihan itu diam-diam — sekali disimpan, outlet berhenti
 * mengikuti bawaan selamanya, dan tidak ada apa pun di layar yang berbeda.
 *
 * Karena itu placeholder-nya menyebut bawaannya dan isiannya tetap kosong.
 *
 * ## ⛔ Nol BERBEDA dari kosong
 *
 * `0` berarti *setiap* kejadian menuntut otorisasi — pilihan yang sah untuk
 * merchant yang lacinya kecil. `bacaRupiah` sudah membedakan keduanya
 * (`''` → `null`, `'0'` → `0`), dan itu sebabnya ia dipakai apa adanya di
 * sini alih-alih `Number()`.
 *
 * ## ⛔ Aturan batasnya dari DOMAIN
 *
 * `periksaAmbang` adalah fungsi yang SAMA yang server panggil. Salinan di
 * klien akan menyimpang, dan yang menyimpang menghasilkan layar yang menerima
 * angka yang server tolak — penolakan yang datang setelah tombol simpan
 * ditekan terbaca sebagai kerusakan, bukan sebagai aturan.
 */

export const JUDUL_LAYAR = 'Ambang Otorisasi';

export interface FormAmbang {
  /** Persen sebagai teks manusia: "20" atau "20,5". Kosong = bawaan. */
  diskonPersen: string;
  diskonNominal: string;
  selisihKas: string;
  noSale: string;
}

export const FORM_KOSONG: FormAmbang = {
  diskonPersen: '',
  diskonNominal: '',
  selisihKas: '',
  noSale: '',
};

export type HasilForm =
  | { ok: true; muatan: Record<string, string | number | null> }
  | { ok: false; bidang: keyof FormAmbang; pesan: string };

/**
 * Persen manusia → skala 10.000.
 *
 * ⛔ Digit desimalnya DITURUNKAN dari skalanya, aturan yang sama dengan
 * `parseNilaiDiskon` (`CLAUDE.md`): "20,5%" adalah rate 0,205, berskala 10.000
 * ia `2050`. Koma dan titik sama-sama diterima — merchant Indonesia mengetik
 * koma, dan menolaknya membuat layar terasa rusak.
 */
export function persenKeSkala(teks: string): bigint | null {
  const bersih = teks.trim().replace(',', '.');
  if (bersih === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(bersih)) return null;
  const [utuh, pecah = ''] = bersih.split('.');
  const dua = (pecah + '00').slice(0, 2);
  return BigInt(utuh) * (SKALA_TARIF / 100n) + BigInt(dua);
}

/** Skala 10.000 → persen manusia, koma Indonesia, tanpa nol ekor. */
export function skalaKePersen(skala: bigint): string {
  const per100 = SKALA_TARIF / 100n;
  const utuh = skala / per100;
  const sisa = skala % per100;
  if (sisa === 0n) return String(utuh);
  return `${utuh},${String(sisa).padStart(2, '0').replace(/0$/, '')}`;
}

/** Form → muatan `PUT /outlets/{id}/thresholds`. */
export function buatMuatanAmbang(form: FormAmbang): HasilForm {
  const persenTeks = form.diskonPersen.trim();
  const persen = persenKeSkala(persenTeks);
  if (persenTeks !== '' && persen === null) {
    return {
      ok: false,
      bidang: 'diskonPersen',
      pesan: 'Persen maksimal dua angka desimal, mis. 20 atau 20,5.',
    };
  }

  const nominal = bacaRupiahAtauNull(form.diskonNominal);
  if (nominal === 'cacat') {
    return { ok: false, bidang: 'diskonNominal', pesan: 'Isi angka rupiah tanpa desimal.' };
  }
  const selisih = bacaRupiahAtauNull(form.selisihKas);
  if (selisih === 'cacat') {
    return { ok: false, bidang: 'selisihKas', pesan: 'Isi angka rupiah tanpa desimal.' };
  }

  const noSaleTeks = form.noSale.trim();
  let noSale: number | null = null;
  if (noSaleTeks !== '') {
    if (!/^\d+$/.test(noSaleTeks)) {
      return { ok: false, bidang: 'noSale', pesan: 'Isi jumlah pembukaan sebagai bilangan bulat.' };
    }
    noSale = Number(noSaleTeks);
  }

  const tersimpan: AmbangTersimpan = {
    diskonPersenSkala: persen,
    diskonNominal: nominal,
    selisihKas: selisih,
    noSale,
  };

  // Aturan batas dari domain — fungsi yang SAMA yang server panggil.
  const periksa = periksaAmbang(tersimpan);
  if (!periksa.ok) {
    return { ok: false, bidang: KE_BIDANG[periksa.bidang], pesan: periksa.pesan };
  }

  return {
    ok: true,
    muatan: {
      // ⛔ STRING dari ujung ke ujung. Uang yang melewati `number` di jalur
      // yang memutuskan kapan PIN manajer dituntut adalah pembulatan yang
      // tidak akan terlihat sampai seseorang mempertanyakan sebuah otorisasi.
      diskonPersenSkala: persen === null ? null : persen.toString(),
      diskonNominal: nominal === null ? null : nominal.toString(),
      selisihKas: selisih === null ? null : selisih.toString(),
      noSale,
    },
  };
}

const KE_BIDANG: Record<keyof AmbangTersimpan, keyof FormAmbang> = {
  diskonPersenSkala: 'diskonPersen',
  diskonNominal: 'diskonNominal',
  selisihKas: 'selisihKas',
  noSale: 'noSale',
};

/**
 * `null` untuk kosong, `'cacat'` untuk yang tidak dapat dibaca.
 *
 * ⛔ Tiga hasil, bukan dua. `bacaRupiah('')` adalah `null` dan
 * `bacaRupiah('abc')` juga `null` — menyamakannya membuat salah ketik
 * tersimpan diam-diam sebagai "kembali ke bawaan", dan ambang yang merchant
 * kira ia naikkan justru turun.
 */
function bacaRupiahAtauNull(teks: string): bigint | null | 'cacat' {
  const bersih = teks.trim();
  if (bersih === '') return null;
  const n = bacaRupiah(bersih);
  return n === null ? 'cacat' : BigInt(n);
}

/** Respons server → form. Yang `null` tetap KOSONG; lihat catatan kepala. */
export function formDariTersimpan(t: {
  diskonPersenSkala: string | null;
  diskonNominal: string | null;
  selisihKas: string | null;
  noSale: number | null;
}): FormAmbang {
  return {
    diskonPersen: t.diskonPersenSkala === null ? '' : skalaKePersen(BigInt(t.diskonPersenSkala)),
    diskonNominal: t.diskonNominal === null ? '' : t.diskonNominal,
    selisihKas: t.selisihKas === null ? '' : t.selisihKas,
    noSale: t.noSale === null ? '' : String(t.noSale),
  };
}

/**
 * Kalimat petunjuk per isian, menyebut bawaannya.
 *
 * ⛔ Bawaannya dibaca dari DOMAIN, tidak ditulis di sini. Angka bawaan yang
 * disalin ke teks layar akan menyimpang saat bawaannya berubah — dan yang
 * menyimpang membuat merchant menyetel ambang berdasarkan angka yang sudah
 * tidak berlaku.
 */
export const BAWAAN_TAMPIL = {
  diskonPersen: `${skalaKePersen(AMBANG_BAWAAN.diskonPersenSkala)}%`,
  diskonNominal: rupiah(AMBANG_BAWAAN.diskonNominal),
  selisihKas: rupiah(AMBANG_BAWAAN.selisihKas),
  noSale: `${AMBANG_BAWAAN.noSale}×`,
};

/**
 * Ringkasan satu baris: apa yang berlaku, dan apakah itu bawaan.
 *
 * ⛔ Membedakan keduanya di LAYAR, bukan hanya di data. "Rp 20.000 (bawaan)"
 * dan "Rp 20.000 (disetel outlet ini)" berperilaku sama hari ini dan berbeda
 * pada hari bawaannya berubah — dan yang membaca layar ini adalah orang yang
 * memutuskan apakah perlu mengubahnya.
 */
export function ringkasBerlaku(t: {
  diskonPersenSkala: string | null;
  diskonNominal: string | null;
  selisihKas: string | null;
  noSale: number | null;
}): { label: string; nilai: string; asal: 'bawaan' | 'outlet' }[] {
  const berlaku = ambangBerlaku({
    diskonPersenSkala: t.diskonPersenSkala === null ? null : BigInt(t.diskonPersenSkala),
    diskonNominal: t.diskonNominal === null ? null : BigInt(t.diskonNominal),
    selisihKas: t.selisihKas === null ? null : BigInt(t.selisihKas),
    noSale: t.noSale,
  });
  const asal = (disetel: unknown): 'bawaan' | 'outlet' => (disetel === null ? 'bawaan' : 'outlet');
  return [
    {
      label: 'Diskon di atas',
      nilai: `${skalaKePersen(berlaku.diskonPersenSkala)}%`,
      asal: asal(t.diskonPersenSkala),
    },
    {
      label: 'atau di atas',
      nilai: rupiah(berlaku.diskonNominal),
      asal: asal(t.diskonNominal),
    },
    {
      label: 'Selisih kas di atas',
      nilai: rupiah(berlaku.selisihKas),
      asal: asal(t.selisihKas),
    },
    {
      label: 'Buka laci tanpa transaksi lebih dari',
      nilai: `${berlaku.noSale}× per shift`,
      asal: asal(t.noSale),
    },
  ];
}
