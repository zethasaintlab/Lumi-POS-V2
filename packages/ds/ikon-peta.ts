/**
 * Data ikon: 50 nama mockup, pemetaan 48 nama bundle lama, dan `iconNames`
 * gabungannya — Task 6, sub-proyek 1 "Fondasi desain".
 *
 * ⛔ Berkas ini murni TypeScript tanpa JSX, dan itu disengaja: `ikon.tsx`
 * (yang merender `<svg>` lewat `createElement`) memakai ekstensi `.tsx`, dan
 * Node **menolak mengimpor `.tsx` sama sekali**, apa pun isinya —
 * dibuktikan (MERAH, sengaja): `node --experimental-strip-types berkas.tsx`
 * atas berkas `.tsx` sekosong `interface Foo { name: string }` tetap gagal
 * `SyntaxError: Unexpected identifier 'Foo'` (`.tsx` tidak pernah di-strip,
 * dengan atau tanpa JSX di dalamnya; lihat catatan di `tools/ekstrak-lucide.mjs`
 * dan laporan Task 6). Tabel di sini karena itu hidup di `.ts` biasa, supaya
 * `tests/runtime/ikon-lucide.test.js` (`node --test`, tanpa flag apa pun)
 * dapat mengimpornya langsung. `ikon.tsx` mengimpor dan mengekspor ulang
 * ketiganya di permukaan publiknya (§ kepala berkas itu menunjuk ke sini).
 *
 * Sumber pemetaan: node Lucide di `ikon-data.ts` (`tools/ekstrak-lucide.mjs`
 * dari `lucide-react@0.468.0`), dibandingkan path-per-path dengan
 * `ds-bundle/components/forms/Icon.jsx`.
 */

import type { LucideKebabName } from './ikon-data.ts';

/**
 * 50 ikon yang dipakai mockup, diparse dari impor `lucide-react` di
 * `docs/referensi-visual/sumber/ui_kits/{kasir,order,backoffice}/index.html`
 * (union — `docs/referensi-visual/sumber/components/**​/*.jsx` tidak
 * mengimpor `lucide-react` sama sekali, TERVERIFIKASI: nol hasil).
 *
 * Nama kebab di sini SEBAGIAN BUKAN kebab-case harfiah dari nama Pascal
 * mockup — dua di antaranya nama ALIAS Lucide yang sudah tidak dipakai
 * lagi di ekspor kanonik, diresolusi dengan membaca ekspor sungguhan di
 * `dist/esm/lucide-react.js`, bukan ditebak dari ejaan:
 *
 *   - `BarChart3`   (dipakai backoffice) → alias untuk `ChartColumn`   → `chart-column`
 *   - `PauseCircle` (dipakai kasir)      → alias untuk `CirclePause`  → `circle-pause`
 *
 * Kebab harfiah dari nama alias itu (`bar-chart-3`, `pause-circle`) BUKAN
 * nama berkas yang ada di `dist/esm/icons/` — memakainya akan membuat
 * ekstraksi gagal dengan "berkas ikon tidak ada".
 */
export const NAMA_MOCKUP = [
  'arrow-down-left',
  'arrow-up-right',
  'chart-column',
  'bell',
  'calculator',
  'check',
  'chef-hat',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'chevron-up',
  'circle-alert',
  'clock-3',
  'coffee',
  'cooking-pot',
  'copy',
  'credit-card',
  'file-warning',
  'image-off',
  'layout-dashboard',
  'layout-grid',
  'lock-keyhole',
  'minus',
  'package',
  'circle-pause',
  'pencil',
  'percent',
  'plus',
  'printer',
  'qr-code',
  'receipt',
  'receipt-text',
  'rotate-ccw',
  'search',
  'search-x',
  'send',
  'settings',
  'shield-check',
  'shopping-bag',
  'store',
  'tag',
  'trash-2',
  'upload',
  'user-round',
  'users-round',
  'utensils-crossed',
  'wallet',
  'wallet-cards',
  'wifi-off',
  'x',
] as const satisfies readonly LucideKebabName[];

/**
 * Ke-48 nama `ds-bundle/components/forms/Icon.jsx` → nama kebab Lucide
 * sumbernya. Ditetapkan dengan membandingkan `d`/`points`/koordinat path
 * bundle terhadap node Lucide asli (§ `ikon-data.ts`), bukan ditebak dari
 * nama. Setiap entri berkomentar:
 *
 *   `identik`  — koordinatnya sama persis dengan node Lucide (functionally
 *                sama meski bundle kadang memecah/menggabung elemen `<path>`
 *                berbeda dari Lucide, mis. dua garis Lucide digabung satu
 *                `<path>` di bundle).
 *   selain itu — bundle adalah gambar ULANG "gaya Lucide" (komentar kepala
 *                `Icon.jsx`: *"stroke SVG inline, gaya Lucide"*), BUKAN
 *                salinan; sebagian besar entri karena itu dekat tapi tidak
 *                identik. Komentarnya menyebut bedanya secara singkat.
 *
 * Dua entri melalui ALIAS Lucide (dibaca dari `dist/esm/lucide-react.js`,
 * kedua berkasnya hanya `export { default } from './lain.js'`):
 *   `edit` → ekspor Lucide `"edit"` adalah alias `SquarePen` → `square-pen`
 *   `more` (bundle) → dipetakan ke ekspor Lucide `"more-horizontal"`, yang
 *            adalah alias `Ellipsis` → `ellipsis`
 */
