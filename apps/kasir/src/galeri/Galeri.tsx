import { useEffect, useMemo, useState } from 'react';
import 'ds/styles.css';
import '../kasir.css';
import './galeri.css';
import {
  DbLokalPalsuProvider,
  IsiSiap,
  pasangLokalPalsu,
  type KeadaanLokal,
} from '../konteks/DbLokalProvider.tsx';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { ShellKasir } from '../ShellKasir.tsx';
import { Kasir } from '../layar/Kasir.tsx';
import { Riwayat } from '../layar/Riwayat.tsx';
import { TutupKas } from '../layar/TutupKas.tsx';
import { Perangkat } from '../layar/Perangkat.tsx';
import { buatDbPalsu } from './db-palsu.ts';
import { SKENARIO, type NamaSkenario } from './skenario.ts';
import { buatPemberitahu } from '../../../../packages/sync-client/src/pemberitahu.ts';

/**
 * Galeri komponen — layar ASLI, tujuh keadaan, di luar bundel produksi.
 *
 * ## ⛔ Kenapa ini ada
 *
 * Sampai 31 Agustus 2026 tidak ada satu pun cara melihat layar kasir tanpa
 * infrastruktur penuh: PIN diverifikasi terhadap tabel `"user"` lokal, dan
 * tabel itu hanya terisi lewat PowerSync. Konsekuensinya bukan ketidaknyamanan
 * — ia adalah alasan cacat halaman-putih back-office lolos sampai ke tangan
 * merchant. Layar yang tidak dapat dibuka tidak dapat diperiksa.
 *
 * ## ⛔ Layar ASLI, bukan salinan
 *
 * Yang dirender di sini adalah `Kasir`, `Riwayat`, `TutupKas`, dan `Perangkat`
 * yang SAMA PERSIS dengan yang dipakai aplikasi — bukan tiruan yang dibuat
 * untuk galeri. Salinan akan menyimpang dari aslinya, dan galeri yang
 * menampilkan salinan sehat sementara aslinya rusak lebih buruk daripada tidak
 * ada galeri sama sekali.
 *
 * Yang dipalsukan HANYA databasenya, lewat `DbLokalPalsuProvider`.
 *
 * ## ⛔ Tidak masuk produksi
 *
 * `harness-galeri.html` bukan entry build — Vite hanya mem-build `index.html`.
 * Tidak satu byte pun dari berkas ini ada di bundel yang dikirim ke perangkat
 * merchant.
 */

/* ⛔ Instance tunggal dipasang SEKALI, dan ia MENDELEGASIKAN ke db skenario
   yang sedang aktif.

   `useSesi` memanggil `lokalSekarang()` alih-alih membaca konteks (`sesi_lokal`
   bukan raw table, jadi `watch()` tidak akan pernah melihatnya). Tanpa
   pemasangan ini galeri membuka database OPFS SUNGGUHAN — berbagi berkas
   dengan aplikasi kasir yang mungkin sedang terbuka di tab lain, keadaan yang
   prototipe 03 ukur gagal keras.

   Delegasi, bukan pemasangan ulang per skenario: pemasangan hanya boleh sekali
   (penjaganya melempar), sementara skenario berganti berkali-kali. Yang
   berubah adalah tujuannya, bukan pemasangannya — jadi skenario "error" tetap
   membuat pembacaan sesi menolak, sama seperti pembacaan lainnya. */
let dbSkenario: DbLokal | null = null;
const dbDelegasi: DbLokal = {
  getAll: (sql, params) => dbSkenario!.getAll(sql, params),
  execute: (sql, params) => dbSkenario!.execute(sql, params),
  transaction: (fn) => dbSkenario!.transaction(fn),
};
pasangLokalPalsu({
  db: dbDelegasi,
  ps: { watch: () => undefined } as never,
  keputusanMigrasi: { tindakan: 'tidak-ada' } as never,
  pemberitahu: buatPemberitahu(),
});

const LAYAR = [
  { id: 'K-03', nama: 'Kasir (grid + keranjang)', render: () => <Kasir /> },
  { id: 'K-08', nama: 'Riwayat', render: () => <Riwayat /> },
  { id: 'K-12', nama: 'Tutup kas', render: () => <TutupKas /> },
  { id: 'K-15', nama: 'Perangkat', render: () => <Perangkat /> },
] as const;

/**
 * Keadaan galeri hidup di URL: `?layar=K-03&keadaan=offline`.
 *
 * ⛔ Kenapa di URL, dan kenapa ini BERBEDA dari keputusan "rute di state" untuk
 * aplikasi kasir sungguhnya.
 *
 * Kasir tidak pernah mem-bookmark layar penjualan (`IA:§7`), jadi rutenya hidup
 * di state. Galeri punya satu pengguna dan satu tujuan: **menerima tautan ke
 * sel yang salah**. "Coba lihat K-03 keadaan offline" adalah deskripsi yang
 * harus diikuti; `?layar=K-03&keadaan=offline` adalah bukti yang dapat dibuka.
 * Tanpa ini, satu-satunya cara menunjuk sel adalah menyuruh orang mengklik dua
 * tombol dengan urutan yang benar.
 *
 * ⛔ Nilai yang TIDAK dikenal jatuh ke bawaan, tidak menghasilkan layar kosong.
 * URL diketik tangan dan disalin ke chat; salah ketik adalah keadaan normal,
 * dan galeri yang menjawabnya dengan halaman kosong tidak dapat dibedakan dari
 * galeri yang rusak.
 */
