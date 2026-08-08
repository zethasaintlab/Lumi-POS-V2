import { useState } from 'react';
import { Icon, SyncIndicator } from 'ds';
import { TABEL_RUTE, type Rute } from './rute/tabel.ts';
import { navigasi } from './rute/navigasi.ts';

/* Kerangka aplikasi kasir.

   SENGAJA BUKAN `AppShell` dari design system. `AppShell` adalah kerangka
   back-office -- sidebar berkelompok + breadcrumb -- dan IA §2.1 menyatakan
   batas ini secara eksplisit: "Kasir tidak punya sidebar; back-office punya.
   Memaksakan satu navigasi ke tiga konteks adalah kesalahan yang merusak
   ketiganya." Aplikasi kosong F0 memakai `AppShell` karena saat itu belum ada
   layar sama sekali; mulai sekarang ia keliru.

   Bentuknya mengikuti IA §2.1: topbar tetap (outlet · device · pengguna ·
   SyncIndicator · menu), lalu area utama. Kolom keranjang belum ada -- ia
   milik K-03, bukan pondasi. */

interface Props {
  outlet: string;
  device: string;
  pengguna: string;
  ruteAktif: Rute | null;
  children: React.ReactNode;
}

export function ShellKasir({ outlet, device, pengguna, ruteAktif, children }: Props) {
  const [menuTerbuka, setMenuTerbuka] = useState(false);

  return (
    <div className="kasir-shell">
      <header className="kasir-topbar">
        <span className="t-body-md truncate">{outlet}</span>
        <span className="t-caption">·</span>
        <span className="t-caption truncate">{device}</span>
        <span className="t-caption">·</span>
        <span className="t-caption truncate">{pengguna}</span>

        <span className="grow" />

        {/* Belum tersambung ke data antrean -- itu FR-H2, dan menyambungkannya
            di sini berarti mengerjakannya sambil menyebutnya pondasi.
            `offline-only` dipilih justru karena ia MENYATAKAN keadaan yang
            sebenarnya (aturan design system #5: status tidak pernah warna
            saja) alih-alih menampilkan "Tersinkron" yang tidak diketahui
            siapa pun benar. */}
        <SyncIndicator state="offline-only" reason="Status sinkronisasi belum tersambung" />

        <button
          type="button"
          className="btn"
          aria-expanded={menuTerbuka}
          aria-label="Menu"
          onClick={() => setMenuTerbuka((t) => !t)}
        >
          <Icon name="more" size={18} />
        </button>
      </header>

      {menuTerbuka && (
        <nav className="kasir-menu">
          {TABEL_RUTE.map((r) => (
            <button
              key={r.layar}
              type="button"
              className="btn"
              aria-current={ruteAktif?.layar === r.layar ? 'page' : undefined}
              onClick={() => {
                setMenuTerbuka(false);
                navigasi(r.jalur.includes(':') ? '/riwayat' : r.jalur);
              }}
            >
              <span className="truncate">{r.nama}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="kasir-konten">
        {children}
      </div>
    </div>
  );
}
