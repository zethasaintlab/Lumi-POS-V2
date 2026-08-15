import { useState } from 'react';
import { AppShell, EmptyState, Icon } from 'ds';
import 'ds/styles.css';
// SETELAH `ds/styles.css`. Ia memberi jangkar tinggi yang `base.css` design
// system tidak sediakan — lihat komentar di berkasnya.
import './backoffice.css';
import { NAVIGASI, LAYAR_SIAP, cariItem, grupUntuk } from './navigasi.ts';
import { PenyediaSesi, useSesi } from './sesi.tsx';
import { Masuk } from './Masuk.tsx';
import { Daftar } from './daftar/Daftar.tsx';
import { Tombol } from './Tombol.tsx';
import { Langganan } from './langganan/Langganan.tsx';
import { Impor } from './impor/Impor.tsx';
import { PerangkatLayar } from './perangkat/Perangkat.tsx';
import { PenggunaLayar } from './pengguna/Pengguna.tsx';

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

  const item = cariItem(aktif);
  const grup = grupUntuk(aktif);

  return (
    <AppShell
      brand={{ name: 'Lumi POS', logo: <LogoLumi /> }}
      // `AppShell` mengetik `nav` sebagai array yang dapat diubah, sementara
      // `NAVIGASI` sengaja `readonly` — ia data tetap, dan komponen yang
      // menerimanya tidak berhak menyunting peta layar aplikasi. Disalin
      // dangkal di batas ini, bukan dilonggarkan tipenya di sumbernya.
      nav={NAVIGASI.map((g) => ({ ...g, items: [...g.items] }))}
      active={aktif}
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
        {aktif === 'B-29' ? <Langganan /> : null}
        {aktif === 'B-11' ? <Impor /> : null}
        {aktif === 'B-27' ? <PenggunaLayar /> : null}
        {aktif === 'B-28' ? <PerangkatLayar /> : null}

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
