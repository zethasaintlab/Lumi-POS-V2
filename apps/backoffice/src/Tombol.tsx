/* Tombol yang dapat menerima `onClick`, `disabled`, dan `type="submit"`.

   ⛔ Kenapa BUKAN `<Button>` dari design system: `ds-bundle/_adherence.oxlintrc.json`
   -- yang `CLAUDE.md` nyatakan final dan tidak boleh diubah -- membatasi props
   `<Button>` menjadi tepat `variant`, `critical`, `fullWidth`, `className`,
   `style`, `key`, `ref`, `children`. Setiap prop lain, termasuk `onClick` dan
   `disabled`, adalah pelanggaran yang ditolak `npm run lint:ds` di CI.

   Berkas ini KEMBARAN `apps/kasir/src/Tombol.tsx`, dan duplikasinya disengaja:
   kedua aplikasi tidak berbagi kode UI (kasir memuat PowerSync, back-office
   tidak), dan mengangkatnya ke `packages/ds` berarti menaruh komponen buatan
   sendiri di dalam paket yang seluruh isinya adalah re-export design system.

   Kalau kelak `_adherence.oxlintrc.json` diperbarui untuk mengizinkan handler
   pada `<Button>`, kedua berkas ini dihapus bersamaan. */

type Varian = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  varian?: Varian;
  tipe?: 'button' | 'submit';
  penuh?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

export function Tombol({
  varian = 'secondary',
  tipe = 'button',
  penuh = false,
  disabled,
  onClick,
  children,
}: Props) {
  const kelas = ['btn', `btn-${varian}`].filter(Boolean).join(' ');
  // `width: 100%` inline, persis seperti `Button.jsx` design system melakukan
  // `fullWidth` — tidak ada kelas `btn-block` di `components.css`. Ini
  // lebar penuh induknya, bukan nilai ukuran yang dikarang.
  return (
    <button
      type={tipe}
      className={kelas}
      disabled={disabled}
      onClick={onClick}
      style={penuh ? { width: '100%' } : undefined}
    >
      {children}
    </button>
  );
}
