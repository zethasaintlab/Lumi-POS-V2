/**
 * Tampilan kuantitas berskala 1000 — konvensi `INTEGER ×1000` (`CLAUDE.md`).
 *
 * ## Kenapa di packages/domain
 *
 * Aturannya sama di laporan server dan di layar kasir, dan dua salinan akan
 * menyimpang pada pemisah desimal atau pada pemangkasan nol. Angka kuantitas
 * yang berbeda antara struk dan laporan adalah bentuk perbedaan angka yang
 * paling sulit dijelaskan: keduanya "benar" menurut kodenya masing-masing.
 */

/**
 * `2000` → `"2"`, `500` → `"0,5"`.
 *
 * ⛔ Dihitung dari STRING lewat `bigint`, bukan `Number(x) / 1000`. Kuantitas
 * adalah `bigint` di database, dan pembagian float akan menghasilkan
 * `0.30000000000000004` untuk nilai yang seharusnya `0,3`.
 *
 * Koma sebagai pemisah desimal — format Indonesia (`CLAUDE.md`).
 */
export function tampilkanKuantitas(skala: string): string {
  let n: bigint;
  try {
    n = BigInt(String(skala).trim());
  } catch {
    return '—';
  }
  const negatif = n < 0n;
  const abs = negatif ? -n : n;
  const utuh = abs / 1000n;
  const sisa = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  const teks = sisa.length > 0 ? `${utuh},${sisa}` : utuh.toString();
  return negatif ? `−${teks}` : teks;
}
