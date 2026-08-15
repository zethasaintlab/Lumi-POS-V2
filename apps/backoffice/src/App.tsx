import { useState } from 'react';
import { AppShell, EmptyState, Icon } from 'ds';
import 'ds/styles.css';
// SETELAH `ds/styles.css`. Ia memberi jangkar tinggi yang `base.css` design
// system tidak sediakan — lihat komentar di berkasnya.
import './backoffice.css';
import {
  LAYAR_SIAP,
  BERANDA_AKUNTAN,
  cariItem,
  grupUntuk,
  hanyaAkuntan,
  navigasiUntuk,
} from './navigasi.ts';
import { PenyediaSesi, useSesi } from './sesi.tsx';
import { Masuk } from './Masuk.tsx';
import { Daftar } from './daftar/Daftar.tsx';
import { Tombol } from './Tombol.tsx';
import { Langganan } from './langganan/Langganan.tsx';
import { Impor } from './impor/Impor.tsx';
import { PerangkatLayar } from './perangkat/Perangkat.tsx';
import { PenggunaLayar } from './pengguna/Pengguna.tsx';
import { OutletLayar } from './outlet/Outlet.tsx';
import { PajakLayar } from './pajak/Pajak.tsx';
import { PenjualanLayar } from './laporan/Penjualan.tsx';
import { ProdukLaporanLayar } from './laporan/Produk.tsx';
import { KasirLaporanLayar } from './laporan/Kasir.tsx';
import { PembayaranLayar } from './laporan/Pembayaran.tsx';
import { EksporLayar } from './laporan/Ekspor.tsx';
import { ProdukLayar } from './katalog/Produk.tsx';
import { KategoriLayar } from './katalog/Kategori.tsx';
import { HargaLayar } from './katalog/Harga.tsx';
import { ModifierLayar } from './katalog/Modifier.tsx';

/**
 * Kerangka back-office. Nol layar fitur — sama seperti `PLAN-pondasi-kasir`
 * memulai `apps/kasir`.
 *
 * ## Kenapa `AppShell`, bukan `ShellKasir`
 *
 * `IA:§2.1` menetapkan "Kasir tidak punya sidebar", dan itu yang melahirkan
 * `ShellKasir`. Back-office adalah kebalikannya: `IA:§3.1` menyebut `AppShell`
 * dengan nama — sidebar berkelompok + topbar breadcrumb + konten.
 *
 * ## ⛔ `brand.logo` diberikan, dan itu bukan hiasan
 *
 * Cabang fallback `AppShell` (saat `logo` kosong) merender inisial di dalam
 * kotak ber-`style` inline dengan angka piksel yang dipanggang: `width: 28`,
 * `height: 28`, `borderRadius: 8`. Itu melanggar aturan design system #6.
 *
 * `ds-bundle` dinyatakan **final dan tidak boleh diubah** (`CLAUDE.md`), jadi
 * yang dilakukan bukan memperbaiki komponennya melainkan **tidak menyalakan
 * cabang yang melanggar**. Temuan selengkapnya di `AUDIT-APPSHELL.md`.
 */

function LogoLumi() {
  // Hanya token. `--space-8` (32px), bukan 28px seperti fallback bawaan —
  // 28 bukan anak tangga skala spasi mana pun, dan skala itu berbasis 4px.
  return (
    <span
      style={{
        width: 'var(--space-8)',
        height: 'var(--space-8)',
        borderRadius: 'var(--radius-control)',
        background: 'var(--accent)',
        color: 'var(--on-accent)',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 'var(--weight-bold)',
        flex: 'none',
      }}
    >
      L
    </span>
  );
}

/**
 * Penjaga rute.
 *
 * Ia menjaga bahwa aplikasi tidak menampilkan shell tanpa sesi — dan sejak
 * `apps/server/src/sesi.ts` ada, **server menegakkan hal yang sama secara
 * mandiri**: melewati layar ini di devtools tidak memberi akses ke apa pun,
 * karena setiap permintaan ke permukaan back-office ditolak 401 tanpa token
 * sesi yang sah.
 *
 * Jadi penjaga ini adalah kenyamanan (jangan tampilkan layar yang setiap
 * permintaannya akan gagal), bukan satu-satunya yang berdiri di sana.
 */
/**
 * Pintu publik — dua layar yang berdiri sebelum ada sesi.
 *
 * ⛔ Tanpa URL, dan itu mengikuti pola aplikasi ini. Back-office memilih layar
 * lewat keadaan (`aktif` di bawah), bukan lewat alamat; `apps/kasir` yang
 * punya router buatan sendiri. Menambahkan router di sini untuk dua layar
 * berarti dua cara berpindah layar di satu aplikasi.
 *
 * Harganya nyata dan dicatat: halaman pendaftaran tidak dapat ditautkan
 * langsung. Merchant mencapainya lewat tombol di layar masuk.
 */
