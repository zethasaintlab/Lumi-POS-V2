// Tipe untuk beban kerja penjualan milik prototipe 04, yang ditulis JavaScript
// polos. Ia diimpor apa adanya -- BUKAN disalin -- supaya angka di
// `harness-vfs.html` benar-benar sebanding dengan angka prototipe 03 §5b dan
// prototipe 04 §5. Beban yang disalin akan hanyut, dan perbandingannya
// diam-diam kehilangan arti.
declare module '*/prototypes/04-powersync-raw-tables/src/penjualan.js' {
  export function pernyataanPenjualan(
    n: number,
    opsi?: { rusakDiAkhir?: boolean }
  ): [string, unknown[]][];
  export const TABEL_PENJUALAN: [string, string][];
}
