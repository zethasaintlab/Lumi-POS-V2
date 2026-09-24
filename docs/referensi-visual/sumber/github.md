repo: zethasaintlab/DesignSystemForLumiPOS
branch: main
path: src

## Last sync
date: 2026-09-15T00:10:00Z

### Updated in this project
- Tokenized all 72 light + 14 dark CSS variables from `src/index.css` into `tokens/colors.css`, `tokens/typography.css`, `tokens/spacing-shape.css`.
- Built the 8 reusable components DESIGN.md defines (Button, Badge, Input, ProductCard, PaymentCard, CashierNav, SkeletonLoader, MockupSwitcher) plus 14 foundation guideline cards.
- Built all three interactive UI kits: Kasir (13 screens), Back-office (7 screens incl. empty state), Lumi-Order (6 screens) - full 26-screen coverage from `lumipos-prompt.md`.
- Added `guidelines/validation-screen.html`, a non-product test screen validating the extracted tokens/components in light and dark mode.

## Screen map
| Project screen | Repo source |
|---|---|
| Design tokens | `src/index.css` |
| Kasir UI kit (all screens) | `src/App.tsx` (`Login`, `OpenShift`, `Cashier`, `Cart`, `Product`, `EditItem`, `Payment`, `QR`, `Success`, `Receipt`, `History`, `VoidRefund`, `CashDrawer`, `CloseShift`, `AppShell`) |
| Back-office UI kit | `DESIGN.md` section 10 (layout rules) + `lumipos-prompt.md` screens 15-20 |
| Lumi-Order UI kit | `DESIGN.md` section 10 (`--guest-background`) + `lumipos-prompt.md` screens 21-26 |
| Component inventory | `DESIGN.md` section 9 + `src/App.tsx` `Btn`/`Badge`/`Field` |
| Screen enumeration (26 screens) | `src/imports/pasted_text/lumipos-prompt.md` |