function PintuPublik() {
  const [layar, setLayar] = useState<'masuk' | 'daftar'>('masuk');
  const [kabar, setKabar] = useState<string | null>(null);

  if (layar === 'daftar') {
    return (
      <Daftar
        onSelesai={(pesan) => {
          setKabar(pesan);
          setLayar('masuk');
        }}
        onBatal={() => setLayar('masuk')}
      />
    );
  }

  return (
    <Masuk
      kabar={kabar}
      onDaftar={() => {
        // Kabar pendaftaran dibersihkan saat merchant kembali mendaftar —
        // "usaha X terdaftar" di atas form pendaftaran KEDUA terbaca seperti
        // konfirmasi atas sesuatu yang belum terjadi.
        setKabar(null);
        setLayar('daftar');
      }}
    />
  );
}

function Terlindungi() {
  const { sesi, keluar } = useSesi();
  const [aktif, setAktif] = useState('B-01');

  if (!sesi) return <PintuPublik />;

  // ⛔ Penyempitan menu adalah penjaga UX, BUKAN batas keamanan. Yang menahan
  // Akuntan mengubah apa pun adalah `rbac-rute.ts` di server.
  const navigasi = navigasiUntuk(sesi.roles);

  // ⛔ Layar aktif DITURUNKAN, bukan disetel sekali saat mount.
  //
  // Versi pertama memakai inisialisasi lazy `useState` untuk memilih beranda
  // akuntan — dan itu berjalan pada render PERTAMA `Terlindungi`, saat `sesi`
  // masih `null`. Hasilnya selalu `B-01`, dan akuntan mendarat di "Dashboard
  // belum dibangun" sebagai layar pertamanya. Ditemukan di browser, bukan di
  // test: nilainya benar untuk setiap peran lain.
  //
  // Menurunkannya juga menutup kasus kedua: akuntan yang layar aktifnya
  // menjadi tersembunyi (mis. setelah perannya berubah) tidak tertinggal di
  // layar yang menunya sudah tidak memuatnya.
  const terlihat = new Set(navigasi.flatMap((g) => g.items.map((i) => i.id)));
  const layar = terlihat.has(aktif)
    ? aktif
    : hanyaAkuntan(sesi.roles)
      ? BERANDA_AKUNTAN
      : (navigasi[0]?.items[0]?.id ?? 'B-01');

  const item = cariItem(layar);
  const grup = grupUntuk(layar);

  return (
    <AppShell
      brand={{ name: 'Lumi POS', logo: <LogoLumi /> }}
      // `AppShell` mengetik `nav` sebagai array yang dapat diubah, sementara
      // `NAVIGASI` sengaja `readonly` — ia data tetap, dan komponen yang
      // menerimanya tidak berhak menyunting peta layar aplikasi. Disalin
      // dangkal di batas ini, bukan dilonggarkan tipenya di sumbernya.
      nav={navigasi}
      active={layar}
      onNavigate={setAktif}
      breadcrumb={grup && item ? [grup, item.label] : undefined}
      user={{
        name: sesi.userId,
        // ⛔ Peran ditampilkan APA ADANYA dari server, bukan diterjemahkan di
        // sini. Terjemahan di klien adalah salinan kedua dari daftar peran,
        // dan ia akan menyimpang dari `packages/domain/src/rbac.ts`.
        role: sesi.roles.join(', ') || 'tanpa peran',
      }}
    >
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        {layar === 'B-29' ? <Langganan /> : null}
        {layar === 'B-06' ? <ProdukLayar /> : null}
        {layar === 'B-08' ? <KategoriLayar /> : null}
        {layar === 'B-09' ? <ModifierLayar /> : null}
        {layar === 'B-10' ? <HargaLayar /> : null}
        {layar === 'B-11' ? <Impor /> : null}
        {layar === 'B-16' ? <PenjualanLayar /> : null}
        {layar === 'B-17' ? <ProdukLaporanLayar /> : null}
        {layar === 'B-18' ? <KasirLaporanLayar /> : null}
        {layar === 'B-19' ? <PembayaranLayar /> : null}
        {layar === 'B-20' ? <EksporLayar /> : null}
        {layar === 'B-23' ? <OutletLayar /> : null}
        {layar === 'B-25' ? <PajakLayar /> : null}
        {layar === 'B-27' ? <PenggunaLayar /> : null}
        {layar === 'B-28' ? <PerangkatLayar /> : null}

        {item && !LAYAR_SIAP.has(item.id) ? (
          <EmptyState
            icon={<Icon name={item.icon} size={32} />}
            title={`${item.label} belum dibangun`}
            body={`Layar ${item.id} ada di peta layar IA §3.3 dan belum punya isi. Menu ini sengaja tetap terlihat supaya peta layarnya utuh — menu yang disembunyikan sampai siap membuat "apa yang belum ada" mustahil dilihat.`}
            action={<Tombol onClick={() => void keluar()}>Keluar</Tombol>}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

export default function App() {
  return (
    <PenyediaSesi>
      <Terlindungi />
    </PenyediaSesi>
  );
}
