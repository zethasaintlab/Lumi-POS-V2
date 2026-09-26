import { useMemo } from 'react';

/**
 * Layar `Fondasi desain` — halaman FONDASI galeri, bukan layar produk.
 *
 * ## ⛔ Kenapa ini ada
 *
 * Kampanye "Hidupkan desain" (`docs/RENCANA-HIDUPKAN-DESAIN.md`) memindahkan
 * palet, tipografi, bentuk, ikon, dan wordmark ke nilai mockup lewat token —
 * bukan lewat menulis ulang setiap komponen satu per satu. Tanpa satu tempat
 * yang menampilkan token itu SENDIRIAN, memverifikasi "apakah token yang
 * BENAR yang sampai ke peramban" berarti membuka lima layar produk dan
 * menebak dari komposisinya. Halaman ini menjawab pertanyaan token secara
 * langsung: nama, nilai, dan rupanya — dipisah dari komposisi layar mana pun.
 *
 * Task 2 mengisi HANYA bagian `warna`. Kelima bagian lain adalah kerangka
 * kosong bertanda `data-fondasi`, diisi Task 3–9 di kampanye yang sama:
 * `teks` (skala 32/20/15/13), `bentuk` (radius/bayangan/spasi/target sentuh),
 * `ikon` (Lucide), `wordmark` ("LumiPOS"), `komponen` (kulit komponen § 9,
 * setiap keadaan: normal, hover, nonaktif, galat).
 *
 * ⛔ Di luar bundel produksi, sama seperti seluruh `apps/kasir/src/galeri/`.
 * Tidak satu byte pun dari berkas ini ada di build `index.html` yang dikirim
 * ke perangkat merchant — lihat `Galeri.tsx` § kenapa galeri ada.
 *
 * ## ⛔ Nilai DIBACA, tidak diketik
 *
 * Setiap swatch menampilkan `getComputedStyle(document.documentElement)`
 * pada saat render — bukan salinan tangan dari `tokens-mockup.css`. Salinan
 * tangan akan tetap benar di layar ini sekalipun pengarahan `lumi.css` rusak
 * atau urutan impor terbalik; itu tepat cacat yang `tests/kasir-dom/
 * palet-berlaku.test.js` ada untuk menangkap, dan halaman ini tidak boleh
 * menjadi tempat kedua yang menyembunyikannya.
 */

/**
 * Token warna `tokens-mockup.css`, dikelompokkan PERSIS mengikuti komentar
 * grup di berkas sumbernya — supaya urutan dan pengelompokan di sini tidak
 * pernah punya pendapat sendiri tentang taksonomi token.
 */
const GRUP_WARNA: ReadonlyArray<{ judul: string; token: readonly string[] }> = [
  {
    judul: 'Inti',
    token: [
      '--background',
      '--foreground',
      '--card',
      '--card-foreground',
      '--primary',
      '--primary-foreground',
      '--secondary',
      '--secondary-foreground',
      '--muted',
      '--muted-foreground',
      '--accent',
      '--accent-foreground',
      '--border',
      '--ring',
    ],
  },
  { judul: 'Turunan aksen', token: ['--accent-hover', '--accent-subtle', '--surface-raised'] },
  {
    judul: 'Status',
    token: [
      '--status-success-bg',
      '--status-success-text',
      '--status-info-bg',
      '--status-info-text',
      '--status-pending-bg',
      '--status-pending-text',
      '--status-warning-bg',
      '--status-warning-text',
      '--status-danger-bg',
      '--status-danger-text',
    ],
  },
  {
    judul: 'Kontrol & formulir',
    token: [
      '--input-border',
      '--destructive',
      '--destructive-hover',
      '--ghost-foreground',
      '--ghost-hover-bg',
      '--secondary-hover',
      '--chip-hover-bg',
      '--option-border',
      '--keypad-border',
      '--pin-inactive-bg',
    ],
  },
  {
    judul: 'Teks & ikon sekunder',
    token: [
      '--muted-foreground-strong',
      '--muted-foreground-strong-alt',
      '--sidebar-label',
      '--icon-muted',
      '--icon-muted-alt',
      '--icon-muted-alt-2',
    ],
  },
  {
    judul: 'Gambar & dropzone',
    token: ['--dashed-border', '--dashed-border-strong', '--dashed-bg', '--dropzone-border', '--skeleton-bg'],
  },
  {
    judul: 'Mode offline',
    token: [
      '--offline-badge-bg',
      '--offline-badge-text',
      '--offline-banner-bg',
      '--offline-banner-border',
      '--offline-banner-text',
    ],
  },
  {
    judul: 'Permukaan & pembatas lain',
    token: [
      '--card-outline',
      '--card-outline-hover',
      '--menu-hover-border',
      '--row-divider',
      '--cart-divider',
      '--panel-subtle-bg',
      '--avatar-bg',
      '--chart-baseline',
      '--progress-track',
      '--step-inactive-bg',
      '--step-inactive-text',
      '--guest-background',
      '--guest-border',
      '--guest-card',
      '--switcher-bg',
    ],
  },
];