function bacaUrl(): { layarId: string; skenario: NamaSkenario } {
  const q = new URLSearchParams(window.location.search);
  const l = q.get('layar');
  const k = q.get('keadaan');
  return {
    layarId: LAYAR.some((x) => x.id === l) ? l! : LAYAR[0].id,
    skenario: SKENARIO.some((s) => s.nama === k) ? (k as NamaSkenario) : 'normal',
  };
}

/* `replaceState`, bukan `pushState`: memindai delapan keadaan berturut-turut
   akan menumpuk delapan entri riwayat, dan tombol Kembali browser lalu menjadi
   perjalanan mundur lewat keadaan alih-alih jalan keluar. */
function tulisUrl(layarId: string, skenario: NamaSkenario): void {
  const url = new URL(window.location.href);
  url.searchParams.set('layar', layarId);
  url.searchParams.set('keadaan', skenario);
  window.history.replaceState(null, '', url);
}

export function Galeri() {
  /* Dibaca SEKALI saat mount, bukan disinkronkan dua arah. Sinkronisasi dua
     arah menuntut `popstate` dan pengurutan yang benar antara URL dan state;
     galeri tidak membutuhkannya, dan yang tidak dibutuhkan tetap dapat rusak. */
  const awal = useMemo(() => bacaUrl(), []);
  const [layarId, setLayarId] = useState<string>(awal.layarId);
  const [skenario, setSkenario] = useState<NamaSkenario>(awal.skenario);

  useEffect(() => {
    tulisUrl(layarId, skenario);
  }, [layarId, skenario]);

  const layar = LAYAR.find((l) => l.id === layarId) ?? LAYAR[0];
  const info = SKENARIO.find((s) => s.nama === skenario) ?? SKENARIO[0];

  /* ⛔ Keadaan dibangun ULANG saat skenario berubah, dan `key` di bawah
     memaksa REMOUNT. Tanpa remount, layar yang sudah memuat data skenario
     sebelumnya akan menahannya di state React-nya sendiri, dan galeri
     menampilkan campuran dua skenario — persis jenis kebohongan yang galeri
     ini ada untuk mencegah. */
  const keadaan: KeadaanLokal = useMemo(() => {
    /* ⛔ Skenario "error" TIDAK dibuat lewat `tahap: 'galat'`, dan versi
       pertama saya membuatnya begitu — akibatnya SELURUH galeri menjadi
       halaman kosong: `useDbLokal` melempar, dan lemparan saat render
       membongkar pohon sampai ke akar. Bentuk yang sama persis dengan cacat
       back-office yang galeri ini lahir untuk mencegah, dibuat ulang oleh
       galerinya sendiri.

       `tahap: 'galat'` adalah kegagalan MEMBUKA database, dan yang
       merendernya `IsiSiap` — bukan layar. Yang skenario ini uji adalah
       kegagalan MEMBACA: database terbuka, query menolak. Itu yang menagih
       keadaan error milik tiap layar (aturan DS #7), dan itu yang benar-benar
       terjadi pada perangkat yang OPFS-nya penuh. */
    const db = buatDbPalsu(skenario);
    dbSkenario = db;
    return {
      tahap: 'siap',
      lokal: {
        /* ⛔ `ps` adalah STUB, bukan `null`.
           Asumsi pertama saya salah: `useAntrean` memanggil `ps.watch(...)`
           untuk mengawasi `outbox_local`, dan `null` membuat SELURUH galeri
           menjadi halaman kosong dengan satu `TypeError` di konsol — cacat
           yang bentuknya sama persis dengan yang galeri ini ada untuk
           menangkap. Ditemukan dengan membukanya di browser.

           `watch` mengembalikan tanpa memanggil `onResult`: sumber angka
           antrean di galeri adalah `getAll` dari db palsu, dan `watch` yang
           ikut memancarkan hasil akan menjadi sumber KEDUA yang menyimpang. */
        ps: {
          watch: () => undefined,
          connect: async () => undefined,
          disconnectAndClear: async () => undefined,
        } as never,
        db,
        keputusanMigrasi: { tindakan: 'tidak-ada' } as never,
        pemberitahu: buatPemberitahu(),
      },
    };
  }, [skenario]);

  return (
    <div className="galeri">
      <header className="galeri-bar">
        <span className="t-body-md">Galeri komponen</span>

        <div className="galeri-grup" role="group" aria-label="Layar">
          {LAYAR.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`btn ${l.id === layarId ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setLayarId(l.id)}
            >
              {l.id}
            </button>
          ))}
        </div>

        <div className="galeri-grup" role="group" aria-label="Keadaan">
          {SKENARIO.map((s) => (
            <button
              key={s.nama}
              type="button"
              className={`btn ${s.nama === skenario ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSkenario(s.nama)}
            >
              {s.judul}
            </button>
          ))}
        </div>
      </header>

      {/* Pertanyaan yang layar ini harus jawab. Galeri tanpa pertanyaan hanya
          memindahkan "kelihatannya oke" ke tempat lain. */}
      <p className="galeri-tanya t-caption">
        <strong>{layar.nama}</strong> · {info.tanya}
      </p>

      <div className="galeri-panggung">
        <DbLokalPalsuProvider keadaan={keadaan} key={`${layarId}-${skenario}`}>
          <ShellKasir
            outlet="ORIGEN Menteng"
            device="K1"
            perangkatTerdaftar
            pengguna="Kasir Galeri"
            ruteAktif={null}
          >
            {/* ⛔ `IsiSiap` ada di sini karena aplikasi sungguhan memakainya.
                Galeri yang merender layar TANPA pembungkus yang aplikasi
                pasang memeriksa pohon yang tidak pernah ada di perangkat
                merchant. */}
            <IsiSiap>{layar.render()}</IsiSiap>
          </ShellKasir>
        </DbLokalPalsuProvider>
      </div>
    </div>
  );
}
