import type { JSX } from 'react';
import { Icon } from './ikon.tsx';

/**
 * Wordmark "LumiPOS" — satu komponen, dipakai di ketiga aplikasi.
 *
 * Keputusan user 26 September 2026 (spec § 8
 * `docs/superpowers/specs/2026-09-26-fondasi-desain-design.md`) menggantikan
 * aturan lama "logo, nama 'Lumi POS' tidak disentuh": ejaan berubah dari
 * "Lumi POS" (dengan spasi) menjadi "LumiPOS", dan bentuk mereknya kini
 * ikon `store` di kotak beraksen, bukan huruf pertama.
 *
 * Dipakai di:
 *   - `ShellKasir.tsx` (topbar kasir);
 *   - `apps/backoffice/src/App.tsx` (`AppShell.brand.logo`, menggantikan
 *     `LogoLumi` — lihat komentar `.shell-brand` di `lumi.css` untuk kenapa
 *     `brand.name` DISEMBUNYIKAN lewat CSS, bukan dihapus dari prop);
 *   - layar masuk back-office dan HP.
 *
 * Markup MENGIKUTI kepala `ui_kits/kasir/index.html` persis: kotak ikon lalu
 * teks, bukan sebaliknya — dan keduanya `<span>`, bukan `<button>`/`<div>`,
 * supaya komponen ini aman ditaruh di dalam elemen interaktif lain (mis.
 * dalam `<button>` mockup) tanpa nesting yang tidak sah.
 */
export function Wordmark(): JSX.Element {
  return (
    <span className="wordmark">
      <span className="wordmark-ikon">
        <Icon name="store" size={20} />
      </span>
      <span className="wordmark-teks">LumiPOS</span>
    </span>
  );
}
