import React from 'react';
import { EmptyState } from './EmptyState.jsx';

/* Tabel data dengan zebra baris. Kolom uang wajib rata-kanan + tabular
   (align: 'right' menambah kelas .right). Selalu punya keadaan kosong —
   bedakan "tidak ada data" dari "tidak ada yang cocok dengan filter". */
export function Table({ columns, rows, empty, keyField, caption }) {
  if (!rows || rows.length === 0) {
    return empty || <EmptyState title="Belum ada data" />;
  }
  return (
    <table className="table">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={keyField ? row[keyField] : i}>
            {columns.map((c) => (
              <td key={c.key} className={c.align === 'right' ? 'right' : undefined}>
                {c.render ? c.render(row) : row[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
