export interface ButtonProps {
  children: React.ReactNode;
  /** primary = filled accent, the only accent color in the product. secondary = outlined, no fill. ghost = borderless, quiet actions. danger = destructive actions only. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** default = 44px minimum touch target. primaryAction = 56px, reserved for cashier-screen primary actions (pay button, keypad digits, quantity stepper). */
  size?: "default" | "primaryAction";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}

/**
 * @startingPoint section="Core" subtitle="Primary, secondary, ghost, and danger button variants" viewport="700x160"
 */
export function Button(props: ButtonProps): JSX.Element;
