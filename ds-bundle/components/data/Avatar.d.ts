import * as React from 'react';

/** Avatar inisial dari nama. */
export interface AvatarProps {
  name?: string;
  size?: number;
  /** Override warna (mis. 'accent', 'violet'); default accent-soft. */
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet';
}

export declare function Avatar(props: AvatarProps): React.JSX.Element;
