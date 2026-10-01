/* Kunci jalan keluar header — murni. K-06 memasang alasan selama QRIS menunggu
   atau penjualan disimpan; `navigasi()`, Keluar, dan `ShellKasir` membacanya.
   Pola `kasir/simpanan.ts`; `null` = tidak terkunci. */

let alasanKini: string | null = null;
const pelanggan = new Set<() => void>();

export function setelKunciNav(alasan: string | null): void {
  if (alasan === alasanKini) return;
  alasanKini = alasan;
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
