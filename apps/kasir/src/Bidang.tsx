/* Field teks yang dapat menerima `value` dan `onChange`.

   Alasannya sama persis dengan `Tombol.tsx`: `ds-bundle/_adherence.oxlintrc.json`
   membatasi props `<Field>` menjadi `label`, `size`, `error`, `prefix`, `as`,
   `required` (plus `key`/`ref`/`className`/`style`/`children`). `value`,
   `onChange`, dan `type` adalah pelanggaran yang ditolak `lint:ds` di CI --
   meski komponennya me-spread `...rest` dan akan bekerja.

   Strukturnya menyalin `Field.jsx` apa adanya (`.stack` > `.label` + `.field`),
   jadi seluruh styling tetap milik `components.css` dan tidak ada nilai yang
   dikarang di sini.

   ## ⛔ Label WAJIB terhubung ke inputnya

   Sampai 16 September 2026 berkas ini merender `<label className="label">`
   TANPA `htmlFor`, dengan `<input>` sebagai SAUDARA — bukan anak. Tidak ada
   satu pun yang menghubungkan keduanya, jadi pembaca layar mengumumkan input
   tanpa nama: kasir yang memakainya mendengar "edit teks", bukan "Referensi
   pembayaran". Empat belas pemakaian di enam layar kasir terpapar, termasuk
   K-06 yang memindahkan uang.

   Gejalanya muncul lebih dulu di tempat lain: penjaga DOM K-06 tidak dapat
   memakai `getByLabel` sama sekali dan terpaksa mencari inputnya lewat elemen
   INDUK. Jalan memutar itu bekerja untuk test dan tidak menolong siapa pun
   yang memakai pembaca layar — dan ia menyembunyikan cacatnya alih-alih
   melaporkannya.

   ⛔ `htmlFor`, BUKAN membungkus input di dalam label. Pola ini sudah ada di
   repo: `apps/backoffice/src/Bidang.tsx` dan `apps/hp/src/Bidang.tsx`
   keduanya `<label className="label" htmlFor={id}>`, dan keduanya menyebut
   berkas ini kembarannya. Membungkus akan membuat ketiganya menyimpang, dan
   `aria-describedby` yang kedua kembaran pakai tetap menuntut `id`.

   ⛔ `id` OPSIONAL di sini, wajib di kedua kembaran, dan itu disengaja. Kedua
   kembaran lahir bersama layar login yang memang menyebut idnya; ke-14
   pemanggil di sini tidak mengirim apa pun. Menuntutnya berarti mengarang 14
   id di enam berkas layar, dan id yang diketik tangan adalah tempat
   tabrakan berikutnya lahir — dua Bidang ber-id sama membuat label kedua
   menunjuk input PERTAMA, tanpa satu pun error.

   `useId()` React menutup keduanya: ia stabil antar render (nilainya terikat
   posisi komponen di pohon, bukan pada hitungan render) dan unik per instance,
   jadi enam Bidang di satu layar mendapat enam id berbeda tanpa siapa pun
   memikirkannya. Nilai dari pemanggil tetap menang bila ia mengirimnya. */

import { useId } from 'react';

interface Props {
  /** Opsional; tanpa ini `useId()` yang menyediakannya. Lihat catatan di atas. */
  id?: string;
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

export function Bidang({ id, label, hint, type = 'text', inputMode, value, onChange, placeholder }: Props) {
  /* ⛔ Dipanggil TANPA SYARAT, juga saat `id` dikirim. Hook di balik cabang
     melanggar rules-of-hooks, dan pemanggil yang mulai/berhenti mengirim `id`
     akan menggeser urutan hook seluruh komponen. */
  const idOtomatis = useId();
  const idField = id ?? idOtomatis;

  return (
    <div className="stack">
      <label className="label" htmlFor={idField}>
        {label}
      </label>
      <input
        id={idField}
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
