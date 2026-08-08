/* Tombol yang dapat menerima `onClick` dan `disabled`.

   ⛔ Kenapa BUKAN `<Button>` dari design system: `ds-bundle/_adherence.oxlintrc.json`
   -- yang `CLAUDE.md` nyatakan final dan tidak boleh diubah -- membatasi props
   `<Button>` menjadi tepat `variant`, `critical`, `fullWidth`, `className`,
   `style`, `key`, `ref`, `children`. Setiap prop lain, termasuk `onClick` dan
   `disabled`, adalah pelanggaran yang ditolak `npm run lint:ds` di CI.

   Komponen `Button` itu sendiri me-spread `...rest`, jadi ia akan BEKERJA;
   yang menolaknya adalah kontrak adherence, dan kontraknya menang.

   Jalan keluarnya bukan mengakali linter melainkan mengikuti apa yang
   design system SENDIRI lakukan: `SyncIndicator.jsx` merender
   `<button className="btn btn-danger">` langsung. Kelas-kelasnya milik
   `components.css`, jadi seluruh styling tetap lewat token dan tidak ada
   nilai yang dikarang di sini.

   Kalau kelak `_adherence.oxlintrc.json` diperbarui untuk mengizinkan handler
   pada `<Button>`, berkas ini dihapus dan pemakaiannya diganti. */

type Varian = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  varian?: Varian;
  /** Aksi menyangkut uang: target sentuh 56px (aturan design system #3). */
  kritis?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

export function Tombol({ varian = 'secondary', kritis = false, disabled, title, onClick, children }: Props) {
  const kelas = ['btn', `btn-${varian}`, kritis ? 'btn-critical' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={kelas} disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  );
}