/** Bagian yang belum diisi Task 2 — kerangka bertanda, diisi Task 3–9. */
const BAGIAN_BELUM_DIISI = [
  { id: 'teks', judul: 'Skala teks' },
  { id: 'bentuk', judul: 'Bentuk' },
  { id: 'ikon', judul: 'Ikon' },
  { id: 'wordmark', judul: 'Wordmark' },
  { id: 'komponen', judul: 'Komponen' },
] as const;

function Swatch({ nama, nilai }: { nama: string; nilai: string }) {
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '11rem' }}>
      {/* `.card` bundle sudah menyetel border + radius lewat token — dipakai
          ulang di sini alih-alih menulis `border: 1px solid …` sendiri
          (`lint:ds` menolak nilai px mentah di komponen). Hanya `background`
          yang ditimpa lewat inline style, ke warna swatch-nya sendiri. */}
      <div className="card" style={{ height: 'var(--space-8)', background: `var(${nama})` }} aria-hidden="true" />
      <span className="t-caption" style={{ wordBreak: 'break-all' }}>
        {nama}
      </span>
      <span className="t-caption" style={{ color: 'var(--ink)' }}>
        {nilai || '(kosong)'}
      </span>
    </div>
  );
}

export function Fondasi() {
  /* Dibaca SAAT RENDER, bukan diketik — lihat komentar berkas. `document`
     selalu ada di sini: halaman ini hanya pernah dirender di browser
     (galeri), tidak pernah lewat SSR. */
  const nilai = useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    const peta: Record<string, string> = {};
    for (const grup of GRUP_WARNA) {
      for (const nama of grup.token) peta[nama] = s.getPropertyValue(nama).trim();
    }
    return peta;
  }, []);

  return (
    <div
      className="fondasi"
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 'var(--space-4)',
        background: 'var(--surface-sunk)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
      }}
    >
      <header>
        <h1 className="t-title">Fondasi desain</h1>
        <p className="t-caption">
          Token efektif — nilai dibaca dari halaman ({`getComputedStyle(document.documentElement)`}), bukan
          diketik ulang dari <code>tokens-mockup.css</code>.
        </p>
      </header>

      <section data-fondasi="warna" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h2 className="t-body-md">Warna</h2>
        {GRUP_WARNA.map((grup) => (
          <div key={grup.judul} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <h3 className="t-caption" style={{ margin: 0 }}>
              {grup.judul}
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              {grup.token.map((nama) => (
                <Swatch key={nama} nama={nama} nilai={nilai[nama]} />
              ))}
            </div>
          </div>
        ))}
      </section>

      {BAGIAN_BELUM_DIISI.map((bagian) => (
        <section key={bagian.id} data-fondasi={bagian.id}>
          <h2 className="t-body-md">{bagian.judul}</h2>
          <p className="t-caption">Belum diisi — Task berikutnya di kampanye "Hidupkan desain".</p>
        </section>
      ))}
    </div>
  );
}
