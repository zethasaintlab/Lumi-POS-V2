import * as React from 'react';

/** Stepper jumlah. Tiap tombol 44×44px walau ringkas. */
export interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange?: (next: number) => void;
  /** Nama item untuk aria-label, mis. "Americano". */
  label?: string;
  disabled?: boolean;
}

export declare function Stepper(props: StepperProps): React.JSX.Element;
