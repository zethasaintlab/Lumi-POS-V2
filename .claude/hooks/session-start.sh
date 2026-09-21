#!/bin/bash
# SessionStart — menyalakan stack Lumi POS.
#
# ⛔ KENAPA HOOK INI ADA
#
# PostgreSQL mati LIMA KALI dalam satu sesi (31 Agustus 2026), dev server
# terbunuh berkali-kali, dan container di-recycle di tengah kerja. Setiap
# kematian menghasilkan gejala yang MENYESATKAN, bukan pesan yang jelas:
#
#   - `test:server` melaporkan 513 kegagalan, termasuk "password < 10 karakter
#     ditolak" — test yang tidak menyentuh satu pun berkas yang disunting.
#   - `POST /auth/login` menjawab 500 tanpa satu baris pun di log, karena
#     `LOG_LEVEL` bawaan `silent`.
#   - Aplikasi memuat dengan benar lalu gagal login, tidak dapat dibedakan dari
#     kata sandi salah.
#
# Waktu yang habis untuk mendiagnosis ulang gejala yang sama adalah kerugian
# murni. Hook ini menghapusnya.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

log() { echo "[lumi] $*"; }

# --- 1-7. Prasyarat ----------------------------------------------------------
#
# ⛔ SATU sumber, bukan salinan kedua. Ketujuh langkah penyiapan (Node 24.7+,
# dependency, ref `origin/main`, PostgreSQL, `.env`, role, migrasi) hidup di
# `tools/siapkan-dev.sh`. Dua penyiapan yang saling menyalin akan menyimpang,
# dan yang menyimpang menghasilkan sesi yang hidup dengan prasyarat berbeda dari
# yang skripnya janjikan.
#
# ⛔ KEBIJAKANNYA yang berbeda, bukan langkahnya. Skrip itu GAGAL KERAS — ia
# dipanggil orang yang sedang menyiapkan container dan ingin tahu persis langkah
# mana yang gagal. Hook ini tidak boleh menggagalkan sesi: sesi yang menolak
# dimulai karena PostgreSQL mati jauh lebih buruk daripada sesi yang dimulai
# dengan peringatan. Jadi kegagalannya diturunkan menjadi satu baris log, dan
# baris itu menyebut perintah yang harus dijalankan ulang secara manual.
if bash tools/siapkan-dev.sh >/tmp/lumi-log-siapkan.txt 2>&1; then
  log "prasyarat siap (tools/siapkan-dev.sh)"
else
  log "⛔ tools/siapkan-dev.sh GAGAL — sesi tetap dimulai."
  log "   Jalankan manual: bash tools/siapkan-dev.sh"
  tail -3 /tmp/lumi-log-siapkan.txt | while read -r baris; do log "   | ${baris}"; done
fi

# --- Server & aplikasi ----------------------------------------------------
# ⛔ Log TIDAK dibuang ke /dev/null. Server yang mati tanpa jejak adalah persis
# yang membuat 500 tanpa penjelasan itu mahal didiagnosis.
mkdir -p /tmp/lumi-log

hidupkan() { # nama, port, perintah...
  local nama="$1" port="$2"; shift 2
  if curl -s -m 2 -o /dev/null "http://localhost:${port}/" 2>/dev/null; then
    log "${nama} sudah hidup di ${port}"; return
  fi
  log "menyalakan ${nama} (${port})"
  nohup "$@" > "/tmp/lumi-log/${nama}.log" 2>&1 &
}

if [ -f .env ]; then
  hidupkan server    3000 node --env-file=.env apps/server/src/index.ts
  hidupkan kasir     1420 npm run dev --workspace kasir
  hidupkan backoffice 1422 npm run dev --workspace backoffice
  hidupkan hp        1423 npm run dev --workspace hp
else
  log ".env tidak ada — server dan aplikasi dilewati"
fi

log "selesai. Log ada di /tmp/lumi-log/"
