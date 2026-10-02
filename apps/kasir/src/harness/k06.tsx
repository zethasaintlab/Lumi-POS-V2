import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'ds/styles.css';
import '../kasir.css';
import {
  DbLokalPalsuProvider,
  IsiSiap,
  pasangLokalPalsu,
  type KeadaanLokal,
} from '../konteks/DbLokalProvider.tsx';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { buatPemberitahu } from '../../../../packages/sync-client/src/pemberitahu.ts';
import { buatDbPalsu } from '../galeri/db-palsu.ts';
import { Pembayaran } from '../layar/Pembayaran.tsx';
import { ShellKasir } from '../ShellKasir.tsx';
import { TABEL_RUTE } from '../rute/tabel.ts';
import { PanelQris } from '../komponen/PanelQris.tsx';
import { setelKeranjang } from '../kasir/simpanan.ts';
import { kunciNavSekarang } from '../rute/kunci-nav.ts';
import { keranjangKosong, type Keranjang } from '../kasir/keranjang.ts';
import type { StatusBayar } from '../kasir/qris-dinamis.ts';

/**
 * Harness DOM untuk K-06 Pembayaran dan panel QRIS — HANYA untuk test.
 *
 * ## ⛔ Kenapa ia ada, dan kenapa ia BUKAN galeri
 *
 * Audit 16 September 2026: NOL test merender `Pembayaran.tsx` maupun
 * `PanelQris.tsx`. Seluruh test pembayaran menguji FUNGSI — `rencanakanPembayaran`,
 * `sisaTagihan`, `cekStatus`, `simpanPenjualan`. Konsekuensinya bukan celah
 * kecil: tata letak layar yang memindahkan uang dapat dirusak sepenuhnya tanpa
 * satu pun test merah.
 *
 * Galeri tidak dapat menggantikan halaman ini pada dua hal:
 *
 *   1. Ia merender LAYAR utuh, sementara `PanelQris` menerima `kirim` sebagai
 *      prop — dan keadaan `gagal`, `kedaluwarsa`, serta habis-waktu hanya dapat
 *      dicapai dengan mengendalikan jawaban `kirim` itu.
 *   2. `dist-galeri/` adalah pratinjau yang user tinjau dari HP. Menambah sel
 *      K-06 ke sana mengubah apa yang ia lihat; halaman ini tidak.
 *
 * ## ⛔ Layar ASLI, bukan salinan
 *
 * Yang dirender `Pembayaran` dan `PanelQris` yang SAMA PERSIS dengan yang
 * dipakai aplikasi. Yang dipalsukan hanya databasenya (`db-palsu.ts`, milik
 * galeri) dan — untuk panel — pengirim API-nya. Salinan akan menyimpang dari
 * aslinya, dan penjaga yang menjaga salinan tidak menjaga apa pun.
 *
 * ## ⛔ Di luar bundel produksi
 *
 * `vite.config.ts` hanya mem-build `index.html`; halaman ini punya config
 * sendiri (`vite.k06.config.ts`) dan direktori keluaran sendiri. Pemisahan yang
 * sama dengan galeri, dan alasannya sama: `db-palsu.ts` berisi katalog dan
 * shift karangan.
 */

/* Pemasangan tunggal, sama bentuknya dengan galeri: `useSesi` memanggil
   `lokalSekarang()` alih-alih membaca konteks, jadi tanpa ini harness membuka
   database OPFS SUNGGUHAN. */
let dbAktif: DbLokal | null = null;
const delegasi: DbLokal = {
  getAll: (sql, params) => dbAktif!.getAll(sql, params),
  execute: (sql, params) => dbAktif!.execute(sql, params),
  /* `window.__tahanTransaksi` (`{ promise }`) menahan SETIAP transaksi sampai
     test melepasnya — dipakai penjaga "tab nav terkunci selama penjualan
     disimpan" untuk membuat jendela menyimpan terlihat tanpa berpacu timer. */
  transaction: async (fn) => {
    const tahan = (window as unknown as { __tahanTransaksi?: { promise: Promise<void>; masuk?: number } }).__tahanTransaksi;
    if (tahan) {
      // `masuk` = berapa transaksi yang sudah tiba di gerbang; test menunggunya
      // alih-alih menebak waktu (`k06-penjaga`: onSelesai ganda).
      tahan.masuk = (tahan.masuk ?? 0) + 1;
      await tahan.promise;
    }
    return dbAktif!.transaction(fn);
  },
};
pasangLokalPalsu({
  db: delegasi,
  ps: { watch: () => undefined } as never,
  keputusanMigrasi: { tindakan: 'tidak-ada' } as never,
  pemberitahu: buatPemberitahu(),
});
/* `?matikan=a,b` — kunci fitur yang dipaksa mati (kill switch), pola yang sama
   dengan `?matikanFitur=` galeri (`OpsiDbPalsu.matikanFitur`). */
