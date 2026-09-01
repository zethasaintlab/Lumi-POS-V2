import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

/**
 * Penjaga: galeri komponen tidak pernah masuk bundel perangkat merchant.
 *
 * ## ⛔ Apa yang sedang dijaga
 *
 * `apps/kasir/src/galeri/db-palsu.ts` berisi katalog karangan, shift karangan,
 * dan riwayat penjualan karangan. Perangkat kasir yang memuatnya di samping
 * data sungguhan adalah tepat jenis kecelakaan yang tidak menghasilkan satu pun
 * error sampai seseorang membukanya — dan yang membukanya adalah merchant.
 *
 * Pemisahannya STRUKTURAL, bukan disiplin: dua config Vite, dua entry, dua
 * direktori keluaran. `vite.config.ts` (produksi) tidak menyebut galeri sama
 * sekali, jadi Vite hanya mem-build `index.html`.
 *
 * ## ⛔ Kenapa penjaga ini perlu ada meski pemisahannya struktural
 *
 * Satu baris di `rollupOptions.input` cukup untuk membatalkannya, dan baris itu
 * akan terlihat seperti kemudahan ("biar galerinya ikut ke-build sekalian").
 * Yang hilang saat itu terjadi tidak terlihat di mana pun kecuali di ukuran
 * bundel.
 *
 * Sabotase yang harus membuatnya merah: tambahkan `harness-galeri.html` ke
 * `rollupOptions.input` di `apps/kasir/vite.config.ts`.
 */

const AKAR = new URL('../../', import.meta.url).pathname;

/* ⛔ Komentar dibuang sebelum dipindai — pelajaran yang sama dengan penjaga
   token CSS, dan ia langsung menagih ongkosnya: `vite.galeri.config.ts`
   MENJELASKAN dirinya dengan kalimat "SATU entry, dan ia bukan `index.html`",
   dan versi pertama penjaga ini membacanya sebagai pelanggaran. Penjaga yang
   menandai kode benar akan dimatikan orang berikutnya. */
function tanpaKomentar(kode) {
  return kode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('config produksi kasir tidak menyebut galeri sama sekali', () => {
  const isi = tanpaKomentar(readFileSync(`${AKAR}apps/kasir/vite.config.ts`, 'utf8'));
  for (const jejak of ['galeri', 'harness-galeri']) {
    assert.ok(
      !isi.includes(jejak),
      `apps/kasir/vite.config.ts menyebut "${jejak}". Config produksi tidak boleh ` +
        'tahu galeri ada — galeri punya config sendiri (vite.galeri.config.ts).'
    );
  }
});

test('config galeri mem-build HANYA harness-galeri.html, ke direktori terpisah', () => {
  const isi = tanpaKomentar(readFileSync(`${AKAR}apps/kasir/vite.galeri.config.ts`, 'utf8'));
  assert.match(isi, /harness-galeri\.html/, 'entry galeri harus harness-galeri.html');
  assert.match(isi, /outDir:\s*'\.\.\/\.\.\/dist-galeri'/, 'keluaran galeri harus dist-galeri/');
  assert.ok(
    !/index\.html/.test(isi),
    'config galeri tidak boleh menyertakan index.html — itu entry produksi.'
  );
});

/**
 * ⛔ Penjaga NILAI, bukan penjaga konfigurasi.
 *
 * Kedua test di atas membaca config; test ini membaca HASILNYA. Config yang
 * benar tetap dapat menghasilkan bundel yang salah — misalnya lewat impor tak
 * sengaja dari kode produksi ke `src/galeri/`, yang akan menyeret `db-palsu`
 * masuk tanpa satu baris config pun berubah.
 *
 * Ia melewat bila `dist/` belum pernah dibangun: penjaga yang menuntut build
 * penuh sebelum setiap `npm test` akan dimatikan orang berikutnya. Yang menutup
 * celah itu adalah CI, tempat build memang berjalan.
 */
test('bundel produksi (bila ada) tidak memuat satu pun jejak galeri', () => {
  const dist = `${AKAR}apps/kasir/dist`;
  if (!existsSync(dist)) return;
  const jejak = [];
  const jalan = (d) => {
    for (const n of readdirSync(d)) {
      const p = `${d}/${n}`;
      if (statSync(p).isDirectory()) jalan(p);
      else if (/\.(js|css|html)$/.test(n)) {
        const isi = readFileSync(p, 'utf8');
        // Penanda yang HANYA ada di galeri, dan cukup khas untuk tidak muncul
        // di kode produksi secara kebetulan.
        if (isi.includes('galeri: skenario error') || isi.includes('Kasir Galeri')) {
          jejak.push(p.slice(AKAR.length));
        }
      }
    }
  };
  jalan(dist);
  assert.deepEqual(jejak, [], `Bundel produksi memuat kode galeri:\n  ${jejak.join('\n  ')}`);
});
