/* Kunci tab navigasi header — murni, tanpa React.

   Selama QRIS dinamis menunggu atau penjualan sedang disimpan, meninggalkan K-06
   menghapus nominal yang sudah diketik dan, untuk QRIS, melepas layar yang
   sedang ditunggu pelanggan. Pembayaran memasang alasannya di sini; `ShellKasir`
   membacanya dan mengunci setiap tab (spec § 7 "Wadah", keputusan otonom § 12).

   Pola `kasir/simpanan.ts`: modul memori + langganan, supaya dua komponen yang
   tidak saling mengenal tetap sepakat. `null` = tidak terkunci. */

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
