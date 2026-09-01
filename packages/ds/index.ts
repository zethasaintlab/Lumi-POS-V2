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
export { Icon, iconNames } from '../../ds-bundle/components/forms/Icon.jsx';
// Tipe nama ikon ikut keluar lewat permukaan publik. Tanpa ini, konsumen
// yang ingin mengetik datanya (mis. peta menu back-office) harus mengimpor
// internal ds-bundle — dan penjaga `no-restricted-imports` melarangnya,
// dengan benar.
export type { IconName } from '../../ds-bundle/components/forms/Icon';
export { SegmentedControl } from '../../ds-bundle/components/forms/SegmentedControl.jsx';
export { Stepper } from '../../ds-bundle/components/forms/Stepper.jsx';
export { Switch } from '../../ds-bundle/components/forms/Switch.jsx';
export { AppShell } from '../../ds-bundle/components/navigation/AppShell.jsx';
export { Tabs } from '../../ds-bundle/components/navigation/Tabs.jsx';

// ⛔ Dialog diekspor dari PEMBUNGKUS Lumi, bukan langsung dari bundle.
// Pembungkusnya menambahkan Escape-menutup-dialog, yang bundle tidak punya.
// Mengimpor langsung dari `ds-bundle` mengembalikan cacatnya; lihat overlay.tsx.
export { Modal, ConfirmDialog } from './overlay.tsx';
export { CartRow } from '../../ds-bundle/components/pos/CartRow.jsx';
export { ProductCard } from '../../ds-bundle/components/pos/ProductCard.jsx';
export { Ticket } from '../../ds-bundle/components/pos/Ticket.jsx';
