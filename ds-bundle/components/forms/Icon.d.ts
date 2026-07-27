import * as React from 'react';

export type IconName =
  | 'search' | 'chevron-down' | 'chevron-left' | 'chevron-right'
  | 'alert' | 'check' | 'x' | 'plus' | 'minus'
  | 'wifi-off' | 'refresh' | 'clock' | 'receipt' | 'lock'
  | 'dashboard' | 'register' | 'chef' | 'layers' | 'package' | 'sliders'
  | 'tag' | 'truck' | 'clipboard' | 'file' | 'gift' | 'book'
  | 'user' | 'users' | 'table' | 'calendar' | 'shield' | 'activity'
  | 'settings' | 'message' | 'image' | 'bell' | 'swap' | 'download'
  | 'printer' | 'filter' | 'more' | 'edit' | 'coffee' | 'star'
  | 'phone' | 'mail' | 'map-pin' | 'qr';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** Nama glyph. Set ikon Lumi = Lucide, stroke inline. */
  name: IconName;
  /** Sisi kotak ikon dalam px. Default 20. */
  size?: number;
  strokeWidth?: number;
}

/** Ikon stroke SVG gaya Lucide, mewarisi currentColor. */
export declare function Icon(props: IconProps): React.JSX.Element | null;

export declare const iconNames: IconName[];
