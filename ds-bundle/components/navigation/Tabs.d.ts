import * as React from 'react';

/** Bilah tab; 'pill' berkotak atau 'underline' garis-bawah. */
export interface TabsProps {
  tabs: Array<string | { value: string; label: React.ReactNode; badge?: React.ReactNode }>;
  value: string;
  onChange?: (value: string) => void;
  variant?: 'pill' | 'underline';
  ariaLabel?: string;
}

export declare function Tabs(props: TabsProps): React.JSX.Element;
