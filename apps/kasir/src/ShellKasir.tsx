import { Avatar, Icon, SyncIndicator, Tabs, type IconName } from 'ds';
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

/**
 * Id elemen slot aksi di bilah nav.
 *
 * ⛔ Diekspor, bukan ditulis ulang di layar. Dua string yang tidak ada apa pun
 * menyatukannya akan menyimpang, dan yang menyimpang menghasilkan portal yang
 * tidak menemukan sasarannya — tombolnya hilang dari layar tanpa satu pun
 * error, bentuk cacat "nol baris, bukan error" yang sama.
 */
export const SLOT_AKSI = 'kasir-slot-aksi';

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
        {/* ⛔ Bentuk merek DISALIN dari `AppShell` bundle — kotak aksen 28px
            berisi huruf pertama, lalu wordmark. Menuliskan bentuk merek kedua
            untuk aplikasi kedua menghasilkan dua Lumi POS yang terlihat berbeda
            di dua layar milik merchant yang sama.

            Logo, nama "Lumi POS", dan aksen teal tidak disentuh; yang dilakukan
            di sini hanya MENAMPILKANNYA. */}
        <span className="kasir-merek" aria-hidden="true">
          L
        </span>
        <span className="t-body-md kasir-wordmark">Lumi POS</span>

        {/* ⛔ Identitas outlet dan perangkat TIDAK dibuang demi kerapian, dan ia
            SATU BARIS — bukan baris kedua di bawah wordmark.

            Tinggi topbar tidak ditentukan teksnya melainkan `min-height:
            var(--touch-min)` pada pembungkus indikator sinkron, jadi bentuk
            bertingkat tidak membeli apa pun yang dapat diukur dan hanya
            menambah ruang kosong yang diambil dari grid.

            Kasir yang tidak dapat membaca perangkatnya tidak dapat menjelaskan
            nomor struknya: prefiks device (`K1-20260726-0007`) adalah
            satu-satunya cara mencocokkan struk dengan perangkat yang
            mencetaknya. */}
        <span className="t-caption kasir-wordmark-sub truncate">
          {outlet} · {device}
        </span>

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

        {/* ⛔ Identitas staf: avatar inisial PLUS nama, bukan avatar saja.
            Inisial dua huruf tidak membedakan dua kasir yang namanya berawal
            sama, dan yang salah dikira sedang login adalah orang yang namanya
            menempel pada setiap penjualan shift itu. `<Avatar>` bundle dipakai
            apa adanya — ia tidak menyentuh angka uang. */}
        <span className="kasir-staf">
          <Avatar name={pengguna} size={32} />
          <span className="t-caption truncate">{pengguna}</span>
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
      {/* ⛔ Bilah nav dan slot aksi berbagi SATU baris, bukan dua.

          Baris aksi tersendiri selebar layar sudah dicoba dan DIUKUR: 57px, dan
          grid turun dari 12 kartu terlihat menjadi 8 — menembus `IA:62`. Tinggi
          tombol dikunci `--touch-min` 44px, jadi tidak ada bentuk baris
          melintang yang muat; memangkas gap panel maupun gap grid tidak membeli
          apa pun karena barisnya ragged dan defisitnya (39px) harus datang
          utuh. Bilah ini punya ruang kosong di kanannya, dan ruang itu gratis.

          ⛔ Slotnya DISEDIAKAN shell, DIISI layar lewat portal. `Kasir.tsx`
          adalah anak shell dan tidak dapat mengoper prop ke atas; memindahkan
          aksinya ke sini akan memindahkan shift, konfig, dan sesi ke shell
          juga — dan shell dipakai enam layar yang tidak memerlukannya. */}
      <div className="kasir-bilah">
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
        <div id={SLOT_AKSI} className="kasir-slot-aksi" />
      </div>

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
