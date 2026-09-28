# ds

Wrapper tipis di atas /ds-bundle. JANGAN mengubah design system — hanya konsumsi.

## Ikon

`ikon.tsx` (dan datanya, `ikon-data.ts`/`ikon-peta.ts`) adalah set ikon Lucide
`lucide-react@0.468.0` apa adanya, tanpa dependency npm baru (Task 6). Ia
diekspor lewat `index.ts` sebagai `Icon`/`iconNames`/`IconName` — pemakai di
`apps/**` sudah memakai yang ini.

`ds-bundle/components/**` sendiri (Modal, AppShell, StatCard, SyncIndicator,
Ticket, Stepper) masih memanggil `Icon` dari `forms/Icon.jsx` BUNDEL secara
INTERNAL — dan `ds-bundle/` tidak pernah disunting langsung. `vite-ikon.ts`
(`ikonLumi()`, Task 7) adalah override itu: plugin Vite yang mencegat impor
relatif `forms/Icon.jsx` di dalam `ds-bundle/components/` lewat `resolveId`
dan mengalihkannya ke `ikon.tsx`, sehingga ikon yang dirender komponen bundel
sendiri juga node Lucide, bukan gambar ulang bundel yang berbeda proporsi.

⛔ **Plugin ini sengaja TIDAK disembunyikan** (keputusan user 26 September
2026). Dipasang secara eksplisit, dengan komentar, di setiap config Vite
yang merender komponen bundel: `apps/kasir/vite.config.ts`,
`apps/kasir/vite.galeri.config.ts`, `apps/kasir/vite.k06.config.ts`,
`apps/backoffice/vite.config.ts`, `apps/hp/vite.config.ts`. Config baru yang
merender komponen bundel harus memasangnya juga —
`tests/runtime/ikon-lucide.test.js` memindai `apps/**/vite*.config.ts` (glob,
bukan daftar tetap) dan menolak yang lupa.
