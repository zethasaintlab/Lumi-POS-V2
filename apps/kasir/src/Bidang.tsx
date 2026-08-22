/* Field teks yang dapat menerima `value` dan `onChange`.

   Alasannya sama persis dengan `Tombol.tsx`: `ds-bundle/_adherence.oxlintrc.json`
   membatasi props `<Field>` menjadi `label`, `size`, `error`, `prefix`, `as`,
   `required` (plus `key`/`ref`/`className`/`style`/`children`). `value`,
   `onChange`, dan `type` adalah pelanggaran yang ditolak `lint:ds` di CI --
   meski komponennya me-spread `...rest` dan akan bekerja.

   Strukturnya menyalin `Field.jsx` apa adanya (`.stack` > `.label` + `.field`),
   jadi seluruh styling tetap milik `components.css` dan tidak ada nilai yang
   dikarang di sini. */

interface Props {
  label: string;
  hint?: string;
  type?: 'text' | 'password';
  /* Papan ketik yang muncul di tablet. `type` tetap `text` — `type="number"`
     membawa spinner, menerima notasi eksponen, dan mengembalikan string kosong
     untuk masukan yang setengah jadi, sehingga angka yang sedang diketik
     hilang begitu saja. */
  inputMode?: 'numeric' | 'decimal';
  value: string;
  onChange: (nilai: string) => void;
  placeholder?: string;
}

export function Bidang({ label, hint, type = 'text', inputMode, value, onChange, placeholder }: Props) {
  return (
    <div className="stack">
      <label className="label">{label}</label>
      <input
        className="field"
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="t-caption">{hint}</span>}
    </div>
  );
}
