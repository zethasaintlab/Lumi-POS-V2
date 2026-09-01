import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Menangkap SETIAP sel galeri ke `docs/verifikasi/<layar>/<viewport>-<keadaan>.png`.
 *
 * ## ⛔ Kenapa gambar di dalam repo, bukan hanya preview URL
 *
 * Preview URL adalah jalur utama; ia dapat mati — token kedaluwarsa, integrasi
 * dicabut, deployment gagal. Gambar yang ter-commit selalu jalan, GitHub
 * merendernya, dan ia dapat dinilai dari HP. Yang paling penting: ia terikat
 * pada COMMIT-nya, jadi "seperti apa layar ini saat itu" punya jawaban yang
 * tidak berubah kemudian.
 *
 * ## ⛔ Dua viewport, dan keduanya wajib
 *
 * 1280×800 — tablet kasir. `PRD:428` mengunci layar kasir ke sana, dan panggung
 * galeri sendiri terkunci 1024×768 di dalamnya.
 * 1440×900 — viewport back-office, tempat layar yang sama dinilai oleh orang
 * yang mengelola outletnya.
 *
 * Satu viewport saja pernah cukup untuk melewatkan tata letak yang runtuh di
 * viewport lain; ongkos menangkap keduanya adalah beberapa detik.
 *
 * ## Pemakaian
 *
 *   node tools/tangkap-galeri.mjs [url-basis]
 *
 * Bawaannya server statis lokal atas `dist-galeri/`. Beri URL preview untuk
 * menangkap dari deployment sungguhan — build statis dapat berbeda dari dev
 * server, dan yang dinilai merchant adalah yang statis.
 */

const BASIS = process.argv[2] ?? 'http://localhost:4175/harness-galeri.html';
const AKAR = new URL('../docs/verifikasi/', import.meta.url).pathname;

const VIEWPORT = [
  { nama: 'tablet-1280x800', width: 1280, height: 800 },
  { nama: 'backoffice-1440x900', width: 1440, height: 900 },
];

const LAYAR = [
  { id: 'K-03', nama: 'Kasir — grid produk + keranjang' },
  { id: 'K-08', nama: 'Riwayat transaksi' },
  { id: 'K-12', nama: 'Tutup kas' },
  { id: 'K-15', nama: 'Perangkat' },
];

/** Satu baris per keadaan: apa yang harus terlihat. Bukan nama file diulang. */
const KEADAAN = [
  ['kosong', 'Katalog/daftar belum ada. Harus ada kalimat yang menyebut APA yang perlu dilakukan, bukan kotak kosong.'],
  ['normal', 'Keadaan sehari-hari. Pembanding untuk sisanya.'],
  ['memuat', 'Query belum selesai. Harus ada penanda memuat — bukan layar yang tampak kosong.'],
  ['error', 'Database lokal menolak. Pesan harus menyebut AKIBATNYA bagi kasir, bukan nama galatnya.'],
  ['offline', '12 menunggu + 3 gagal di antrean. Indikator harus BERBEDA dari "Tersinkron".'],
  ['panjang', '120 varian. Grid harus tetap dapat dipindai — saringan kategori terlihat.'],
  ['meluap', 'Nama 60 karakter. Harus terpotong rapi TANPA menarik tinggi kartu tetangganya.'],
  ['angka-besar', 'Rp 12.500.000. Harus muat, tetap tabular-nums, tidak mendorong kolom sebelahnya.'],
];

const peramban = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const galat = [];
let jumlah = 0;

for (const layar of LAYAR) {
  const dir = join(AKAR, layar.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const vp of VIEWPORT) {
    const p = await peramban.newPage({ viewport: { width: vp.width, height: vp.height } });
    p.on('pageerror', (e) => galat.push(`${layar.id}/${vp.nama}: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error') galat.push(`${layar.id}/${vp.nama}: ${m.text()}`);
    });

    for (const [keadaan] of KEADAAN) {
      await p.goto(`${BASIS}?layar=${layar.id}&keadaan=${keadaan}`, { waitUntil: 'load' });
      // Layar memuat datanya di `useEffect`; 500 ms cukup untuk fake yang
      // menjawab sinkron, dan skenario "memuat" memang tidak akan pernah
      // selesai — itu justru yang ingin ditangkap.
      await p.waitForTimeout(500);
      await p.screenshot({ path: join(dir, `${vp.nama}-${keadaan}.png`) });
      jumlah += 1;
    }
    await p.close();
  }

  const baris = KEADAAN.map(
    ([k, apa]) =>
      `| \`${k}\` | ${apa} | ![${k}](tablet-1280x800-${k}.png) |`
  ).join('\n');

  writeFileSync(
    join(dir, 'README.md'),
    `# ${layar.id} — ${layar.nama}\n\n` +
      `Ditangkap dari galeri komponen (\`npm run build:galeri\`, build STATIS — ` +
      `bukan dev server). Dua viewport per keadaan: \`tablet-1280x800\` (tablet ` +
      `kasir, \`PRD:428\`) dan \`backoffice-1440x900\`.\n\n` +
      `Buka sel mana pun langsung: \`?layar=${layar.id}&keadaan=<keadaan>\`\n\n` +
      `| Keadaan | Apa yang harus terlihat | Tablet 1280×800 |\n` +
      `|---|---|---|\n${baris}\n\n` +
      `Berkas \`backoffice-1440x900-*.png\` ada di direktori yang sama.\n`
  );
}

await peramban.close();

console.log(`${jumlah} tangkapan layar → docs/verifikasi/`);
if (galat.length > 0) {
  console.log('⛔ GALAT saat menangkap:\n  ' + [...new Set(galat)].join('\n  '));
  process.exit(1);
}
console.log('nol galat konsol, nol galat halaman.');
