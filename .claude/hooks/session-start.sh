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

# --- 1. Dependency -----------------------------------------------------------
# `npm install`, bukan `npm ci`: state container di-cache setelah hook selesai,
# dan `install` memanfaatkan cache itu.
if [ ! -d node_modules ]; then
  log "npm install"
  npm install --no-audit --no-fund >/dev/null 2>&1 || log "npm install GAGAL (lanjut)"
fi

# --- 2. PostgreSQL -----------------------------------------------------------
# Idempoten: `pg_isready` lebih dulu supaya sesi yang PG-nya sudah hidup tidak
# membayar apa pun. `--skip-systemctl-redirect` karena container tidak punya
# systemd, dan tanpanya `pg_ctlcluster` menggantung.
if ! pg_isready -q 2>/dev/null; then
  log "menyalakan PostgreSQL"
  pg_ctlcluster 16 main start --skip-systemctl-redirect >/dev/null 2>&1 \
    || pg_ctlcluster 16 main start >/dev/null 2>&1 \
    || log "PostgreSQL GAGAL menyala"
  for _ in $(seq 1 20); do pg_isready -q 2>/dev/null && break; sleep 0.5; done
fi
pg_isready -q 2>/dev/null && log "PostgreSQL siap" || log "PostgreSQL TIDAK siap"

# --- 3. Skema ----------------------------------------------------------------
# Hanya bila databasenya belum ada. `db:migrate` sendiri idempoten (melewati
# migrasi yang sudah tercatat), jadi menjalankannya selalu juga aman — yang
# TIDAK aman adalah `db:reset`, dan ia tidak pernah dipanggil di sini.
if [ -f .env ] && pg_isready -q 2>/dev/null; then
  npm run db:bootstrap >/dev/null 2>&1 || true
  npm run db:migrate  >/dev/null 2>&1 || log "db:migrate GAGAL"
fi

# --- 4. Server & aplikasi ----------------------------------------------------
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
