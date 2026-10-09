import { StrictMode, useSyncExternalStore } from 'react';
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
import { PanelQris } from '../komponen/PanelQris.tsx';
import { keranjangSekarang, setelKeranjang } from '../kasir/simpanan.ts';
import { keranjangKosong, setelDataPesanan, type Keranjang } from '../kasir/keranjang.ts';
import type { StatusBayar } from '../kasir/qris-dinamis.ts';
import { jalurSekarang, langgananJalur, navigasi } from '../rute/navigasi.ts';

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
/* `?matikan=a,b` — kunci fitur yang dipaksa MATI (kill switch), supaya "tab
   Transfer HILANG" dapat diuji tanpa keadaan galeri baru. */
const matikan = (new URLSearchParams(window.location.search).get('matikan') ?? '')
  .split(',')
  .filter((k) => k !== '');
/* `?skenario=gambar-antrean` memunculkan pita antrean menua dan indikator
   `failed` — jalan keluar header yang dijaga kunci nav. Default tetap `normal`. */
const skenarioUji = (new URLSearchParams(window.location.search).get('skenario') ?? 'normal') as Parameters<typeof buatDbPalsu>[0];
/* `?pembulatan=500&modePembulatan=up` — outlet dengan pembulatan selain bawaan (100, half_up). */
const pembulatanMentah = new URLSearchParams(window.location.search).get('pembulatan');
const pembulatanUji = pembulatanMentah === null || pembulatanMentah === '' ? undefined : Number(pembulatanMentah);
const modeUji = new URLSearchParams(window.location.search).get('modePembulatan') as 'half_up' | 'up' | 'down' | null;
dbAktif = buatDbPalsu(skenarioUji, {
  matikanFitur: matikan,
  pembulatan: pembulatanUji,
  modePembulatan: modeUji ?? undefined,
  /* `?tarifKanal=1` (PBJT dine_in + PPN semua kanal) dan `?layanan=1` (outlet ber-service_charge_rate
     bukan nol) — penjaga G-KANAL/G-TANPA-LAYANAN di K-06/K-07. */
  tarifKanal: new URLSearchParams(window.location.search).get('tarifKanal') === '1',
  layanan: new URLSearchParams(window.location.search).get('layanan') === '1',
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
function keranjangUji(jumlahBaris: number, harga = 20000): Keranjang {
  if (jumlahBaris === 0) return keranjangKosong();
  return {
    ...keranjangKosong(),
    /* `?kanal=dine_in` — kanal keranjang yang dipasang (bawaan takeaway). */
    kanal: new URLSearchParams(window.location.search).get('kanal') === 'dine_in' ? 'dine_in' : 'takeaway',
    baris: Array.from({ length: jumlahBaris }, (_, i) => ({
      id: `uji-${i}`,
      variationId: `var-${i}`,
      itemName: `Item Uji ${i + 1}`,
      variationName: 'Regular',
      variationCount: 1,
      unitPrice: harga,
      quantityMilli: 1000,
      modifier: [],
    })),
  };
}

/* `?harga=85000` — harga satuan baris uji (bawaan 20.000), supaya total tidak bulat. */
setelKeranjang(keranjangUji(Number(q.get('baris') ?? '2'), Number(q.get('harga') ?? '20000')));
/* Jalur test: kanal keranjang MEMORI saat ini (penjaga S9 — kanal tidak bocor sesudah Transaksi Baru). */
(window as unknown as { __kanalKeranjang: () => string }).__kanalKeranjang = () => keranjangSekarang().kanal;

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

/* `?rute=1` — K-06 hidup di jalur `/bayar` dengan satu entri riwayat sebelumnya
   (`/kasir`), dan hanya terpasang selama `jalurSekarang() === '/bayar'`, persis
   seperti `App.tsx`. Tanpa ini tombol Kembali peramban tidak punya tempat
   mendarat dan tidak ada yang dapat meng-unmount layar. Default: tanpa rute. */
const pakaiRute = q.get('rute') === '1';
if (pakaiRute) {
  window.history.replaceState({}, '', '/kasir');
  window.history.pushState({}, '', '/bayar');
  /* Navigasi yang MENGABAIKAN kunci: mensimulasikan unmount yang bukan lewat tab
     nav (sesi habis, pemulihan), untuk menguji cleanup kunci. */
  (window as unknown as { __paksaKeluar: () => void }).__paksaKeluar = () => {
    window.history.pushState({}, '', '/kasir');
    window.dispatchEvent(new Event('lumi:navigasi'));
  };
  /* Kasir mengubah keranjang di K-03 selagi QRIS tertunda (fix round Task 9, C1a). */
  (window as unknown as { __ubahKeranjang: (n: number, harga?: number) => void }).__ubahKeranjang = (n, harga) =>
    setelKeranjang(keranjangUji(n, harga));
  /* Kasir mengubah Catatan di K-03 sesudah QR tampil (isi baris dan total tetap sama). */
  (window as unknown as { __ubahCatatan: (c: string | null) => void }).__ubahCatatan = (c) =>
    setelKeranjang(setelDataPesanan(keranjangSekarang(), { catatan: c }));
  /* Kebalikannya: K-06 dipasang lagi (pemulihan draf QRIS) tanpa membuka database baru. */
  (window as unknown as { __paksaMasuk: () => void }).__paksaMasuk = () => {
    window.history.pushState({}, '', '/bayar');
    window.dispatchEvent(new Event('lumi:navigasi'));
  };
}

function Akar() {
  const render = q.get('render') ?? 'k06';
  const jalur = useSyncExternalStore(langgananJalur, jalurSekarang, () => '/');

  if (render === 'panel') {
    const status = (q.get('status') ?? 'pending') as StatusBayar;
    // `batas` 0 membuat habis-waktu terjadi pada putaran pertama — tanpa
    // menunggu lima menit nyata, dan tanpa timer palsu apa pun.
    const habisWaktu = q.get('habis') === '1';
    return (
      <PanelQris
        kirim={kirimPalsu(status) as never}
        qrString={q.get('qr') ?? '00020101021226590014ID.CO.QRIS.WWW0118UJI0303UMI'}
        paymentId="pay-uji"
        orderId="ord-uji"
        nominal={123456n}
        jeda={50}
        batas={habisWaktu ? 0 : Number(q.get('batas') ?? '60000')}
        /* `?jam=1` — jam suntikan: test menggeser `window.__jam` (ms), bukan menunggu. */
        sekarang={q.get('jam') === '1' ? () => (window as unknown as { __jam?: number }).__jam ?? Date.now() : undefined}
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

  /* ⛔ K-06 adalah HALAMAN di dalam `ShellKasir` (Task 8, spec § 7), dan
     harness memasangnya DI DALAM shell sungguhan: seluruh batas tinggi kartu
     datang dari `.kasir-konten` + `.kasir-bayar-halaman`, jadi mengukur blok
     aksi (P8) tanpa shell mengukur salinan. Header-nya juga yang dipakai P1
     untuk membuktikan tab nav terkunci. K-07 membawa overlay-nya sendiri
     (`Pembayaran.tsx`), persis seperti di aplikasi.

     Harness yang berbeda bentuk dari aplikasinya adalah salinan, dan penjaga
     yang menjaga salinan tidak menjaga apa pun. */
  return (
    <DbLokalPalsuProvider keadaan={keadaan}>
      <IsiSiap>
        <ShellKasir outlet="Outlet uji" device="K1" perangkatTerdaftar pengguna="Kasir uji" ruteAktif={null}>
          {pakaiRute && jalur !== '/bayar' ? (
            <p id="layar-lain">Layar lain: {jalur}</p>
          ) : (
            <Pembayaran onKembali={() => (pakaiRute ? navigasi('/kasir') : undefined)} />
          )}
        </ShellKasir>
      </IsiSiap>
    </DbLokalPalsuProvider>
  );
}

createRoot(document.querySelector('#k06') as HTMLElement).render(
  <StrictMode>
    <Akar />
  </StrictMode>
);