export const PETA_BUNDLE = {
  search: 'search', // dekat: lingkaran r7 (sumber r8), tongkat lebih pendek
  'chevron-down': 'chevron-down', // identik
  'chevron-left': 'chevron-left', // identik
  'chevron-right': 'chevron-right', // identik
  alert: 'triangle-alert', // dekat: segitiga digambar ulang, sudut lebih tajam
  check: 'check', // identik
  x: 'x', // identik (segmen sama; bundle menggabung 2 path Lucide jadi 1 `d`)
  plus: 'plus', // identik (segmen sama; bundle menggabung 2 path Lucide jadi 1 `d`)
  minus: 'minus', // identik
  'wifi-off': 'wifi-off', // dekat: digabung jadi lebih sedikit path, lengkung disederhanakan
  refresh: 'refresh-cw', // dekat: busur panah & titik akhir disederhanakan
  clock: 'clock', // dekat: radius 9 (sumber 10), jarum sedikit lebih pendek
  receipt: 'receipt', // dekat: garis isi lurus, bukan bentuk "$" Lucide
  lock: 'lock', // dekat: proporsi gembok berbeda (lebar 16 vs 18, radius shackle 4 vs 5)
  dashboard: 'layout-grid', // identik (persis); bundle menamainya "dashboard", bukan layout-dashboard yang berbeda bentuk (4 rect asimetris)
  register: 'monitor', // identik (persis, path digabung dari 2 <line> Lucide); "register" = kasir digambarkan sebagai layar polos
  chef: 'chef-hat', // dekat: garis alas "M6 17h12" identik; topi digambar ulang lebih sederhana
  layers: 'layers', // dekat: konsep 3 lapis sama, koordinat disusun ulang
  package: 'package', // dekat: kotak digambar dengan garis lurus, bukan lengkung Lucide
  sliders: 'sliders-vertical', // dekat: tiga sumbu vertikal koordinatnya IDENTIK; hanya panjang centang berbeda
  tag: 'tag', // dekat: bentuk label digambar lurus; lingkaran lubang identik posisinya (radius beda)
  truck: 'truck', // dekat: kabin & bak digambar ulang
  clipboard: 'clipboard', // dekat: struktur dibalik (papan besar jadi elemen utama, bukan klip kecil)
  file: 'file-text', // dekat: dua baris teks (sumber tiga), sudut kertas lurus bukan lengkung
  gift: 'gift', // dekat: kotak & garis tengah IDENTIK; pita digambar ulang dengan shorthand kurva
  book: 'book', // dekat: punggung buku digambar lurus
  user: 'user', // dekat: bahu digambar sebagai busur tunggal, bukan bentuk bahu Lucide
  users: 'users', // dekat: sama, digambar dengan busur bukan bentuk bahu Lucide
  table: 'table', // dekat: pembagian kolom/baris berbeda (1 pembagi horizontal + 2 vertikal, sumber sebaliknya)
  calendar: 'calendar', // dekat: proporsi kotak & tab tanggal berbeda
  shield: 'shield', // dekat: poligon bersudut lurus, bukan kurva Lucide
  activity: 'activity', // dekat: garis lurus bersudut, bukan ujung membulat Lucide
  settings: 'settings', // dekat: gigi roda digambar ulang; lingkaran tengah r3 identik
  message: 'message-square', // dekat: sudut kotak lurus, bukan membulat
  image: 'image', // dekat: kotak & lingkaran IDENTIK; garis gunung diluruskan (sumber melengkung)
  bell: 'bell', // dekat: bodi lonceng digambar ulang, pemukul mirip posisinya
  swap: 'arrow-left-right', // dekat: panah lurus tanpa lengkung penghubung (Lucide "repeat" pakai lengkung; bentuk bundle cocok arrow-left-right)
  download: 'download', // dekat: anak panah dari garis lurus, bukan polyline; nampan disederhanakan
  printer: 'printer', // dekat: ukuran nampan kertas berbeda (8,15,8×6 vs sumber 6,14,12×8)
  filter: 'filter', // dekat: digambar sebagai <path>, sumber <polygon>; titik disederhanakan
  more: 'ellipsis', // dekat: posisi 3 titik IDENTIK (cx 5/12/19, cy 12); radius 1.5 (sumber 1) — via alias Lucide "more-horizontal"
  edit: 'square-pen', // dekat: pensil solid diagonal, bukan pena+kotak Lucide — via alias Lucide "edit"
  coffee: 'coffee', // dekat: gagang & badan cangkir dipisah jadi 2 path, sumber menyatu
  star: 'star', // dekat: bintang bersudut tajam (garis lurus), sumber membulat
  phone: 'phone', // dekat: gagang telepon digambar dengan garis lurus, sumber melengkung
  mail: 'mail', // dekat: proporsi amplop berbeda (18×14 vs sumber 20×16); lipatan diluruskan
  'map-pin': 'map-pin', // dekat: lingkaran cx12 cy10 r3 IDENTIK; garis tetesan disederhanakan
  qr: 'qr-code', // dekat: kotak sudut 7×7 (sumber 5×5); titik tengah disederhanakan jadi 1 path
} as const satisfies Record<string, LucideKebabName>;

/** Union 50 nama mockup + 48 nama bundle, tanpa duplikat. */
const _namaGabungan = new Set<string>([...NAMA_MOCKUP, ...Object.keys(PETA_BUNDLE)]);

export type IconName = (typeof NAMA_MOCKUP)[number] | keyof typeof PETA_BUNDLE;

export const iconNames: IconName[] = [..._namaGabungan] as IconName[];
