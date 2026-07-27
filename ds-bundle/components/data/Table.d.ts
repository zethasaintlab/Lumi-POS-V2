import * as React from 'react';

export interface TableColumn<Row = any> {
  key: string;
  header: React.ReactNode;
  /** 'right' → rata kanan + tabular-nums (kolom uang). */
  align?: 'left' | 'right';
  render?: (row: Row) => React.ReactNode;
}

/** Tabel zebra dengan keadaan kosong bawaan. */
export interface TableProps<Row = any> {
  columns: TableColumn<Row>[];
  rows: Row[];
  keyField?: string;
  caption?: string;
  /** Diganti saat rows kosong; bedakan "tak ada data" vs "tak cocok filter". */
  empty?: React.ReactNode;
}

export declare function Table<Row = any>(props: TableProps<Row>): React.JSX.Element;
