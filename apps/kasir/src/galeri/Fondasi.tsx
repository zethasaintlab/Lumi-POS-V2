import { useMemo } from 'react';
import { potongSentuh } from 'ds';

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
 * Task 2 mengisi bagian `warna`. Task 3 mengisi `teks` dengan font baru; Task 4
 * menata ulang nilai token skala teksnya ke 32/20/15/13. Ketiga bagian lain
 * adalah kerangka kosong bertanda `data-fondasi`, diisi Task 5–9 di kampanye
 * yang sama: `bentuk` (radius/bayangan/spasi/target sentuh), `ikon` (Lucide),
 * `wordmark` ("LumiPOS"), `komponen` (kulit komponen § 9, setiap keadaan:
 * normal, hover, nonaktif, galat).
 *
 * ⛔ Bagian `teks` (Task 4) menampilkan skala FINAL 32/20/15/13, bobot mockup
 * (display 700, judul 600, body 400, caption 400) — dibaca dari
 * `getComputedStyle`, bukan diketik ulang. `--t-metric` DIHAPUS (spec § 5);
 * halaman ini tidak punya swatch untuknya karena token itu tidak ada lagi.
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

/** Bagian yang belum diisi Task 2/4/5 — kerangka bertanda, diisi Task 6–9. */
const BAGIAN_BELUM_DIISI = [
  { id: 'ikon', judul: 'Ikon' },
  { id: 'wordmark', judul: 'Wordmark' },
  { id: 'komponen', judul: 'Komponen' },
] as const;

/**
 * Skala teks bagian `teks` (Task 4) — EMPAT token inti final (32/20/15/13),
 * dipetakan ke kelas `.t-*` bundle yang sudah menyetel ukuran DAN bobotnya.
 * Nilainya dibaca dari `getComputedStyle` saat render (lihat komentar
 * berkas), bukan diketik ulang — kalau `lumi.css` mengubah nama atau nilai
 * token, angka di sini ikut berubah, bukan menyimpang diam-diam.
 *
 * Bobot mockup: `--weight-bold` → display (700), `--weight-medium` → judul
 * (600), `--weight-regular` → body/caption (400). `--t-metric` DIHAPUS
 * (spec § 5) — tidak ada baris untuknya di sini.
 */
const SKALA_TEKS: ReadonlyArray<{ label: string; kelas: string; tokenUkuran: string; tokenBobot: string }> = [
  { label: 'Display', kelas: 't-display', tokenUkuran: '--text-display', tokenBobot: '--weight-bold' },
  { label: 'Judul', kelas: 't-title', tokenUkuran: '--text-title', tokenBobot: '--weight-medium' },
  { label: 'Body', kelas: 't-body', tokenUkuran: '--text-body', tokenBobot: '--weight-regular' },
  { label: 'Caption', kelas: 't-caption', tokenUkuran: '--text-caption', tokenBobot: '--weight-regular' },
];

/** Token yang dibaca bagian `teks`, di luar warna — dipetakan ke `nilai` yang sama. */
const TOKEN_TEKS = SKALA_TEKS.flatMap((s) => [s.tokenUkuran, s.tokenBobot]);

/**
 * Bagian `bentuk` (Task 5) — radius, bayangan, target sentuh. Spec § 6
 * (`docs/superpowers/specs/2026-09-26-fondasi-desain-design.md`): tiga
 * radius (`--radius` 12/kartu, `--radius-control` 10/tombol, `--radius-pill`
 * 999/pil-chip), dua bayangan (`--shadow-card`, `--shadow-raised`), dua
 * target sentuh (`--touch-min` 44, `--touch-critical` — diarahkan dari
 * `--touch-primary` mockup lewat `lumi.css`).
 *
 * Nilainya dibaca dari `getComputedStyle` sama seperti bagian lain di
 * berkas ini (lihat komentar kepala § "Nilai DIBACA, tidak diketik") — bukan
 * diketik ulang dari `tokens-mockup.css`.
 */
const RADIUS: ReadonlyArray<{ label: string; token: string; dataUji: string; kelas: string }> = [
  { label: '--radius (kartu)', token: '--radius', dataUji: 'radius-kartu', kelas: 'fondasi-bentuk-radius-inti' },
  { label: '--radius-control (tombol)', token: '--radius-control', dataUji: 'radius-tombol', kelas: 'fondasi-bentuk-radius-control' },
  { label: '--radius-pill (pil/chip)', token: '--radius-pill', dataUji: 'radius-pil', kelas: 'fondasi-bentuk-radius-pill' },
];
const BAYANGAN: ReadonlyArray<{ label: string; token: string; dataUji: string; kelas: string }> = [
  { label: '--shadow-card', token: '--shadow-card', dataUji: 'bayangan-card', kelas: 'fondasi-bentuk-bayangan-card' },
  { label: '--shadow-raised', token: '--shadow-raised', dataUji: 'bayangan-raised', kelas: 'fondasi-bentuk-bayangan-raised' },
];
const TOKEN_BENTUK = [
  ...RADIUS.map((r) => r.token),
  ...BAYANGAN.map((b) => b.token),
  '--touch-min',
  '--touch-critical',
];

