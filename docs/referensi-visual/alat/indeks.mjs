// Menulis `../INDEKS.md` dari daftar yang SAMA dengan yang dipotret
// (`bacaApps` + `kombinasi` dari potret.mjs), lalu menegaskan setiap baris
// punya berkas di `../layar/` dan tidak ada berkas yang tidak berbaris.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bacaApps, kombinasi } from './potret.mjs';

const DI_SINI = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(DI_SINI, '..');
const apps = bacaApps();
const semua = kombinasi(apps);

const ada = new Set(fs.readdirSync(path.join(AKAR, 'layar')));
const hilang = semua.filter((k) => !ada.has(k.berkas)).map((k) => k.berkas);
const yatim = [...ada].filter((f) => !semua.some((k) => k.berkas === f));
if (hilang.length || yatim.length) {
  console.error(JSON.stringify({ hilang, yatim }, null, 2));
  process.exit(1);
}

const LEBAR = { kasir: 480, backoffice: 480, order: 220 };

/* Kolom "Sesudah": tangkapan pasangan mockup ↔ galeri SESUDAH layar itu
   dikerjakan di Fase 3 rebuild UI (`BANDING_KELUAR=sesudah node banding.mjs`).
   Dicocokkan lewat akhiran `__<layar>--<keadaan>[--x].png` (nama berkas
   `banding.mjs`/`banding2.mjs`, tanpa awalan aplikasi — keduanya hanya
   memasangkan layar kasir), jadi satu keadaan mockup dapat punya lebih dari
   satu padanan. */
const DIR_SESUDAH = path.join(AKAR, 'sesudah');
const sesudah = fs.existsSync(DIR_SESUDAH) ? fs.readdirSync(DIR_SESUDAH).filter((f) => f.endsWith('.png')) : [];
const sesudahUntuk = (k) => {
  if (k.app.id !== 'kasir') return [];
  const inti = `${k.layar.id}--${k.keadaan?.id ?? 'tunggal'}`;
  return sesudah.filter((f) => f.endsWith(`__${inti}.png`) || f.includes(`__${inti}--`));
};
const baris = [];
baris.push('# Indeks referensi visual — design-explorer');
baris.push('');
baris.push(
  `Dibangkitkan \`alat/indeks.mjs\` dari \`const APPS\` di \`sumber/design-explorer.html\`. ` +
    `**${apps.length} aplikasi · ${apps.reduce((n, a) => n + a.screens.length, 0)} layar · ${semua.length} kombinasi · ${ada.size} tangkapan.**`
);
baris.push('');
baris.push('Rujukan **tata letak dan tampilan** saja (peringkat 3). Baca `README.md` sebelum memakai satu pun gambar di sini.');
baris.push('');
baris.push('Nama berkas: `<aplikasi>--<layar>--<keadaan>.png`. Layar tanpa dropdown keadaan memakai keadaan `tunggal`.');
baris.push('');
for (const app of apps) {
  const milik = semua.filter((k) => k.app === app);
  const catatan = app.id === 'order' ? ' — di repo ini: `apps/hp` (lihat README)' : '';
  baris.push(`## ${app.label} (\`${app.id}\`)${catatan}`);
  baris.push('');
  baris.push(`Viewport ${app.device.w}×${app.device.h} · ${app.screens.length} layar · ${milik.length} kombinasi`);
  baris.push('');
  baris.push('| Layar | Keadaan | Tangkapan | Sesudah (Fase 3, mockup ↔ repo) |');
  baris.push('|---|---|---|---|');
  for (const k of milik) {
    const keadaan = k.keadaan ? `${k.keadaan.label} (\`${k.keadaan.id}\`)` : '— (`tunggal`)';
    baris.push(
      `| ${k.layar.label} (\`${k.layar.id}\`) | ${keadaan} | ` +
        `<a href="layar/${k.berkas}"><img src="layar/${k.berkas}" width="${LEBAR[app.id] ?? 360}" alt="${app.label} · ${k.layar.label}${k.keadaan ? ' · ' + k.keadaan.label : ''}"></a> | ` +
        (sesudahUntuk(k).map((f) => `<a href="sesudah/${f}"><img src="sesudah/${f}" width="480" alt="Sesudah · ${f}"></a>`).join('<br>') || '—') +
        ' |'
    );
  }
  baris.push('');
}
fs.writeFileSync(path.join(AKAR, 'INDEKS.md'), baris.join('\n'));
console.log(JSON.stringify({ kombinasi: semua.length, tangkapan: ada.size }));
