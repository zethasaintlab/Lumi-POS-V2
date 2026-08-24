import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALASAN_SUPPORT,
  DURASI_BAWAAN_MENIT,
  DURASI_MAKS_MENIT,
  DURASI_MIN_MENIT,
  adalahAlasanSupport,
  bolehLewatSupport,
  hitungKedaluwarsa,
  keadaanSesi,
  periksaPermintaanSupport,
  sesiBerlaku,
  sisaMenit,
} from '../../packages/domain/src/sesi-support.ts';

/**
 * F.5 — akses support. Aturannya murni, dan itu yang membuat penjaga di
 * `sesi.ts` dan tampilan di back-office tidak dapat menyimpang.
 */

const OK = {
  adminLabel: 'Rina (support Lumi)',
  alasan: 'investigasi_laporan_bug',
  catatan: null,
  durasiMenit: null,
  bolehMenulis: false,
};

const T0 = new Date('2026-08-24T10:00:00Z');

const sesi = (over = {}) => ({
  expiresAt: new Date('2026-08-24T12:00:00Z'),
  endedAt: null,
  isWriteEnabled: false,
  ...over,
});

// ---------------------------------------------------------------------------

test('durasi yang tidak disebut memakai BAWAAN, bukan maksimum', () => {
  // ⛔ Owner yang menyetujui tanpa memikirkan durasinya tidak boleh diberi
  // jendela 24 jam. Bawaan yang paling permisif adalah bawaan yang berlaku
  // untuk hampir semua orang.
  const h = periksaPermintaanSupport(OK);
  assert.equal(h.ok, true);
  assert.equal(h.durasiMenit, DURASI_BAWAAN_MENIT);
  assert.equal(DURASI_BAWAAN_MENIT, 120, 'spec-f:400 — default 2 jam');
});

test('durasi di atas 24 jam ditolak', () => {
  assert.equal(DURASI_MAKS_MENIT, 1440, 'spec-f:400 — maksimum 24 jam');
  const h = periksaPermintaanSupport({ ...OK, durasiMenit: DURASI_MAKS_MENIT + 1 });
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'VALIDATION_ERROR');
  // Batasnya sendiri DITERIMA — batas yang menolak nilai batasnya adalah batas
  // yang sebenarnya satu lebih kecil daripada yang tertulis.
  assert.equal(periksaPermintaanSupport({ ...OK, durasiMenit: DURASI_MAKS_MENIT }).ok, true);
});

test('durasi terlalu pendek, pecahan, dan negatif ditolak', () => {
  for (const d of [0, -60, DURASI_MIN_MENIT - 1, 12.5]) {
    assert.equal(periksaPermintaanSupport({ ...OK, durasiMenit: d }).ok, false, String(d));
  }
});

test('nama petugas kosong ditolak — akses tanpa nama tidak dapat dipertanggungjawabkan', () => {
  for (const nama of ['', '   ']) {
    const h = periksaPermintaanSupport({ ...OK, adminLabel: nama });
    assert.equal(h.ok, false, JSON.stringify(nama));
    assert.equal(h.kode, 'VALIDATION_ERROR');
  }
});

test('alasan di luar daftar tertutup ditolak', () => {
  const h = periksaPermintaanSupport({ ...OK, alasan: 'penasaran_saja' });
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'REASON_INVALID');
  for (const a of ALASAN_SUPPORT) {
    assert.equal(adalahAlasanSupport(a), true, a);
  }
  assert.equal(adalahAlasanSupport(42), false);
});

test('"lainnya" tanpa catatan ditolak', () => {
  const h = periksaPermintaanSupport({ ...OK, alasan: 'lainnya', catatan: null });
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'REASON_NOTE_REQUIRED');
  assert.equal(
    periksaPermintaanSupport({ ...OK, alasan: 'lainnya', catatan: 'migrasi manual' }).ok,
    true
  );
});

// --- berlaku / kedaluwarsa --------------------------------------------------

test('⛔ sesi berakhir PADA expires_at, tidak sesudahnya', () => {
  const s = sesi({ expiresAt: new Date('2026-08-24T12:00:00Z') });
  assert.equal(sesiBerlaku(s, new Date('2026-08-24T11:59:59.999Z')), true);
  // Batas EKSKLUSIF. "Sampai jam 12" yang berarti "termasuk detik pertama jam
  // 12" adalah kelonggaran yang tidak ada alasannya dan yang akan dipakai.
  assert.equal(sesiBerlaku(s, new Date('2026-08-24T12:00:00.000Z')), false);
});

