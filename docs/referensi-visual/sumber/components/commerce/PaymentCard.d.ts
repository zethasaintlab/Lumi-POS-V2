export interface PaymentCardProps {
  /** Total amount due, shown at display size at the top of the card regardless of method. */
  total?: number;
  /** Quick-cash preset amounts for the Tunai method. */
  presets?: number[];
  /** Drives the QRIS method's four states: loading (skeleton, never a spinner), ready (code + expiry countdown), confirmed, expired. */
  qrisState?: "loading" | "ready" | "confirmed" | "expired";
  onQrisRegenerate?: () => void;
}

/**
 * @startingPoint section="Commerce" subtitle="One card, four payment methods toggled in place - never a page change" viewport="480x640"
 */
export function PaymentCard(props: PaymentCardProps): JSX.Element;
