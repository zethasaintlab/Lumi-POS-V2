/**
 * Plugin Vite — mengalihkan impor INTERNAL bundle ke set ikon Lucide.
 *
 * Task 7, sub-proyek 1 "Fondasi desain" (kampanye "Hidupkan desain",
 * 26 September 2026). Task 6 memberi `packages/ds/ikon.tsx` set ikon
 * `lucide-react@0.468.0` apa adanya, dan mengekspornya lewat `ds` menutup
 * separuh masalah: kode APLIKASI (`apps/**`) sekarang memanggil `<Icon>` yang
 * benar. Separuh lainnya adalah `ds-bundle/components/**` sendiri — Modal,
 * AppShell, StatCard, SyncIndicator, Ticket, dan Stepper masing-masing
 * mengimpor `Icon` dari `forms/Icon.jsx` BUNDEL (42 path digambar ulang
 * "gaya Lucide", bukan Lucide asli) SECARA INTERNAL, dan `ds-bundle/` adalah
 * artefak VENDOR yang tidak pernah disunting langsung (`CLAUDE.md` §
 * `ds-bundle/` adalah artefak VENDOR). Suntingan di tempat hilang tanpa
 * jejak pada pembaruan bundle berikutnya.
 *
 * Plugin ini adalah override itu, dalam bentuk yang `ds-bundle/` tidak
 * pernah tahu ada: `resolveId` mencegat SETIAP impor relatif `Icon.jsx` yang
 * berasal dari file di dalam `ds-bundle/components/` — baik `../forms/
 * Icon.jsx` (dari `overlays/Modal.jsx`, `navigation/AppShell.jsx`,
 * `data/StatCard.jsx`, `data/SyncIndicator.jsx`, `pos/Ticket.jsx`) maupun
 * `./Icon.jsx` (dari `forms/Stepper.jsx`, satu direktori dengan target) —
 * dan mengarahkannya ke `packages/ds/ikon.tsx` alih-alih file bundel.
 * Sesudahnya, ikon yang dirender KOMPONEN BUNDEL sendiri (mis. `wifi-off` di
 * `SyncIndicator`) adalah node Lucide yang sama dengan yang `<Icon>` publik
 * `ds` render — bukan gambar ulang bundel yang berbeda proporsi.
 *
 * ⛔ Dipasang di SETIAP config Vite yang me-render komponen bundel (lihat
 * daftar di bawah), bukan disembunyikan di satu tempat. Config yang lupa
 * memasangnya kembali merender path bundel lama untuk komponen INTERNAL
 * bundel — tanpa satu pun error, karena `Icon.jsx` bundel tetap ada dan
 * tetap valid; hanya bentuknya yang berbeda dari `<Icon>` publik yang
 * dipakai di tempat lain di layar yang sama. Keputusan user 26 September
 * 2026: plugin ini TIDAK BOLEH tersembunyi — dicatat di `CLAUDE.md` §
 * Aturan design system, `packages/ds/README.md`, dan komentar di setiap
 * config yang memasangnya. Dipindai `tests/runtime/ikon-lucide.test.js`
 * (glob `apps/**​/vite*.config.ts`, bukan daftar tetap).
 *
 * ⛔ Hanya menyentuh impor `Icon.jsx` DI DALAM `ds-bundle/components/`.
 * Impor `Icon`/`iconNames`/`IconName` dari paket `ds` (`apps/**`) sudah
 * menunjuk `ikon.tsx` lewat `packages/ds/index.ts` — pola resolusi npm
 * biasa, tidak lewat plugin ini sama sekali.
 */
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';

/** `packages/ds/ikon.tsx` — absolut, dihitung dari lokasi berkas ini sendiri
 * (bukan dari `cwd` pemanggil), supaya plugin ini bekerja sama persis dari
 * config Vite mana pun yang mengimpornya. */
const IKON_TSX = fileURLToPath(new URL('./ikon.tsx', import.meta.url));

/** Path pakai `/`, apa pun platformnya — perbandingan akhiran di bawah
 * menuntut pemisah yang seragam. */
const keSlash = (p: string): string => p.split(sep).join('/');

export function ikonLumi(): Plugin {
  return {
    name: 'lumi-ikon-bundle',
    // `enforce: 'pre'` — plugin ini harus menjawab SEBELUM resolver bawaan
    // Vite mencoba menyelesaikan `../forms/Icon.jsx` ke file bundel yang
    // sungguhan ada di disk. Tanpa ini, urutan plugin lain (mis. plugin
    // React) dapat menang lebih dulu untuk id yang sama.
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      if (!source.endsWith('Icon.jsx')) return null;

      const importerSlash = keSlash(importer);
      if (!importerSlash.includes('/ds-bundle/components/')) return null;

      // Selesaikan spesifiernya SUNGGUHAN (relatif ke direktori pengimpor)
      // dan periksa hasilnya — bukan menebak dari bentuk string `source`.
      // Ini yang membedakan `forms/Icon.jsx` (target sah, dari `./Icon.jsx`
      // di `Stepper.jsx` atau `../forms/Icon.jsx` dari direktori lain) dari
      // `Icon.jsx` lain yang kebetulan ada di folder lain bundel.
      const resolvedSlash = keSlash(resolve(dirname(importer), source));
      if (!resolvedSlash.endsWith('/ds-bundle/components/forms/Icon.jsx')) return null;

      return IKON_TSX;
    },
  };
}
