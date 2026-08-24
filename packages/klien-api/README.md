# `klien-api` — sesi dan pintu HTTP yang dibagi aplikasi berbasis sesi

Isinya tiga berkas, dan ketiganya PINDAH dari `apps/backoffice/src` pada
24 Agustus 2026 — bukan disalin.

| Berkas | Apa |
|---|---|
| `sesi-simpanan.ts` | Aturan murni: bentuk sesi, kedaluwarsa, pemilihan penyimpanan. Diuji `node --test` tanpa DOM |
| `http.ts` | Satu-satunya pintu keluar HTTP: header sesi, penguraian error, `401` membuang sesi |
| `sesi.tsx` | Glue React tipis di atas keduanya (`PenyediaSesi`, `useSesi`) |

## ⛔ Kenapa dipindah, bukan disalin

`apps/hp` (Owner mobile, `IA:§4`) memakai **kredensial yang sama** dengan
back-office — `IA:245` menuliskannya sebagai sifat M-00. Salinan kedua dari
klien HTTP berarti dua tempat yang memutuskan header apa yang dikirim, kapan
sesi dibuang, dan bagaimana `error.code` server dibaca. Yang menyimpang di
antara keduanya menghasilkan aplikasi yang **berhenti dari sesi yang masih
hidup**, atau lebih buruk, tetap menampilkan layar dengan sesi yang sudah mati.

Aturan yang sama yang membuat `packages/domain` ada: server dan klien tidak
pernah menghitung total yang berbeda. Di sini yang tidak boleh berbeda adalah
apa artinya "sedang masuk".

## Yang TIDAK ikut pindah

`Tombol.tsx` dan `Bidang.tsx` tetap kembar per aplikasi, dengan alasan yang
sudah tertulis di kepala berkasnya: keduanya komponen buatan sendiri yang ada
hanya karena `_adherence.oxlintrc.json` membatasi props design system, dan
`packages/ds` seluruh isinya re-export design system.

`daftar()` (`POST /tenants`, B-00b) ikut di `http.ts` meski hanya back-office
memanggilnya. Memisahkannya berarti dua modul yang keduanya "pintu HTTP", dan
pemanggil berikutnya harus memilih di antaranya.
