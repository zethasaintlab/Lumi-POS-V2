import { nomorHalaman, type Halaman } from './halaman.ts';

/**
 * Bilah paginasi K-08. TEMUAN D3.
 *
 * ⛔ Rentang ("1–25 dari 137") SELALU tampil, juga saat hanya ada satu
 * halaman. Daftar yang tidak menyebut totalnya membuat kasir tidak dapat
 * membedakan "riwayat perangkat ini memang pendek" dari "saringannya
 * menyisakan sedikit" — bentuk kekosongan yang sama dengan yang
 * `docs/verifikasi/KELAS-GAGAL.md` catat, satu tingkat lebih halus.
 *
 * Tombolnya HILANG saat hanya ada satu halaman; angkanya tidak.
 */
export function Paginasi<T>({
  halaman,
  onPindah,
}: {
  halaman: Halaman<T>;
  onPindah: (nomor: number) => void;
}) {
  const { nomor, jumlahHalaman, rentang } = halaman;

  return (
    <div className="kasir-paginasi">
      <span className="t-caption kasir-login-sub" role="status">
        {rentang}
      </span>

      {jumlahHalaman > 1 && (
        <nav className="kasir-paginasi-nomor" aria-label="Halaman riwayat">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={nomor === 1}
            onClick={() => onPindah(nomor - 1)}
          >
            Sebelumnya
          </button>

          {nomorHalaman(nomor, jumlahHalaman).map((n, i) =>
            n === null ? (
              /* Elipsis BUKAN tombol, dan `aria-hidden` supaya pembaca layar
                 tidak mengumumkan "titik titik titik" di antara nomor. */
              <span key={`sela-${i}`} className="t-caption" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className="btn btn-ghost"
                /* ⛔ `aria-current`, bukan hanya warna. Halaman yang sedang
                    dibuka adalah status, dan aturan DS #5 melarang status yang
                    hanya warna — di sini penandanya sekaligus dapat dibaca
                    pembaca layar. */
                aria-current={n === nomor ? 'page' : undefined}
                onClick={() => onPindah(n)}
              >
                {n}
              </button>
            )
          )}

          <button
            type="button"
            className="btn btn-ghost"
            disabled={nomor === jumlahHalaman}
            onClick={() => onPindah(nomor + 1)}
          >
            Berikutnya
          </button>
        </nav>
      )}
    </div>
  );
}
