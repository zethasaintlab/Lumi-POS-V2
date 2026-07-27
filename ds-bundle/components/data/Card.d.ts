import * as React from 'react';

/** Wadah bersurface putih, dibedakan oleh border. */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Padding standar 16px. Set false untuk kartu yang mengatur padding sendiri. */
  pad?: boolean;
}

export declare function Card(props: CardProps): React.JSX.Element;