dbAktif = buatDbPalsu('normal', {
  matikanFitur: (new URLSearchParams(window.location.search).get('matikan') ?? '').split(',').filter(Boolean),
});

const q = new URLSearchParams(window.location.search);

/**
 * Keranjang yang dipasang sebelum mount.
 *
 * ⛔ `simpanan.ts` adalah MEMORI, bukan database — `Pembayaran` membacanya
 * lewat `keranjangSekarang()`, bukan lewat `keranjang_lokal`. Mengisi tabel
 * saja menghasilkan layar "Keranjang kosong" dan penjaga yang hijau karena
 * tidak melihat apa pun.
 */
function keranjangUji(jumlahBaris: number): Keranjang {
  if (jumlahBaris === 0) return keranjangKosong();
  return {
    ...keranjangKosong(),
    baris: Array.from({ length: jumlahBaris }, (_, i) => ({
      id: `uji-${i}`,
      variationId: `var-${i}`,
      itemName: `Item Uji ${i + 1}`,
      variationName: 'Regular',
      variationCount: 1,
      unitPrice: 20000,
      quantityMilli: 1000,
      modifier: [],
    })),
  };
}

setelKeranjang(keranjangUji(Number(q.get('baris') ?? '2')));

/**
 * `kirim` palsu untuk `PanelQris`.
 *
 * Statusnya dipaku dari URL supaya keempat keadaan dapat dicapai tanpa gateway
 * dan tanpa menunggu waktu nyata. `pending` yang tidak pernah berubah adalah
 * keadaan yang dipakai menguji habis-waktu, lewat `batas` yang sangat kecil.
 */
function kirimPalsu(status: StatusBayar) {
  return async (jalur: string) => {
    if (jalur.includes('/abandon')) return { status: 200, body: { ok: true } };
    return { status: 200, body: { status: keServer(status) } };
  };
}

function keServer(s: StatusBayar): string {
  if (s === 'confirmed') return 'confirmed';
  if (s === 'gagal') return 'failed';
  if (s === 'kedaluwarsa') return 'expired';
  return 'pending_confirmation';
}

function Akar() {
  const render = q.get('render') ?? 'k06';

  if (render === 'panel') {
    const status = (q.get('status') ?? 'pending') as StatusBayar;
    // `batas` 0 membuat habis-waktu terjadi pada putaran pertama — tanpa
    // menunggu lima menit nyata, dan tanpa timer palsu apa pun.
    const habisWaktu = q.get('habis') === '1';
    return (
      <PanelQris
        kirim={kirimPalsu(status) as never}
        qrString="00020101021226590014ID.CO.QRIS.WWW0118UJI0303UMI"
        paymentId="pay-uji"
        orderId="ord-uji"
        nominal={123456n}
        jeda={50}
        batas={habisWaktu ? 0 : 60_000}
        onSelesai={(h) => {
          // Hasil ditulis ke DOM, bukan ke konsol: penjaga membacanya dari
          // halaman, dan konsol tidak bertahan melewati navigasi.
          const el = document.querySelector('#hasil-panel');
          if (el) el.textContent = h.status;
        }}
      />
    );
  }

  /* Bentuk `keadaan` disalin dari galeri, termasuk `ps` sebagai STUB.
     `null` di sana membuat seluruh pohon menjadi halaman kosong dengan satu
     `TypeError` — cacat yang bentuknya sama persis dengan yang penjaga ini ada
     untuk menangkap. */
  const keadaan = {
    tahap: 'siap',
    lokal: {
      ps: {
        watch: () => undefined,
        connect: async () => undefined,
        disconnectAndClear: async () => undefined,
      },
      db: delegasi,
      keputusanMigrasi: { tindakan: 'tidak-ada' },
      pemberitahu: buatPemberitahu(),
    },
  } as unknown as KeadaanLokal;

  /* Pembungkus = `ShellKasir` ASLI (spec § 7): K-06 halaman di `kasir-konten`,
     bukan overlay; harness yang berbeda bentuk dari aplikasi hanya salinan. */
  return (
    <DbLokalPalsuProvider keadaan={keadaan}>
      <ShellKasir
        outlet="Outlet Uji"
        device="K1"
        pengguna="Kasir Uji"
        perangkatTerdaftar
        ruteAktif={TABEL_RUTE.find((r) => r.layar === 'K-03') ?? null}
      >
        <IsiSiap>
          <Pembayaran onKembali={() => undefined} />
        </IsiSiap>
      </ShellKasir>
    </DbLokalPalsuProvider>
  );
}

const akar = createRoot(document.querySelector('#k06') as HTMLElement);
akar.render(
  <StrictMode>
    <Akar />
  </StrictMode>
);

/* Kait uji: kunci nav modul-global dan pembongkaran layar di tengah operasi
   (`k06-penjaga`: kunci tidak boleh tertinggal sesudah K-06 dilepas). */
Object.assign(window, { __kunciNav: kunciNavSekarang, __bongkarK06: () => akar.unmount() });
