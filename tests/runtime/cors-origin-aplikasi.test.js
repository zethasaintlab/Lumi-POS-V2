'use strict';

// Penjaga: setiap aplikasi web punya origin-nya di `CORS_ORIGINS`.
//
// ⛔ KELAS CACAT YANG DITANGKAP BERKAS INI TIDAK MENYEBUT "CORS" DI MANA PUN.
//
// Origin yang hilang dari daftar tidak menghasilkan halaman error. Aplikasinya
// memuat dengan sempurna, layar login tampil, lalu permintaan pertama gagal —
// dan yang pengguna lihat adalah "gagal masuk". Tidak dapat dibedakan dari
// server mati, dari kata sandi salah, atau dari database kosong. Satu-satunya
// tempat kebenarannya tertulis adalah tab Network di devtools, dan orang yang
// sedang mencoba produk ini untuk pertama kali tidak membukanya.
//
// Terjadi 29 Agustus 2026, ditemukan saat menyiapkan panduan uji coba:
// `apps/hp` lahir 25 Agustus sebagai aplikasi KETIGA, dan `.env.example` tidak
// pernah ikut diperbarui. `.env` mesin pengembangan lebih buruk lagi — ia
// memuat `1422,5173`, jadi kasir DAN HP sama-sama diblokir. Tidak ada satu pun
// test yang merah selama itu, karena setiap test memanggil server lewat
// `buildApp` di dalam proses yang sama dan tidak pernah melewati preflight
// browser sama sekali.
//
// ⛔ Aturannya DITURUNKAN dari vite config, bukan ditulis ulang di sini.
// Daftar port yang diketik tangan di penjaga adalah daftar KEDUA yang harus
// diingat untuk diperbarui — dan yang lupa memperbaruinya adalah orang yang
// sama yang lupa memperbarui `.env.example`. Aplikasi KEEMPAT yang lahir kelak
// harus membuat berkas ini merah tanpa siapa pun mengingat ia ada.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');

const AKAR = resolve(__dirname, '../..');

/**
 * Port dev setiap aplikasi, dibaca dari `vite.config.ts` masing-masing.
 *
 * ⛔ `strictPort: true` di ketiga config adalah yang membuat pembacaan ini
 * dapat dipercaya: tanpanya Vite diam-diam pindah ke port berikutnya saat
 * port-nya terpakai, dan origin yang benar hari ini menjadi salah besok tanpa
 * satu pun berkas berubah.
 */
function portAplikasi() {
  const apps = join(AKAR, 'apps');
  const hasil = [];
  for (const nama of readdirSync(apps).sort()) {
    const config = join(apps, nama, 'vite.config.ts');
    if (!existsSync(config)) continue; // apps/server bukan aplikasi Vite
    const teks = readFileSync(config, 'utf8');
    const cocok = teks.match(/port:\s*(\d{4,5})/);
    assert.ok(
      cocok,
      `apps/${nama}/vite.config.ts tidak menyatakan port. Penjaga ini tidak ` +
        'dapat mengetahui origin mana yang harus diizinkan; setel `port:` ' +
        'eksplisit alih-alih mengandalkan bawaan Vite.'
    );
    hasil.push({ nama, port: Number(cocok[1]) });
  }
  return hasil;
}

/** Daftar origin di `.env.example`, apa adanya. */
function corsOrigins() {
  const teks = readFileSync(join(AKAR, '.env.example'), 'utf8');
  // Baris `CORS_ORIGINS=...` yang BUKAN komentar. Baris komentar yang memuat
  // kata itu ada di berkas yang sama dan akan cocok lebih dulu tanpa penjaga
  // `^` + multiline.
  const baris = teks.match(/^CORS_ORIGINS=(.*)$/m);
  assert.ok(baris, '.env.example tidak memuat CORS_ORIGINS sama sekali.');
  return baris[1]
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------

test('setiap aplikasi Vite punya origin-nya di CORS_ORIGINS `.env.example`', () => {
  const apps = portAplikasi();
  const origins = corsOrigins();

  assert.ok(apps.length >= 3, `hanya ${apps.length} aplikasi Vite terbaca; harusnya ≥ 3`);

  for (const { nama, port } of apps) {
    const diharapkan = `http://localhost:${port}`;
    assert.ok(
      origins.includes(diharapkan),
      `apps/${nama} berjalan di port ${port}, tapi "${diharapkan}" tidak ada di ` +
        `CORS_ORIGINS \`.env.example\`.\n` +
        `  Yang ada: ${origins.join(', ')}\n` +
        '  Akibatnya aplikasi itu memuat dengan benar lalu GAGAL LOGIN, tanpa ' +
        'satu pun pesan yang menyebut CORS.'
    );
  }
});

test('⛔ tidak ada origin yang menunjuk port yang bukan milik aplikasi mana pun', () => {
  // Origin berlebih tidak memblokir apa pun — justru itu bahayanya. Ia
  // membuat daftar terlihat lengkap sambil mengizinkan asal yang tidak ada,
  // dan port 1421 adalah jebakan yang sudah menunggu: ia HMR Tauri milik
  // kasir, tetangga langsung dari 1420 dan 1422, dan menuliskannya terasa
  // benar.
  const port = new Set(portAplikasi().map((a) => a.port));
  for (const origin of corsOrigins()) {
    const cocok = origin.match(/^http:\/\/localhost:(\d+)$/);
    if (!cocok) continue; // origin non-localhost adalah urusan deployment
    assert.ok(
      port.has(Number(cocok[1])),
      `CORS_ORIGINS memuat "${origin}", tapi tidak ada aplikasi Vite di port ` +
        `${cocok[1]}. Port aplikasi: ${[...port].sort().join(', ')}.`
    );
  }
});

test('⛔ port aplikasi tidak bertabrakan satu sama lain', () => {
  // Ketiganya harus dapat berjalan BERSAMAAN — panduan uji coba menyuruh
  // membuka keempat proses sekaligus. `strictPort: true` mengubah tabrakan
  // menjadi kegagalan boot, jadi yang ini gagal keras dan cepat; tetap dijaga
  // di sini supaya pesannya menyebut aplikasi mana yang bertabrakan.
  const apps = portAplikasi();
  const terlihat = new Map();
  for (const { nama, port } of apps) {
    assert.ok(
      !terlihat.has(port),
      `apps/${nama} dan apps/${terlihat.get(port)} sama-sama memakai port ${port}.`
    );
    terlihat.set(port, nama);
  }
});
