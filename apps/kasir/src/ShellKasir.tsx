import { useState } from 'react';
import { Icon, SyncIndicator } from 'ds';
import { keadaanIndikator } from '../../../packages/sync-client/src/status.ts';
import { TABEL_RUTE, type Rute } from './rute/tabel.ts';
import { navigasi } from './rute/navigasi.ts';
import { useAntrean } from './konteks/useAntrean.ts';
import { PitaAntrean } from './PitaAntrean.tsx';

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
  const { ringkasan, siap } = useAntrean();
  const indikator = keadaanIndikator(ringkasan);

  return (
    <div className="kasir-shell">
      <header className="kasir-topbar">
        <span className="t-body-md truncate">{outlet}</span>
        <span className="t-caption">·</span>
        <span className="t-caption truncate">{device}</span>
        <span className="t-caption">·</span>
        <span className="t-caption truncate">{pengguna}</span>

        <span className="grow" />

        {/* FR-H2. `IA:114`: indikator ini adalah ENTRY POINT ke K-14, dan
            relasinya harus eksplisit -- "indikator yang tidak dapat diklik
            membuat kasir tidak tahu harus berbuat apa".

            Selama database belum siap, yang ditampilkan `offline-only`
            beserta alasannya: aturan design system #5 melarang status yang
            hanya warna, dan "Tersinkron" saat kita belum bisa membaca antrean
            adalah klaim yang tidak diketahui siapa pun benar. */}
        {/* `span role="button"`, BUKAN `<button>`: pada state `failed`,
            `SyncIndicator` merender tombol "Coba lagi" miliknya sendiri, dan
            tombol di dalam tombol adalah HTML tidak sah. Keduanya menuju
            tempat yang sama (K-14), jadi tidak ada aksi yang hilang. */}
        <span
          role="button"
          tabIndex={0}
          className="kasir-indikator"
          aria-label="Buka Status Sinkronisasi"
          onClick={() => navigasi('/sync')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              navigasi('/sync');
            }
          }}
        >
          {siap ? (
            <SyncIndicator
              state={indikator.state}
              count={indikator.count}
              // `spec-h:216` menuliskan teks gagal utuh: "Gagal kirim (2) ·
              // Coba lagi". Bagian "Coba lagi" hanya muncul bila `onRetry`
              // diberikan -- ia tombol di dalam komponen, bukan label.
              onRetry={indikator.state === 'failed' ? () => navigasi('/sync') : undefined}
            />
          ) : (
            <SyncIndicator state="offline-only" reason="Antrean belum dapat dibaca" />
          )}
        </span>

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

      {/* FR-H8. DI LUAR `kasir-konten`, jadi ia mendorong isi alih-alih
          melayang di atasnya — "banner, bukan dialog" (AC FR-H8 kedua) juga
          berarti tidak menutupi tombol yang sedang dituju jari kasir. */}
      <PitaAntrean tertuaPada={siap ? ringkasan.tertuaPada : null} />

      <div className="kasir-konten">
        {children}
      </div>
    </div>
  );
}
