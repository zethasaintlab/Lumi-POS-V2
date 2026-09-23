# LumiPOS Design System

LumiPOS is a point-of-sale platform for small Indonesian food, drink, and retail businesses. Interface language is fully Bahasa Indonesia. Three apps share this system but never share navigation:

- **Kasir** - staff-facing, tablet/desktop, speed above all, same three screens used hundreds of times a day.
- **Back-office** - owner-facing, desktop, clarity over speed.
- **Lumi-Order** - customer-facing, mobile portrait, seen once, must be instantly legible.

## Sources
- Code: GitHub `zethasaintlab/DesignSystemForLumiPOS`, branch `main` (26 mockup screens across the three apps, tokens in `src/index.css`). See `github.md`.
- Rules and rationale: user-provided `DESIGN.md`.
- Priority when they conflict: **code wins on values** (color, size, spacing); **DESIGN.md wins on rules and reasoning**.

## Index
- `styles.css` - the single global stylesheet consumers link. Imports everything in `tokens/`.
- `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing-shape.css` - all design tokens as CSS custom properties.
- `components/` - the reusable primitives DESIGN.md defines: `core/Button`, `feedback/Badge`, `feedback/SkeletonLoader`, `forms/Input`, `commerce/ProductCard`, `commerce/PaymentCard`, `navigation/CashierNav`, `misc/MockupSwitcher`.
- `guidelines/` - 14 foundation specimen cards (colors, type, spacing, shape).
- `ui_kits/kasir/` - interactive recreation of the Kasir app (login through close-shift), 13 screens.
- `ui_kits/backoffice/` - Dashboard, Katalog Produk (+ empty state), Edit Produk (3 image-error states), Manajemen Staf, Laporan, Pengaturan.
- `ui_kits/order/` - Lumi-Order mobile flow: Masuk via QR, Menu, Detail Item, Keranjang, Pembayaran QRIS (4 states), Status Pesanan.
- `guidelines/validation-screen.html` - a non-product test screen for validating the extracted system (palette, four sizes, all button states, three product-card states, five badges, input error, skeleton), light/dark toggle.

## Content fundamentals
- Bahasa Indonesia throughout, direct and functional - the interface states what something is, never how it feels about it.
- Error messages: what happened, then what to do, in that order.
- No exclamation marks except on a genuine successful transaction. No cute microcopy - a cashier reads the same string 300 times a day.
- Plain transactional terms ("Transaksi Penjualan", "Tutup Kas"), never a made-up brand vocabulary for ordinary functions.
- Indonesian number formatting: `Rp 45.000` with a period as the thousands separator.
- Zero em dash characters anywhere user-visible. Use a regular hyphen or a period instead.

## Visual foundations
- **Type**: Nunito Sans, weights 400/600/700/800 only, loaded from Google Fonts. Exactly four sizes - 32/20/15/13px (`--text-display/title/body/small`) - never a fifth; fix hierarchy with weight or color instead. Monospace (`Courier New`) appears only in the thermal receipt preview.
- **Color**: one accent color in the whole product, `--primary` (`#14706b` light / `#57aaa4` dark). Five status color pairs used only for real states, never decoration. 14 tokens differ between light and dark mode; everything else is shared.
- **Shape**: one radius system - 12px cards/panels/modals, 10px controls, full pill for badges/chips. Never mixed.
- **Elevation**: shadows tinted with the product's teal, never pure black, and only where they carry real hierarchy - `--shadow-card` and `--shadow-raised`.
- **Spacing**: multiples of four - 4/8/12/16/24/32.
- **Touch targets**: 44px absolute minimum, 56px for the cashier's primary actions (product cards, pay button, keypad, qty stepper).
- **Imagery**: real product photography (Unsplash placeholders used in kits) - never a gray box for "not photographed yet"; a named dashed-frame state for "failed to load". No decorative gradients, no generic AI-slop cards.
- **Icons**: `lucide-react` (matches the source's `package.json`), loaded from the same CDN build in the UI kits.

## Non-negotiable rules (see DESIGN.md section 11 for the full list)
1. Product cards with no photo show zero placeholder boxes.
2. Failed-to-load product images show a named state, visually distinct from "not photographed".
3. The cashier catalog grid fits at least 12 cards without scrolling on a landscape tablet.
4. Payment is one card with a method toggle - switching methods never changes the page.
5. Zero em dashes anywhere user-visible.
6. Labels above inputs, errors below, placeholders never substitute for labels.
7. Button labels max three words, never wrap.
8. Every interactive component has all states: default, hover, active, disabled, loading, error.
9. No decorative colored dots in front of nav items or list rows.
10. No numbered labels like "01 / Katalog".
11. Zero hardcoded hex in components - everything through a CSS variable.
12. One accent color across the whole product.
13. Realistic Indonesian sample data (see `guidelines/`, kits).
14. No cross-app navigation between Kasir, Back-office, and Lumi-Order.

## Intentional additions
- `MockupSwitcher` - not a LumiPOS product component. A deliberately off-brand helper for jumping between a single app's own mockup screens/states without simulating the flow. Never links between apps, never ships.

## Iconography
No local icon assets in the source repo - icons come entirely from `lucide-react` (see `package.json`). The UI kit loads the exact pinned version (`0.468.0`) via `esm.sh` so icons match the source precisely. No emoji, no icon font, no SVG sprite.

## Caveats
- No logo exists in the source; the wordmark is set in plain type (`LumiPOS` + a `Store` icon) everywhere a mark would go.
- Component `.jsx` files use inline styles reading the CSS custom properties directly (no Tailwind dependency) so they stay copy-paste portable into any codebase; the three UI kits use Tailwind CDN + the original arbitrary-value classes for speed and fidelity to the source. All read the same `styles.css` tokens.
- Each kit's Mockup Switcher bar only jumps between that app's own screens - never across apps, per the no-cross-navigation rule.
