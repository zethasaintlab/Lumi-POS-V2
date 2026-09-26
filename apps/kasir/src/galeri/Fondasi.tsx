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
 * Task 2 mengisi bagian `warna`. Task 3 mengisi `teks`. Keempat bagian lain
 * adalah kerangka kosong bertanda `data-fondasi`, diisi Task 4–9 di kampanye
 * yang sama: `bentuk` (radius/bayangan/spasi/target sentuh), `ikon` (Lucide),
 * `wordmark` ("LumiPOS"), `komponen` (kulit komponen § 9, setiap keadaan:
 * normal, hover, nonaktif, galat).
 *
 * ⛔ Bagian `teks` (Task 3) menampilkan UKURAN dan BOBOT hari ini — bukan
 * skala 32/20/15/13 dari Global Constraints. Task 3 hanya mengganti font
 * (Inter → Nunito Sans, di-self-host); menata ulang nilai token skala teks
 * adalah pekerjaan Task 4. Menampilkan nilai yang belum berlaku sebagai
 * "sudah begini" akan menjadi tempat KEDUA yang menyatakan skala teks, dan
 * yang menyimpang dari `tokens-mockup.css`/`lumi.css` tidak akan pernah
 * terlihat di halaman yang justru ada untuk memverifikasinya.
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

/** Bagian yang belum diisi Task 2/3 — kerangka bertanda, diisi Task 4–9. */
const BAGIAN_BELUM_DIISI = [
  { id: 'bentuk', judul: 'Bentuk' },
  { id: 'ikon', judul: 'Ikon' },
  { id: 'wordmark', judul: 'Wordmark' },
  { id: 'komponen', judul: 'Komponen' },
] as const;

/**
 * Skala teks bagian `teks` (Task 3) — EMPAT token inti, dipetakan ke kelas
 * `.t-*` bundle yang sudah menyetel ukuran DAN bobotnya. Nilainya dibaca dari
 * `getComputedStyle` saat render (lihat komentar berkas), bukan diketik ulang
 * — kalau `lumi.css` mengubah nama token bobot, angka di sini ikut berubah,
 * bukan menyimpang diam-diam.
 *
 * ⛔ Bobot di sini adalah bobot HARI INI (`--weight-regular` 400,
 * `--weight-medium` 500, `--weight-bold` 600) — bukan skala final
 * (display 700 / judul 600 / body 400 / label tombol 600) yang `CLAUDE.md`
 * tetapkan untuk Task 4. Task 3 mengganti FONT, bukan token skala.
 */
const SKALA_TEKS: ReadonlyArray<{ label: string; kelas: string; tokenUkuran: string; tokenBobot: string }> = [
  { label: 'Display', kelas: 't-display', tokenUkuran: '--text-display', tokenBobot: '--weight-bold' },
  { label: 'Judul', kelas: 't-title', tokenUkuran: '--text-title', tokenBobot: '--weight-medium' },
  { label: 'Body', kelas: 't-body', tokenUkuran: '--text-body', tokenBobot: '--weight-regular' },
  { label: 'Caption', kelas: 't-caption', tokenUkuran: '--text-caption', tokenBobot: '--weight-regular' },
];

/** Token yang dibaca bagian `teks`, di luar warna — dipetakan ke `nilai` yang sama. */
const TOKEN_TEKS = SKALA_TEKS.flatMap((s) => [s.tokenUkuran, s.tokenBobot]);

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
    for (const nama of TOKEN_TEKS) peta[nama] = s.getPropertyValue(nama).trim();
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

      <section data-fondasi="teks" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h2 className="t-body-md">Skala teks</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {SKALA_TEKS.map((s) => (
            <div key={s.kelas} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <span className={s.kelas}>
                {s.label} — Aa Bb 0123456789
              </span>
              <span className="t-caption" style={{ color: 'var(--ink-muted)' }}>
                {nilai[s.tokenUkuran] || '(kosong)'} / {nilai[s.tokenBobot] || '(kosong)'}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <span className="t-caption">Angka tabular (kelas .num, aturan DS #4):</span>
          <span className="num t-body">1234567890</span>
        </div>
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
