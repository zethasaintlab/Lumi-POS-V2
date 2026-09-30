import { keputusanStok } from '../../../../packages/domain/src/profil-vertikal.ts';

/**
 * Bolehkah `dimintaMilli` (KUMULATIF lintas baris) ditambahkan, dan apa yang
 * harus dikatakan kasir? FR-E4 + FR-E5. Murni: pemanggil yang membaca stok.
 *
 * ⛔ SATU jalur untuk ketukan kartu (`pilihVariation`) dan tombol + Edit Item.
 * Sebelum ini tombol + stepper memanggil `ubahQty` langsung dan melewati
 * pemeriksaan (spec kasir § 6, R6); dua jalur berarti dua kalimat dan satu
 * lubang.
 *
 * ⛔ `habis` diperiksa SEBELUM stok terhitung dan tidak pernah disimpulkan
 * darinya (`spec-e:217`): produk dapat habis meski stoknya 10. Penimpaan
 * manajer belum punya jalur, jadi penandaan memblokir.
 *
 * Peringatan (boleh negatif) TIDAK memblokir — `spec-e:146`.
 */
export type KeputusanTambahStok =
  | { boleh: true; peringatan: string | null }
  | { boleh: false; pesan: string };

export function periksaTambahStok(p: {
  namaItem: string;
  variationId: string;
  lacakStok: boolean;
  dimintaMilli: number;
  stok: ReadonlyMap<string, number>;
  habis: ReadonlySet<string>;
  bolehNegatif: boolean;
}): KeputusanTambahStok {
  if (p.habis.has(p.variationId)) {
    return { boleh: false, pesan: `${p.namaItem} ditandai habis. Manajer dapat membuka kembali penandaannya.` };
  }
  const k = keputusanStok({
    stokMilli: p.stok.get(p.variationId) ?? 0,
    dimintaMilli: p.dimintaMilli,
    bolehNegatif: p.bolehNegatif,
    lacakStok: p.lacakStok,
  });
  if (!k.boleh) {
    /* `spec-e:152`: pembatasan disertai pesan yang menjelaskan — angkanya ikut. */
    return { boleh: false, pesan: `${p.namaItem} tersisa ${k.sisaMilli / 1000}. Tidak dapat menambah lagi.` };
  }
  return { boleh: true, peringatan: k.peringatan ? `Stok ${p.namaItem} tersisa ${k.sisaMilli / 1000}` : null };
}
