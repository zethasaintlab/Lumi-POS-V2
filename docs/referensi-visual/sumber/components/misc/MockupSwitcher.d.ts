export interface MockupScreenOption {
  id: string;
  label: string;
}
export interface MockupSwitcherProps {
  appLabel: string;
  screens: MockupScreenOption[];
  activeScreen: string;
  onSelectScreen: (id: string) => void;
  dark?: boolean;
  onToggleDark?: () => void;
}
/**
 * A mockup/demo aid, not a product component. Never embed real product navigation inside it, and
 * never let it jump between LumiPOS's three apps - one instance covers exactly one app's screens.
 */
export function MockupSwitcher(props: MockupSwitcherProps): JSX.Element;
