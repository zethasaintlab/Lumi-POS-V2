import * as React from 'react';

/** Toggle setelan on/off; track 44px (target sentuh). */
export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  ariaLabel?: string;
}

export declare function Switch(props: SwitchProps): React.JSX.Element;
