import { SyncIndicator, Tabs } from 'ds';
import { keadaanIndikator } from '../../../packages/sync-client/src/status.ts';
import { ruteNav, type Rute } from './rute/tabel.ts';
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
  /**
   * Apakah perangkat ini sudah didaftarkan (K-15).
   *
   * ⛔ Indikator sinkronisasi MEMBUTUHKANNYA. Tanpa ini ia menurunkan
   * keadaannya hanya dari hitungan antrean, dan antrean kosong pada perangkat
   * yang belum terdaftar terbaca "Tersinkron" — bersebelahan dengan tulisan
   * "Perangkat belum terdaftar" di topbar yang sama.
   */
  perangkatTerdaftar: boolean;
  ruteAktif: Rute | null;
  children: React.ReactNode;
}

export function ShellKasir({ outlet, device, pengguna, perangkatTerdaftar, ruteAktif, children }: Props) {
  const nav = ruteNav();
  const { ringkasan, siap } = useAntrean();
  const indikator = keadaanIndikator(ringkasan, { perangkatTerdaftar });

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

      </header>

      {/* ⛔ Bilah nav PERSISTEN menggantikan menu "…", 2 September 2026.
          Menu ⋮ menuntut DUA ketukan untuk setiap perpindahan, dan yang
          pertama tidak memberi informasi apa pun — kasir menekan tombol
          bertanda titik-titik untuk mencari tahu apa yang ada di baliknya.
          Ia juga menyembunyikan layar mana yang sedang aktif, tepat pada
          aplikasi yang dipakai berdiri sambil melayani orang.

          `<Tabs variant="underline">` dari `/ds-bundle` — komponen yang sudah
          dipakai back-office dan belum pernah dipakai kasir. Ia menandai tab
          aktif dengan aksen DAN `aria-selected`, jadi keadaannya tidak pernah
          warna saja (aturan DS #5).

          ⛔ `/login` dan `/shift/buka` sengaja TIDAK ada di bilah ini — lihat
          `Rute.nav` di `rute/tabel.ts`. Keduanya gerbang, dan tab menuju
          gerbang yang sudah dilewati mengundang kasir keluar dari shift yang
          sedang berjalan. */}
      <Tabs
        variant="underline"
        ariaLabel="Navigasi kasir"
        value={ruteAktif?.jalur ?? ''}
        onChange={(jalur) => navigasi(jalur)}
        tabs={nav.map((r) => ({ value: r.jalur, label: r.nav?.label ?? r.nama }))}
      />

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
