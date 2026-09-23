// Membangun pengganti lokal untuk lima CDN yang mockup muat.
//
// ⛔ Kenapa ada: di lingkungan tempat tangkapan ini dibuat, proxy egress
// menolak cdn.tailwindcss.com, esm.sh, unpkg.com, dan images.unsplash.com
// (403 pada CONNECT). Berkas di `../sumber/` TIDAK disunting — ia ekspor apa
// adanya. Penggantinya disajikan lewat `page.route` Playwright di URL CDN yang
// sama, jadi mockup memuat modul yang ia minta dari alamat yang ia tulis.
//
// Versi dipaku ke yang mockup minta: react@19, lucide-react@0.468.0,
// @babel/standalone@7.24.7. Tailwind: CDN "play" v3 membangun CSS di peramban
// dari DOM; di sini CSS dibangun lebih dulu dari sumber + daftar kelas yang
// dipanen dari DOM hasil render (lihat `potret.mjs`, lintasan pertama), jadi
// kelas yang dirakit lewat template literal tetap tercakup.
//
//   node vendor.mjs [berkas-kelas-tambahan.txt]

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const SUMBER = path.resolve(DI_SINI, '..', 'sumber');
const KELUAR = path.join(DI_SINI, '.vendor');
const require = createRequire(import.meta.url);
fs.mkdirSync(KELUAR, { recursive: true });

async function esm(namaBerkas, modul, eksternal, plugins = []) {
  const kunci = Object.keys(require(modul)).filter((k) => k !== 'default' && /^[A-Za-z_$][\w$]*$/.test(k));
  const masuk = path.join(KELUAR, `_masuk-${namaBerkas}.js`);
  fs.writeFileSync(
    masuk,
    `import * as M from ${JSON.stringify(modul)};\n` +
      `const D = M.default ?? M;\nexport default D;\n` +
      kunci.map((k) => `export const ${k} = D[${JSON.stringify(k)}];`).join('\n') + '\n'
  );
  await build({
    entryPoints: [masuk],
    bundle: true,
    format: 'esm',
    minify: true,
    outfile: path.join(KELUAR, namaBerkas),
    external: eksternal,
    plugins,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  fs.rmSync(masuk);
  return kunci.length;
}

const nReact = await esm('react.mjs', 'react', []);
/* react-dom adalah CJS yang me-`require('react')`. Eksternal biasa menghasilkan
   "Dynamic require of react is not supported" di ESM; shim ini mengubah
   `require('react')` menjadi impor ESM dari `react` yang import map layani —
   jadi hanya ada SATU salinan React di halaman. */
const shimReact = {
  name: 'shim-react',
  setup(b) {
    b.onResolve({ filter: /^react$/ }, (a) =>
      a.namespace === 'shim' ? { path: 'react', external: true } : { path: 'react', namespace: 'shim' }
    );
    b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
      contents: 'export * from "react"; import D from "react"; export default D;',
      loader: 'js',
    }));
  },
};
const nDom = await esm('react-dom-client.mjs', 'react-dom/client', [], [shimReact]);

/* lucide-react sudah ESM; cukup dibundel dengan react sebagai eksternal. */
await build({
  stdin: { contents: "export * from 'lucide-react';", resolveDir: DI_SINI },
  bundle: true,
  format: 'esm',
  minify: true,
  outfile: path.join(KELUAR, 'lucide-react.mjs'),
  external: ['react', 'react/jsx-runtime'],
  logLevel: 'error',
});

fs.copyFileSync(
  require.resolve('@babel/standalone/babel.min.js'),
  path.join(KELUAR, 'babel.min.js')
);

/* Font Nunito Sans: Chromium tidak memercayai CA proxy, jadi CSS Google Fonts
   dan berkas woff2-nya diunduh lewat curl (yang memakai bundle CA sistem) lalu
   disajikan lewat rute di URL aslinya. Tanpa ini mockup jatuh ke font
   fallback, dan setiap ukuran/lebar teks di tangkapan salah. */
const URL_FONT =
  'https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const cssFont = execFileSync('curl', ['-sSf', '--max-time', '30', '-A', UA, URL_FONT], { encoding: 'utf8' });
const dirFont = path.join(KELUAR, 'font');
fs.mkdirSync(dirFont, { recursive: true });
const petaFont = {};
for (const u of new Set(cssFont.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) ?? [])) {
  const nama = u.replace(/[^\w.]+/g, '_').slice(-80);
  execFileSync('curl', ['-sSf', '--max-time', '30', '-o', path.join(dirFont, nama), u]);
  petaFont[u] = nama;
}
fs.writeFileSync(path.join(dirFont, 'google.css'), cssFont);
fs.writeFileSync(path.join(dirFont, 'peta.json'), JSON.stringify(petaFont, null, 1));

/* Tailwind v3: konten = keempat halaman yang merender kelas, ditambah kelas
   yang dipanen dari DOM bila diberikan. */
const tambahan = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : null;
const konfig = path.join(KELUAR, 'tailwind.config.cjs');
fs.writeFileSync(
  konfig,
  `module.exports = { content: ${JSON.stringify([
    path.join(SUMBER, 'design-explorer.html'),
    path.join(SUMBER, 'ui_kits/*/index.html'),
    ...(tambahan ? [{ raw: fs.readFileSync(tambahan, 'utf8'), extension: 'html' }] : []),
  ])} };\n`
);
const masukCss = path.join(KELUAR, '_masuk.css');
fs.writeFileSync(masukCss, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
execFileSync(
  process.execPath,
  [require.resolve('tailwindcss/lib/cli.js'), '-c', konfig, '-i', masukCss, '-o', path.join(KELUAR, 'tailwind.css')],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);
const css = fs.readFileSync(path.join(KELUAR, 'tailwind.css'), 'utf8');
/* Meniru CDN play: skrip yang menyisipkan <style> ke <head>. */
fs.writeFileSync(
  path.join(KELUAR, 'tailwind-cdn.js'),
  `(function(){var s=document.createElement('style');s.setAttribute('data-vendor','tailwind');` +
    `s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();\n`
);

console.log(
  JSON.stringify({ react: nReact, reactDomClient: nDom, tailwindCssByte: css.length, kelasTambahan: Boolean(tambahan), berkasFont: Object.keys(petaFont).length })
);
