export interface BadgeProps {
  children: React.ReactNode;
  /** accent is a neutral highlight chip (counts, selected filters). The other five map 1:1 to a real state and must never be used decoratively: success, info, pending, warning, danger. */
  tone?: "accent" | "success" | "info" | "pending" | "warning" | "danger";
}
export function Badge(props: BadgeProps): JSX.Element;