test('⛔ sesi yang DIAKHIRI tidak berlaku meski belum kedaluwarsa', () => {
  const s = sesi({ endedAt: new Date('2026-08-24T10:30:00Z') });
  assert.equal(sesiBerlaku(s, T0), false, 'pencabutan harus berlaku SEKETIKA');
  assert.equal(sesiBerlaku(s, new Date('2026-08-24T11:00:00Z')), false);
});

test('⛔ "diakhiri" DIBEDAKAN dari "kedaluwarsa"', () => {
  // Keduanya berarti akses sudah tidak berlaku, tetapi yang pertama berarti
  // merchant MENCABUTNYA — dan riwayat yang menyamakannya menghapus
  // satu-satunya sinyal bahwa seseorang merasa perlu memutus akses lebih awal.
  assert.equal(keadaanSesi(sesi(), T0), 'aktif');
  assert.equal(keadaanSesi(sesi(), new Date('2026-08-24T13:00:00Z')), 'kedaluwarsa');
  assert.equal(keadaanSesi(sesi({ endedAt: T0 }), T0), 'diakhiri');
  // Diakhiri MENANG atas kedaluwarsa: sesi yang dicabut lalu lewat batasnya
  // tetap "diakhiri" — itu yang benar-benar terjadi.
  assert.equal(
    keadaanSesi(sesi({ endedAt: T0 }), new Date('2026-08-24T13:00:00Z')),
    'diakhiri'
  );
});

// --- gerbang akses ----------------------------------------------------------

test('⛔ read-only adalah BAWAAN — mutasi ditolak tanpa persetujuan terpisah', () => {
  const s = sesi({ isWriteEnabled: false });
  assert.equal(bolehLewatSupport(s, T0, false).boleh, true, 'membaca boleh');
  const tulis = bolehLewatSupport(s, T0, true);
  assert.equal(tulis.boleh, false);
  assert.equal(tulis.kode, 'SUPPORT_SESSION_READ_ONLY');
});

test('sesi ber-izin tulis mengizinkan mutasi', () => {
  assert.equal(bolehLewatSupport(sesi({ isWriteEnabled: true }), T0, true).boleh, true);
});

test('⛔ sesi kedaluwarsa menolak SEGALANYA, termasuk membaca', () => {
  // Sesi yang kedaluwarsa masih dapat membaca adalah sesi yang tidak
  // benar-benar berbatas waktu.
  const lewat = new Date('2026-08-24T13:00:00Z');
  for (const mutasi of [false, true]) {
    const h = bolehLewatSupport(sesi({ isWriteEnabled: true }), lewat, mutasi);
    assert.equal(h.boleh, false, `mutasi=${mutasi}`);
    assert.equal(h.kode, 'SUPPORT_SESSION_EXPIRED');
  }
});

test('⛔ sesi yang diakhiri menolak membaca juga, dan kodenya EXPIRED', () => {
  const h = bolehLewatSupport(sesi({ endedAt: T0, isWriteEnabled: true }), T0, false);
  assert.equal(h.boleh, false);
  assert.equal(h.kode, 'SUPPORT_SESSION_EXPIRED');
});

// --- perhitungan waktu ------------------------------------------------------

test('kedaluwarsa dihitung dari mulai + durasi', () => {
  assert.equal(
    hitungKedaluwarsa(T0, 120).toISOString(),
    new Date('2026-08-24T12:00:00Z').toISOString()
  );
});

test('⛔ sisa menit dibulatkan KE ATAS, dan tidak pernah negatif', () => {
  // Ke bawah membuat banner berkata "0 menit tersisa" selama 59 detik
  // terakhir — memberi tahu merchant bahwa akses sudah berakhir sementara ia
  // masih berlaku.
  const s = sesi({ expiresAt: new Date('2026-08-24T10:00:30Z') });
  assert.equal(sisaMenit(s, T0), 1, '30 detik tersisa dibaca 1 menit');
  assert.equal(sisaMenit(s, new Date('2026-08-24T10:00:30Z')), 0);
  assert.equal(sisaMenit(s, new Date('2026-08-24T11:00:00Z')), 0, 'tidak pernah negatif');
});

test('property: sesi yang berlaku selalu punya sisa > 0, dan sebaliknya', () => {
  const akhir = new Date('2026-08-24T12:00:00Z');
  const s = sesi({ expiresAt: akhir });
  for (let ms = -5 * 60_000; ms <= 5 * 60_000; ms += 7_777) {
    const pada = new Date(akhir.getTime() + ms);
    assert.equal(sesiBerlaku(s, pada), sisaMenit(s, pada) > 0, pada.toISOString());
  }
});
