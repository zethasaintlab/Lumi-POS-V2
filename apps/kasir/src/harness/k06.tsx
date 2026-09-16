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
import { PanelQris } from '../komponen/PanelQris.tsx';
import { setelKeranjang } from '../kasir/simpanan.ts';
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
  transaction: (fn) => dbAktif!.transaction(fn),
};
pasangLokalPalsu({
  db: delegasi,
  ps: { watch: () => undefined } as never,
  keputusanMigrasi: { tindakan: 'tidak-ada' } as never,
  pemberitahu: buatPemberitahu(),
});
dbAktif = buatDbPalsu('normal');

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

  /* ⛔ Pembungkus overlay DISALIN dari `Kasir.tsx:511-513`, kata demi kata, dan
     ia bukan hiasan.

     Sampai 16 September 2026 harness ini memasang `<Pembayaran>` TELANJANG ke
     `#k06`. Ia cukup untuk penjaga yang membaca teks dan keberadaan tombol —
     dan diam-diam salah untuk apa pun yang mengukur TATA LETAK: seluruh batas
     tinggi K-06 datang dari `.kasir-overlay-lebar` (`max-height: 100%` di
     dalam `.overlay` yang `position: fixed; inset: 0`). Tanpa pembungkus itu
     layarnya tumbuh setinggi isinya, tidak pernah menggulir, dan blok aksi
     yang menempel di aplikasi terukur BERGESER di sini.

     Terukur sebelum diperbaiki: blok aksi bergeser 177,0 px antara isi pendek
     dan isi panjang, dan `.kasir-bayar-isi` melaporkan `scrollHeight ===
     clientHeight` — penggulungnya tidak pernah menyala.

     Harness yang berbeda bentuk dari aplikasinya adalah salinan, dan penjaga
     yang menjaga salinan tidak menjaga apa pun. */
  return (
    <DbLokalPalsuProvider keadaan={keadaan}>
      <IsiSiap>
        <div className="overlay kasir-overlay-bayar" role="dialog" aria-modal="true" aria-label="Pembayaran">
          <div className="dialog kasir-overlay-lebar">
            <Pembayaran onKembali={() => undefined} />
          </div>
        </div>
      </IsiSiap>
    </DbLokalPalsuProvider>
  );
}

createRoot(document.querySelector('#k06') as HTMLElement).render(
  <StrictMode>
    <Akar />
  </StrictMode>
);
