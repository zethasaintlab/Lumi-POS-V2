import type { CSSProperties } from 'react';

/**
 * Area sentuh tak terlihat — sisi PER SISI, dipotong dari CELAH SEBENARNYA
 * antara dua elemen bertetangga.
 *
 * ## Apa yang dijaminnya
 *
 * `.sentuh`/`.sentuh-uang` (`packages/ds/lumi.css`) meluaskan area TEKAN
 * (bukan area TAMPAK) lewat `::before` yang membaca empat custom property
 * per-sisi: `--sentuh-atas/kanan/bawah/kiri`. Bawaannya SIMETRIS (setengah
 * `--touch-min`/`--touch-critical` dikurangi ukuran elemen). Fungsi ini
 * menghasilkan override untuk sisi yang MENGHADAP TETANGGA, supaya perluasan
 * itu berhenti tepat di garis tengah celah — bukan menembus ke area tekan
 * tetangganya (keputusan user 26 September 2026, "area sentuh tidak boleh
 * bertumpuk").
 *
 * Nilainya `calc(<celah> / -2)`: setengah celah, ke arah DALAM (negatif),
 * dari sisi elemen — persis batas garis tengah antara elemen ini dan
 * tetangganya.
 *
 * ## Apa yang WAJIB disuplai pemanggil
 *
 * `celah` adalah CELAH SEBENARNYA di layout antara elemen ini dan
 * tetangganya di sisi yang dipotong — idealnya token yang SAMA dengan `gap`
 * flex/grid yang menata keduanya (`'var(--space-2)'`, bukan `'8px'` yang
 * diketik ulang). Menyuplai token yang BERBEDA dari gap layout sungguhan
 * memotong terlalu banyak (area tekan mengecil dari yang perlu) atau
 * terlalu sedikit (tetap bertumpuk) — fungsi ini tidak dapat memeriksa gap
 * sungguhan, hanya menghitung dari nilai yang diberikan.
 *
 * ## Yang TIDAK ditanganinya
 *
 * Tetangga DIAGONAL (tidak segaris horizontal maupun vertikal) tidak
 * ditangani — fungsi ini hanya memotong sisi yang disebut eksplisit di
 * `sisi`, dan tidak ada logika yang menyimpulkan sisi mana yang relevan dari
 * posisi tetangga. Pemanggil yang tata letaknya diagonal harus memutuskan
 * sendiri sisi mana yang dipotong, atau menerima bahwa mekanisme ini tidak
 * berlaku untuknya.
 */
export function potongSentuh(
  sisi: ReadonlyArray<'atas' | 'kanan' | 'bawah' | 'kiri'>,
  celah: string
): CSSProperties {
  const gaya: Record<string, string> = {};
  for (const s of sisi) gaya[`--sentuh-${s}`] = `calc(${celah} / -2)`;
  return gaya as CSSProperties;
}
