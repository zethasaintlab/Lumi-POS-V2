import { useState } from 'react';
import { Icon, SyncIndicator, Tabs, Wordmark, type IconName } from 'ds';
import { keadaanIndikator } from '../../../packages/sync-client/src/status.ts';
import { ruteNav, type Rute } from './rute/tabel.ts';
import { navigasi } from './rute/navigasi.ts';
import { useAntrean } from './konteks/useAntrean.ts';
import { useKeadaanLokal } from './konteks/DbLokalProvider.tsx';
import { PitaAntrean } from './PitaAntrean.tsx';
import { MenuPengguna } from './komponen/MenuPengguna.tsx';
import { PanelPemberitahuan } from './komponen/PanelPemberitahuan.tsx';

/* Kerangka aplikasi kasir.

   SENGAJA BUKAN `AppShell` dari design system. `AppShell` adalah kerangka
   back-office -- sidebar berkelompok + breadcrumb -- dan IA §2.1 menyatakan
   batas ini secara eksplisit: "Kasir tidak punya sidebar; back-office punya.
   Memaksakan satu navigasi ke tiga konteks adalah kesalahan yang merusak
   ketiganya." Aplikasi kosong F0 memakai `AppShell` karena saat itu belum ada
   layar sama sekali; mulai sekarang ia keliru.

   ⛔ Header SATU BARIS 68 px, Task 3 kampanye Hidupkan desain (26 September
   2026, spec § 3). Sebelumnya DUA baris: `.kasir-topbar` (61 px) + bilah nav
   berikon `.kasir-bilah` (45 px) — 106 px chrome per layar. Keduanya
   digabung jadi satu `<header className="kasir-header">`; `SLOT_AKSI` dan
   `PortalAksi` DIHAPUS sepenuhnya karena tidak ada lagi slot untuk diisi —
   aksi setiap layar sekarang di badan layar itu sendiri (`.kasir-toolbar`
   K-03, `.kasir-aksi-bawah` K-12, baris kepala K-14). */

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
   * "Perangkat belum terdaftar" di header yang sama.
   */
  perangkatTerdaftar: boolean;
  ruteAktif: Rute | null;
  children: React.ReactNode;
}

