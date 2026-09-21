#!/bin/bash
# Menyiapkan container pengembangan Lumi POS dari NOL sampai suite dapat jalan.
#
# ⛔ KENAPA SKRIP INI ADA
#
# Container diganti di tengah pekerjaan (19 September 2026), dan yang baru tidak
# punya satu pun dari tujuh prasyarat: `node_modules` kosong, Node-nya 22.22.2
# sementara repo mengunci >=24.7, `origin/main` tidak ada, PostgreSQL mati,
# `.env` tidak ada, role `lumi_owner`/`lumi_app` belum dibuat, dan nol migrasi.
#
# Yang membuatnya mahal bukan tujuh langkahnya melainkan BENTUK kegagalannya.
# `node --env-file=.env` pada berkas yang tidak ada mencetak satu baris
# `node: .env: not found` lalu keluar dengan status 0 per-suite, jadi sembilan
# suite ber-database tercetak sebagai baris KOSONG di ringkasan — terbaca
# seperti "belum selesai", bukan seperti "tidak pernah jalan". Itu bentuk cacat
# "nol baris, bukan error" yang sama dengan yang sudah lima kali ditemukan di
# produk ini.
#
# ⛔ Skrip ini GAGAL KERAS dan menyebut langkah mana yang gagal. Diam lalu
# menghasilkan keluaran kosong adalah satu-satunya hasil yang tidak boleh.
#
# ⛔ BUKAN untuk CI. `.github/workflows/test.yml` menyiapkan dirinya sendiri dan
# tidak memanggil berkas ini; dua penyiapan yang saling menyalin akan menyimpang,
# dan yang menyimpang membuat "hijau di lokal, merah di CI" tidak dapat
# dijelaskan. Yang dibagi keduanya adalah `db/bootstrap.js` dan `db/migrate.js`.
#
# Pemakaian:
#
#   bash tools/siapkan-dev.sh
#
# Idempoten: menjalankannya dua kali aman dan langkah yang sudah beres dilewati.

set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

LANGKAH="(belum mulai)"

log()  { echo "[siapkan] $*"; }
mulai() { LANGKAH="$1"; echo ""; echo "[siapkan] === $1 ==="; }

