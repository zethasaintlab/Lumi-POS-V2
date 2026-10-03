/* Kunci tab nav header — modul MURNI, tanpa React.

   ⛔ Selama QRIS dinamis menunggu atau penjualan sedang disimpan, K-06 mengunci
   tab nav (`aria-disabled` + kalimat alasan): meninggalkan layar di tengah
   menghapus nominal yang sudah diketik, dan di tengah QRIS membuang jejak QR
   yang pelanggannya sedang memindai (spec § 7 "Wadah", keputusan otonom § 12).

   Hidup di modul, bukan di konteks React, dengan alasan yang sama seperti
   `kasir/simpanan.ts`: `ShellKasir` dan K-06 saudara di pohon, dan sumber
   kebenarannya harus satu. */

let alasanKini: string | null = null;
const pelanggan = new Set<() => void>();

/** `null` membuka kunci. String non-kosong mengunci, dan ia adalah kalimat alasannya. */
export function setelKunciNav(alasan: string | null): void {
  const baru = alasan !== null && alasan.trim() === '' ? null : alasan;
  if (baru === alasanKini) return;
  alasanKini = baru;
  for (const dengar of [...pelanggan]) {
    try {
      dengar();
    } catch {
      // Satu pelanggan yang melempar tidak boleh menghalangi sisanya.
    }
  }
}

export function kunciNavSekarang(): string | null {
  return alasanKini;
}

export function langgananKunciNav(dengar: () => void): () => void {
  pelanggan.add(dengar);
  return () => {
    pelanggan.delete(dengar);
  };
}
