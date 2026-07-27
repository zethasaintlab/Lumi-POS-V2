import * as React from 'react';

/** Toggle mode berkotak (Dine In / Takeaway). Netral, bukan aksen. */
export interface SegmentedControlProps {
  options: Array<string | { value: string; label: React.ReactNode }>;
  value: string;
  onChange?: (value: string) => void;
  ariaLabel?: string;
}

export declare function SegmentedControl(props: SegmentedControlProps): React.JSX.Element;
