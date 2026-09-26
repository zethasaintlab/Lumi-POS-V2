/**
 * Set ikon Lumi — node `lucide-react@0.468.0` apa adanya, TANPA dependency
 * npm baru (`CLAUDE.md` § Aturan design system #8; keputusan kampanye
 * 26 September 2026, spec § 7 `docs/superpowers/specs/
 * 2026-09-26-fondasi-desain-design.md`).
 *
 * Sumber: `lucide-react@0.468.0`, lisensi ISC — lihat `packages/ds/LISENSI-LUCIDE`.
 * Node disalin dari `dist/esm/icons/*.js` (elemen dan atributnya, termasuk
 * `circle`/`line`/`rect`/`polyline`) lewat `tools/ekstrak-lucide.mjs`,
 * disimpan di `packages/ds/ikon-data.ts` (`NODES`). Atribut `key` Lucide
 * dibuang saat ekstraksi — key React untuk setiap node dihasilkan ulang di
 * bawah dari indeksnya saat merender.
 *
 * ⛔ 50 nama mockup dan pemetaan 48 nama `ds-bundle/components/forms/Icon.jsx`
 * (`PETA_BUNDLE`, dengan komentar per entri untuk yang tidak identik) hidup
 * di `./ikon-peta.ts`, BUKAN langsung di berkas ini. Alasannya bukan selera:
 * berkas ini berekstensi `.tsx`, dan Node menolak mengimpornya sama sekali —
 * `ERR_UNKNOWN_FILE_EXTENSION`/`SyntaxError` apa pun isinya, dengan atau
 * tanpa `--experimental-strip-types`, dengan atau tanpa JSX di dalamnya
 * (dibuktikan saat menulis Task 6, lihat kepala `ikon-peta.ts`). Data yang
 * `tests/runtime/ikon-lucide.test.js` (`node --test`, tanpa flag) perlu baca
 * karena itu wajib berbentuk `.ts` biasa. Diekspor ulang di bawah supaya
 * pemakai `Icon`/`iconNames`/`IconName`/`PETA_BUNDLE` tidak perlu tahu
 * pembagian berkasnya.
 *
 * Atribut SVG induk sama dengan Lucide: `viewBox="0 0 24 24"`, `fill="none"`,
 * `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`,
 * `stroke-linejoin="round"`. API sama dengan `ds-bundle/components/forms/
 * Icon.jsx`: `size` default 20, `aria-hidden="true"`, nama tak dikenal →
 * `null` (perilaku bundle, dipertahankan; lihat `tests/runtime/
 * ikon-lucide.test.js` (d) yang membuktikan tidak ada nama TERDAFTAR yang
 * jatuh ke cabang itu).
 */
import { createElement } from 'react';
import type { CSSProperties, SVGProps } from 'react';
import { NODES } from './ikon-data.ts';
import { PETA_BUNDLE, iconNames, type IconName } from './ikon-peta.ts';

export { PETA_BUNDLE, iconNames };
export type { IconName };

export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Nama glyph — salah satu dari `iconNames` (kebab Lucide atau nama bundle lama). */
  name: IconName;
  /** Sisi kotak ikon dalam px. Default 20. */
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  className,
  style,
  ...rest
}: IconProps) {
  const kebab = name in PETA_BUNDLE ? PETA_BUNDLE[name as keyof typeof PETA_BUNDLE] : name;
  const nodes = NODES[kebab as keyof typeof NODES];
  if (!nodes) return null;
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className,
      style,
      'aria-hidden': 'true',
      ...rest,
    },
    nodes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
  );
}