# ⛔ SATU jalan keluar untuk kegagalan, dan ia SELALU menyebut langkahnya.
#
# Versi pertama memakai `trap ... ERR` saja, dan itu diam pada setiap
# `exit 1` eksplisit — `exit` tidak memicu `ERR`. Jadi pesan sebabnya tercetak
# sementara baris "GAGAL di langkah" tidak, dan yang membaca keluarannya harus
# menghitung sendiri sudah sampai langkah berapa. Ditemukan lewat sabotase:
# `.env` dan `.env.example` dihapus, skrip berhenti dengan alasan yang benar dan
# tanpa nama langkahnya.
#
# `trap ERR` tetap dipasang untuk yang TIDAK lewat `gagal` — perintah yang mati
# sendiri di bawah `set -e`.
gagal() {
  echo "" >&2
  echo "⛔ GAGAL di langkah: ${LANGKAH}" >&2
  [ $# -gt 0 ] && echo "   $*" >&2
  echo "   Perbaiki langkah itu lalu jalankan ulang skrip ini." >&2
  exit 1
}
trap 'gagal "perintah di langkah ini keluar dengan status bukan nol."' ERR

NODE_MIN_MAYOR=24
NODE_MIN_MINOR=7

# `node` yang cukup baru? Dipakai untuk memilih dan memverifikasi.
node_cukup() {
  local bin="$1" v mayor minor
  [ -x "$bin" ] || return 1
  v="$("$bin" --version 2>/dev/null | sed 's/^v//')" || return 1
  mayor="${v%%.*}"; minor="$(echo "$v" | cut -d. -f2)"
  [ "$mayor" -gt "$NODE_MIN_MAYOR" ] && return 0
  [ "$mayor" -eq "$NODE_MIN_MAYOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]
}

# --- 1. Node 24.7+ -----------------------------------------------------------
#
# ⛔ Lantainya 24.7 dan itu BUKAN kerapian versi: `crypto.argon2` — hash PIN
# Modul F, dan alasan repo ini tidak punya dependency Argon2 sama sekali — baru
# ada sejak 24.7.0. Runtime yang terlalu tua muncul sebagai test PIN merah yang
# tidak menyebut kata "Node" sama sekali.
mulai "1/7 Node >= ${NODE_MIN_MAYOR}.${NODE_MIN_MINOR}"
NODE_BIN=""
if node_cukup "$(command -v node || true)"; then
  NODE_BIN="$(command -v node)"
  log "sudah memadai: $(node --version)"
else
  # Versi yang mungkin sudah terpasang tapi tidak di PATH.
  for kandidat in /opt/nvm/versions/node/*/bin/node "$HOME"/.nvm/versions/node/*/bin/node /opt/node*/bin/node; do
    if node_cukup "$kandidat"; then NODE_BIN="$kandidat"; break; fi
  done
  if [ -z "$NODE_BIN" ]; then
    log "tidak ada yang memadai — memasang lewat nvm"
    NVM_SH=""
    for n in /opt/nvm/nvm.sh "$HOME/.nvm/nvm.sh"; do [ -f "$n" ] && NVM_SH="$n" && break; done
    if [ -z "$NVM_SH" ]; then
      gagal "nvm tidak ada di /opt/nvm maupun ~/.nvm, dan Node yang terpasang terlalu tua. Pasang Node ${NODE_MIN_MAYOR}.${NODE_MIN_MINOR}+ lebih dulu."
    fi
    # shellcheck disable=SC1090
    . "$NVM_SH"
    nvm install "${NODE_MIN_MAYOR}.${NODE_MIN_MINOR}.0" >/dev/null
    for kandidat in "${NVM_DIR:-/opt/nvm}"/versions/node/*/bin/node; do
      if node_cukup "$kandidat"; then NODE_BIN="$kandidat"; break; fi
    done
  fi
  [ -n "$NODE_BIN" ] || gagal "Node yang memadai tetap tidak tersedia sesudah pemasangan."
fi

NODE_DIR="$(dirname "$NODE_BIN")"
export PATH="${NODE_DIR}:${PATH}"
node_cukup "$(command -v node)" || gagal "PATH tidak menunjuk Node yang memadai."
log "dipakai: $(node --version) dari ${NODE_DIR}"

# ⛔ PATH-nya ikut dituliskan supaya SESI pemanggil memakainya juga. Skrip tidak
# dapat mengubah PATH induknya; tanpa baris ini setiap perintah berikutnya
# kembali ke Node yang terlalu tua, dan gejalanya muncul jauh dari sini.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${NODE_DIR}:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  log "PATH ditulis ke CLAUDE_ENV_FILE"
fi

# --- 2. Dependency -----------------------------------------------------------
mulai "2/7 npm ci"
if [ -d node_modules ] && [ -x node_modules/.bin/vite ]; then
  log "node_modules sudah ada — dilewati"
else
  npm ci --no-audit --no-fund
  [ -x node_modules/.bin/vite ] || gagal "npm ci selesai tetapi node_modules/.bin/vite tidak ada."
fi

# --- 3. origin/main ----------------------------------------------------------
#
# ⛔ `tests/runtime/ds-bundle-vendor.test.js` membandingkan `ds-bundle/` dengan
# basis upstream dan MENOLAK hijau tanpa benar-benar membandingkan. Tanpa ref ini
# ia merah dengan pesan yang tidak menyebut kata "fetch" — sudah pernah memakan
# satu sesi penuh untuk didiagnosis.
mulai "3/7 ref origin/main untuk penjaga vendor"
if git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
  log "sudah ada — dilewati"
else
  git fetch --depth=1 origin main:refs/remotes/origin/main
  git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null \
    || gagal "fetch selesai tetapi refs/remotes/origin/main tetap tidak ada."
fi

# --- 4. PostgreSQL -----------------------------------------------------------
mulai "4/7 PostgreSQL"
if pg_isready -q 2>/dev/null; then
  log "sudah hidup — dilewati"
else
  # `--skip-systemctl-redirect` karena container tidak punya systemd, dan
  # tanpanya `pg_ctlcluster` menggantung tanpa pesan.
  pg_ctlcluster 16 main start --skip-systemctl-redirect >/dev/null 2>&1 \
    || pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do pg_isready -q 2>/dev/null && break; sleep 0.5; done
  pg_isready -q 2>/dev/null || gagal "PostgreSQL tidak menjawab sesudah 15 detik."
fi
log "siap"

# --- 5. .env -----------------------------------------------------------------
mulai "5/7 .env"
if [ -f .env ]; then
  log "sudah ada — TIDAK ditimpa"
else
  [ -f .env.example ] || gagal ".env.example tidak ada, jadi .env tidak dapat dibuat."
  cp .env.example .env
  log "dibuat dari .env.example"
fi
grep -q '^DATABASE_URL=' .env || gagal ".env ada tetapi tidak memuat DATABASE_URL."

# --- 6. Role database --------------------------------------------------------
#
# ⛔ `db:bootstrap` memakai `DATABASE_ADMIN_URL`, dan di container baru kata
# sandi `postgres` belum tentu cocok dengan yang tertulis di sana. Kegagalannya
# muncul sebagai `auth_failed` berbaris-baris tanpa menyebut "kata sandi", jadi
# skrip ini menyelaraskannya lewat peer auth lalu mencoba lagi — sekali, bukan
# berulang.
mulai "6/7 role lumi_owner / lumi_app"
if npm run -s db:bootstrap >/tmp/siapkan-bootstrap.log 2>&1; then
  log "selesai"
else
  log "gagal pada percobaan pertama — menyelaraskan kata sandi superuser"
  ADMIN_PW="$(grep '^DATABASE_ADMIN_URL=' .env | sed -E 's#.*://[^:]+:([^@]*)@.*#\1#')"
  [ -n "$ADMIN_PW" ] || gagal "DATABASE_ADMIN_URL di .env tidak memuat kata sandi."
  sudo -u postgres psql -qc "ALTER USER postgres WITH PASSWORD '${ADMIN_PW}'" >/dev/null
  npm run -s db:bootstrap >/tmp/siapkan-bootstrap.log 2>&1 \
    || { tail -5 /tmp/siapkan-bootstrap.log >&2; gagal "db:bootstrap tetap gagal. Log lengkap: /tmp/siapkan-bootstrap.log"; }
  log "selesai sesudah penyelarasan"
fi

# --- 7. Migrasi --------------------------------------------------------------
#
# `db:migrate` idempoten: ia melewati migrasi yang sudah tercatat. `db:reset`
# TIDAK pernah dipanggil di sini — ia membuang data.
mulai "7/7 migrasi"
npm run -s db:migrate >/tmp/siapkan-migrate.log 2>&1 \
  || { tail -5 /tmp/siapkan-migrate.log >&2; gagal "db:migrate gagal. Log lengkap: /tmp/siapkan-migrate.log"; }
# ⛔ `|| true`, bukan `|| echo 0`: `grep -c` SUDAH mencetak `0` lalu keluar
# dengan status 1, jadi `echo 0` menambahkan nol KEDUA dan barisnya berbunyi
# "0\n0 migrasi baru diterapkan".
JUMLAH_MIGRASI="$(grep -c '^apply ' /tmp/siapkan-migrate.log || true)"
log "${JUMLAH_MIGRASI:-0} migrasi baru diterapkan"

# --- Bukti, bukan klaim ------------------------------------------------------
#
# ⛔ Skrip penyiapan yang berakhir dengan "selesai" tanpa menjalankan apa pun
# adalah klaim. Satu suite ber-database dijalankan di sini justru karena ia yang
# kemarin tercetak sebagai baris kosong.
mulai "bukti: test:isolation menembus database sungguhan"
HASIL="$(npm run -s test:isolation 2>&1 | grep -E '^ℹ (tests|pass|fail)' | tr '\n' ' ')"
echo "[siapkan] ${HASIL}"
echo "$HASIL" | grep -q 'fail 0' || gagal "test:isolation tidak bersih — penyiapan belum benar."

LANGKAH="(selesai)"
echo ""
log "SIAP. Jalankan suite dengan PATH ini:"
log "  export PATH=\"${NODE_DIR}:\$PATH\""