export function ShellKasir({ outlet, device, pengguna, perangkatTerdaftar, ruteAktif, children }: Props) {
  const nav = ruteNav();
  const { ringkasan, siap, antreanTerbaca } = useAntrean();
  /* ⛔ `useKeadaanLokal()`, BUKAN `useDbLokal()`. Yang kedua MELEMPAR selama
     database belum siap, dan header harus tetap dapat dirender di keadaan
     itu — `App.tsx`: "Topbar dan menu tetap ada, kalau tidak kasir terjebak
     di satu layar galat tanpa jalan ke mana pun." `MenuPengguna` (Keluar) dan
     `PanelPemberitahuan` (lonceng) keduanya menerima `db` yang boleh `null`. */
  const { lokal } = useKeadaanLokal();
  const [panelTerbuka, setPanelTerbuka] = useState(false);

  /* ⛔ `siap` saja TIDAK cukup, dan selisih antara keduanya adalah cacat yang
     hidup di sini sampai 21 September 2026.

     `siap` berarti database lokal TERBUKA. Ia tidak berarti antreannya pernah
     terbaca: `ringkasanAntrean` dapat menolak pada database yang terbuka
     sempurna (OPFS penuh, skema lokal belum bermigrasi), dan `useAntrean`
     menelan penolakan itu lalu menyerahkan `RINGKASAN_KOSONG`. Indikator
     karena itu berbunyi "Tersinkron" -- klaim tentang angka yang tidak pernah
     ada -- di SETIAP layar, sepanjang shift.

     `antreanTerbaca` bernilai `false` sampai pembacaan PERTAMA berhasil, bukan
     hanya saat pembacaan menolak: yang ditampilkan sebelum itu juga nol, dan
     nol yang belum diukur tidak lebih benar daripada nol yang gagal diukur.

     Komentar di bawah sudah menuliskan aturannya sejak awal -- "'Tersinkron'
     saat kita belum bisa membaca antrean adalah klaim yang tidak diketahui
     siapa pun benar"; yang kurang hanyalah cara shell MENGETAHUINYA. */
  const angkaDapatDipercaya = siap && antreanTerbaca;
  const indikator = keadaanIndikator(ringkasan, { perangkatTerdaftar });

  return (
    <div className="kasir-shell">
      <header className="kasir-header">
        {/* Wordmark "LumiPOS" — komponen SATU-SATUNYA (Task 8, keputusan user
            26 September 2026), dipakai identik di ShellKasir, `AppShell`
            back-office, dan kedua layar masuk. Menuliskan bentuk merek
            sendiri di sini akan menyimpang dari ketiganya diam-diam; lihat
            komentar kepala `packages/ds/Wordmark.tsx`. */}
        <Wordmark />

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
            sedang berjalan.

            ⛔ EMPAT tab, mengikuti mockup (Kasir · Riwayat · Laci kas · Tutup
            shift; `rute/tabel.ts`). `/sync` dan `/perangkat` pindah ke `MenuPengguna`. */}
        <Tabs
          variant="underline"
          ariaLabel="Navigasi kasir"
          value={ruteAktif?.jalur ?? ''}
          onChange={(jalur) => navigasi(jalur)}
          tabs={nav.map((r) => ({
            value: r.jalur,
            /* ⛔ `label` menerima ReactNode — `Tabs` bundle merendernya apa
               adanya (`{lbl}`), jadi ikon di atas label tidak menuntut komponen
               tab kedua yang ditulis sendiri. Yang ditulis sendiri akan
               menyimpang dari back-office yang memakai `Tabs` yang sama. */
            label: (
              <>
                <Icon name={(r.nav?.ikon ?? 'layers') as IconName} size={18} />
                <span>{r.nav?.label ?? r.nama}</span>
              </>
            ),
          }))}
        />

        {/* Kanan header: indikator sinkron, lonceng, tombol pengguna — SATU
            grup yang didorong ke ujung kanan (`margin-left: auto`), sama
            polanya dengan slot aksi lama. */}
        <div className="kasir-header-kanan">
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
            {angkaDapatDipercaya ? (
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

          {/* P7(a), disetujui — lonceng membuka panel "Pemberitahuan
              perangkat", yang HANYA membaca data yang sudah ada di
              perangkat (`kasir/pemberitahuan.ts`). */}
          <button
            type="button"
            className="kasir-lonceng"
            aria-label="Pemberitahuan perangkat"
            aria-haspopup="dialog"
            aria-expanded={panelTerbuka}
            onClick={() => setPanelTerbuka((t) => !t)}
          >
            <Icon name="bell" size={20} />
          </button>

          {/* ⛔ Identitas outlet · perangkat TIDAK dibuang demi kerapian —
              prefiks device (`K1-20260726-0007`) adalah satu-satunya cara
              mencocokkan struk dengan perangkat yang mencetaknya. Ia pindah
              ke dalam tombol pengguna sebagai baris kedua 13 px di bawah
              nama (spec § 3, keputusan otonom butir 3), bukan lagi baris
              sendiri di topbar. */}
          <MenuPengguna pengguna={pengguna} outlet={outlet} device={device} db={lokal?.db ?? null} />
        </div>
      </header>

      {/* FR-H8. DI LUAR `kasir-konten`, jadi ia mendorong isi alih-alih
          melayang di atasnya — "banner, bukan dialog" (AC FR-H8 kedua) juga
          berarti tidak menutupi tombol yang sedang dituju jari kasir. */}
      {/* ⛔ Pita FR-H8 memakai syarat yang SAMA dengan indikator. `tertuaPada`
          yang berasal dari pembacaan yang menolak adalah `null`, dan `null`
          berarti "tidak ada yang tertunggak" — pita itu karena itu akan DIAM
          justru pada perangkat yang antreannya tidak dapat diperiksa. */}
      <PitaAntrean tertuaPada={angkaDapatDipercaya ? ringkasan.tertuaPada : null} />

      <div className="kasir-konten">
        {children}
      </div>

      {panelTerbuka && (
        <PanelPemberitahuan db={lokal?.db ?? null} onClose={() => setPanelTerbuka(false)} />
      )}
    </div>
  );
}
