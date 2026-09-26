export { Avatar } from '../../ds-bundle/components/data/Avatar.jsx';
export { Badge } from '../../ds-bundle/components/data/Badge.jsx';
export { Card } from '../../ds-bundle/components/data/Card.jsx';
export { EmptyState } from '../../ds-bundle/components/data/EmptyState.jsx';
export { StatCard } from '../../ds-bundle/components/data/StatCard.jsx';
export { SyncIndicator } from '../../ds-bundle/components/data/SyncIndicator.jsx';
export { Table } from '../../ds-bundle/components/data/Table.jsx';
export { Button } from '../../ds-bundle/components/forms/Button.jsx';
export { Chip } from '../../ds-bundle/components/forms/Chip.jsx';
export { Field } from '../../ds-bundle/components/forms/Field.jsx';
// ⛔ `Icon`/`iconNames`/`IconName` dari `./ikon.tsx` (Task 6), BUKAN lagi
// dari `ds-bundle/components/forms/Icon.jsx`. Set penuh sekarang node
// `lucide-react@0.468.0` apa adanya (`packages/ds/ikon-data.ts`); Icon.jsx
// bundle tetap ada dan tetap dipakai KOMPONEN LAIN di dalam bundle sendiri
// (Modal, AppShell, StatCard, SyncIndicator, Ticket, Stepper) — mengalihkan
// impor INTERNAL itu ke sini adalah plugin Vite Task 7, bukan bagian ini.
export { Icon, iconNames } from './ikon.tsx';
export type { IconName } from './ikon.tsx';
export { SegmentedControl } from '../../ds-bundle/components/forms/SegmentedControl.jsx';
export { Stepper } from '../../ds-bundle/components/forms/Stepper.jsx';
export { Switch } from '../../ds-bundle/components/forms/Switch.jsx';
export { AppShell } from '../../ds-bundle/components/navigation/AppShell.jsx';
export { Tabs } from '../../ds-bundle/components/navigation/Tabs.jsx';

// ⛔ Dialog diekspor dari PEMBUNGKUS Lumi, bukan langsung dari bundle.
// Pembungkusnya menambahkan Escape-menutup-dialog, yang bundle tidak punya.
// Mengimpor langsung dari `ds-bundle` mengembalikan cacatnya; lihat overlay.tsx.
export { Modal, ConfirmDialog } from './overlay.tsx';
// ⛔ `CartRow` dan `ProductCard` SENGAJA TIDAK diekspor. Bukan terlewat.
//
// Keduanya menyentuh angka uang, dan keduanya dirancang untuk basis kode yang
// memakai `number` untuk uang:
//
//   CartRow      `unitPrice * qty` — perkalian float di jalur uang
//   ProductCard  `'Rp ' + n.toLocaleString('id-ID')` — salinan pemformat, dan
//                ia tidak menghasilkan `−` untuk nilai negatif
//
// Repo ini memakai `bigint` rupiah utuh (`CLAUDE.md` § Konvensi data), dan
// pemformatnya satu: `packages/domain/src/uang-tampilan.ts`. Masing-masing
// komponen di atas membawa salinan pemformat sendiri.
//
// Yang dipakai sebagai gantinya adalah KELAS-nya — `.cart-row`, `.product-card`
// — di atas markup kita. Kelas CSS tidak menghitung apa pun; hanya komponen
// yang melakukannya. Aturan lengkapnya di `CLAUDE.md` § Aturan memakai
// `/ds-bundle`, dijaga `tests/runtime/komponen-bundle-uang.test.js`.
//
// ⛔ `CartRow` tetap layak DICONTEK pada satu hal, dan sudah dicontek: qty
// turun ke 0 memanggil `onRemove`, sehingga tombol "Hapus" terpisah tidak
// perlu ada sama sekali.
export { Ticket } from '../../ds-bundle/components/pos/Ticket.jsx';

// `potongSentuh` — helper untuk memotong area sentuh tak terlihat
// (`.sentuh`/`.sentuh-uang`, `lumi.css`) pada sisi yang menghadap tetangga,
// dari CELAH SEBENARNYA layout. Lahir Task 5 (galeri `fondasi`), dipindah
// ke sini karena sub-proyek 2 butuh mekanisme yang sama di layar kasir
// sungguhan — lihat komentar `sentuh.ts`.
export { potongSentuh } from './sentuh.ts';
