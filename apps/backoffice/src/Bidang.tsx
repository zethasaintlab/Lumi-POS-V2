/* Field teks yang dapat menerima `value`, `onChange`, `type`, dan `id`.

   Alasannya sama persis dengan `Tombol.tsx`: `ds-bundle/_adherence.oxlintrc.json`
   membatasi props `<Field>` menjadi `label`, `size`, `error`, `prefix`, `as`,
   `required` (plus `key`/`ref`/`className`/`style`/`children`). `value`,
   `onChange`, `type`, `id`, dan `autoComplete` semuanya pelanggaran yang
   ditolak `lint:ds` di CI — meski `Field.jsx` me-spread `...rest`, dan meski
   `FieldProps` di `Field.d.ts` mewarisi `InputHTMLAttributes` sehingga
   TypeScript menerimanya. Typecheck lolos, adherence menolak; adherence
   menang.

   Kembaran `apps/kasir/src/Bidang.tsx`, dengan dua tambahan yang hanya
   dibutuhkan layar login: `id` (supaya `<label for>` dan `aria-describedby`
   menunjuk field-nya) dan `error` (pesan kegagalan login).

   Strukturnya menyalin `Field.jsx` apa adanya (`.stack` > `.label` +
   `.field` + `.field-error`), jadi seluruh styling tetap milik
   `components.css` dan tidak ada nilai yang dikarang di sini. */

interface Props {
  id: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  value: string;
  onChange: (nilai: string) => void;
  required?: boolean;
  autoComplete?: string;
  /** Pesan error; merahkan border, set `aria-invalid`, tampilkan pesannya. */
  error?: string;
}

export function Bidang({
  id,
  label,
  type = 'text',
  value,
  onChange,
  required = false,
  autoComplete,
  error,
}: Props) {
  return (
    <div className="stack">
      <label className="label" htmlFor={id}>
        {label}
        {required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <input
        id={id}
        className="field"
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span className="field-error" id={`${id}-err`}>
          {error}
        </span>
      )}
    </div>
  );
}
