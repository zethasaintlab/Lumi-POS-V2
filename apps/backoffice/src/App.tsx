import { useState } from 'react';
import { AppShell, EmptyState, Icon } from 'ds';
import 'ds/styles.css';
// SETELAH `ds/styles.css`. Ia memberi jangkar tinggi yang `base.css` design
// system tidak sediakan — lihat komentar di berkasnya.
import './backoffice.css';
import { NAVIGASI, LAYAR_SIAP, cariItem, grupUntuk } from './navigasi.ts';

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
 * `AppShell` sudah ada di `packages/ds` sejak F0 dan **tidak pernah dipakai
 * siapa pun**. Ini konsumen pertamanya.
 *
 * ## ⛔ `brand.logo` diberikan, dan itu bukan hiasan
 *
 * Cabang fallback `AppShell` (saat `logo` kosong) merender inisial di dalam
 * kotak ber-`style` inline dengan angka piksel yang dipanggang: `width: 28`,
 * `height: 28`, `borderRadius: 8`. Itu melanggar aturan design system #6
 * ("semua styling lewat token; tidak ada nilai warna/ukuran hardcoded di
 * komponen").
 *
 * `ds-bundle` dinyatakan **final dan tidak boleh diubah** (`CLAUDE.md`), dan
 * `lint:ds` memang tidak memindainya. Jadi yang dilakukan di sini bukan
 * memperbaiki komponennya, melainkan **tidak menyalakan cabang yang
 * melanggar**: `logo` selalu diberikan, dan isinya memakai token saja.
 *
 * Temuan audit selengkapnya ada di `apps/backoffice/AUDIT-APPSHELL.md`.
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

export default function App() {
  const [aktif, setAktif] = useState('B-01');
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
      // ⛔ Placeholder. Sesi back-office (B-00) belum dibangun, jadi tidak ada
      // pengguna sungguhan untuk ditampilkan — dan nama karangan yang
      // terlihat asli lebih buruk daripada menyatakan bahwa ia belum ada.
      user={{ name: 'Belum masuk', role: 'Sesi belum dibangun (B-00)' }}
    >
      {item && !LAYAR_SIAP.has(item.id) ? (
        <EmptyState
          icon={<Icon name={item.icon} size={32} />}
          title={`${item.label} belum dibangun`}
          body={`Layar ${item.id} ada di peta layar IA §3.3 dan belum punya isi. Menu ini sengaja tetap terlihat supaya peta layarnya utuh — menu yang disembunyikan sampai siap membuat "apa yang belum ada" mustahil dilihat.`}
        />
      ) : null}
    </AppShell>
  );
}