/** Swatch radius/bayangan — sejajar `Swatch` warna di atas, kotaknya dibentuk lewat kelas `fondasi-bentuk-*` (`galeri.css`, chrome galeri) alih-alih inline style, supaya tidak menulis `border`/`background` sendiri di komponen (`ds-adherence` melarang literal px/hex di JSX). */
function KotakBentuk({ label, nilai, dataUji, kelas }: { label: string; nilai: string; dataUji: string; kelas: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'center' }}>
      <div
        className={`fondasi-bentuk-kotak ${kelas}`}
        data-uji={dataUji}
        aria-hidden="true"
        style={{ width: 'var(--space-8)', height: 'var(--space-8)' }}
      />
      <span className="t-caption">{label}</span>
      <span className="t-caption" style={{ color: 'var(--ink-muted)' }}>
        {nilai || '(kosong)'}
      </span>
    </div>
  );
}

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
    for (const nama of TOKEN_BENTUK) peta[nama] = s.getPropertyValue(nama).trim();
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

      <section data-fondasi="bentuk" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <h2 className="t-body-md">Bentuk</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h3 className="t-caption" style={{ margin: 0 }}>
            Radius
          </h3>
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            {RADIUS.map((r) => (
              <KotakBentuk key={r.token} label={r.label} nilai={nilai[r.token]} dataUji={r.dataUji} kelas={r.kelas} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h3 className="t-caption" style={{ margin: 0 }}>
            Bayangan
          </h3>
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            {BAYANGAN.map((b) => (
              <KotakBentuk key={b.token} label={b.label} nilai={nilai[b.token]} dataUji={b.dataUji} kelas={b.kelas} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <h3 className="t-caption" style={{ margin: 0 }}>
            Target sentuh — <code>.sentuh</code> (≥ {nilai['--touch-min'] || '(kosong)'}) dan{' '}
            <code>.sentuh-uang</code> (≥ {nilai['--touch-critical'] || '(kosong)'})
          </h3>
          <p className="t-caption" style={{ margin: 0, color: 'var(--ink-muted)' }}>
            Kotak biru di bawah tetap 28×28 — hanya area TEKAN-nya yang meluas, tak
            terlihat (<code>tests/kasir-dom/area-sentuh.test.js</code>).
          </p>

          {/* Dua elemen TERISOLASI, berjarak lapang (`--space-8`) supaya area
              perluasannya (44 dan 56) tidak saling mendekat — inilah yang
              diukur `document.elementFromPoint` di ±21/±23 dan ±27/±29. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className="sentuh fondasi-sentuh-demo"
                data-uji="sentuh-tunggal"
                aria-label="Uji area sentuh minimal"
              />
              <span className="t-caption">.sentuh (tunggal)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className="sentuh-uang fondasi-sentuh-demo"
                data-uji="sentuh-uang-tunggal"
                aria-label="Uji area sentuh uang minimal"
              />
              <span className="t-caption">.sentuh-uang (tunggal)</span>
            </div>
          </div>

          {/* Baris TIGA tombol 28×28 berjarak `--space-2` (8px) — kasus uji
              tidak-bertumpuk (keputusan user 26 September 2026). 8px jauh
              lebih rapat dari perluasan simetris 44px; tanpa pemotongan per
              sisi lewat `potongSentuh` (`packages/ds/sentuh.ts`), area tekan
              tombol 1 dan 2 akan tumpang tindih di celahnya. Dipotong PERSIS
              di garis tengah celah — `celah` diteruskan sebagai TOKEN
              layout ('var(--space-2)'), sama persis dengan `gap` yang
              menata baris ini, bukan angka yang diketik ulang.
              Baris KEDUA (jarak `--space-3`, 12px) membuktikan mekanismenya
              GAP-DRIVEN, bukan konstanta 8px yang dipaku — sabotase yang
              mengabaikan `celah` membuat baris ini merah, bukan baris
              pertama saja (fix round 1, temuan review Task 5). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="sentuh fondasi-sentuh-demo"
                  data-uji="sentuh-baris-1"
                  aria-label="Uji tetangga 1"
                  style={potongSentuh(['kanan'], 'var(--space-2)') as React.CSSProperties}
                />
                <button
                  type="button"
                  className="sentuh fondasi-sentuh-demo"
                  data-uji="sentuh-baris-2"
                  aria-label="Uji tetangga 2"
                  style={potongSentuh(['kiri', 'kanan'], 'var(--space-2)') as React.CSSProperties}
                />
                <button
                  type="button"
                  className="sentuh fondasi-sentuh-demo"
                  data-uji="sentuh-baris-3"
                  aria-label="Uji tetangga 3"
                  style={potongSentuh(['kiri'], 'var(--space-2)') as React.CSSProperties}
                />
              </div>
              <span className="t-caption">3× .sentuh, 28×28, jarak --space-2 (8px) — area dipotong di tengah celah</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button
                  type="button"
                  className="sentuh fondasi-sentuh-demo"
                  data-uji="sentuh-gap12-1"
                  aria-label="Uji tetangga gap besar — 1"
                  style={potongSentuh(['kanan'], 'var(--space-3)') as React.CSSProperties}
                />
                <button
                  type="button"
                  className="sentuh fondasi-sentuh-demo"
                  data-uji="sentuh-gap12-2"
                  aria-label="Uji tetangga gap besar — 2"
                  style={potongSentuh(['kiri', 'kanan'], 'var(--space-3)') as React.CSSProperties}
                />
                <button
                  type="button"
                  className="sentuh fondasi-sentuh-demo"
                  data-uji="sentuh-gap12-3"
                  aria-label="Uji tetangga gap besar — 3"
                  style={potongSentuh(['kiri'], 'var(--space-3)') as React.CSSProperties}
                />
              </div>
              <span className="t-caption">3× .sentuh, 28×28, jarak --space-3 (12px) — gap BERBEDA, membuktikan mekanismenya gap-driven</span>
            </div>
          </div>
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
