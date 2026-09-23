export interface CashierNavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}
export interface CashierNavProps {
  items: CashierNavItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
}
/**
 * One row, max 72px, everything visible at once. Scoped to a single app: LumiPOS's Kasir,
 * Back-office, and Lumi-Order do not share navigation - never wire this to another app's screens.
 */
export function CashierNav(props: CashierNavProps): JSX.Element;
