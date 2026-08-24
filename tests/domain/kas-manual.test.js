import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALASAN_KAS_MASUK,
  ALASAN_KAS_KELUAR,
  EVENT_KAS_MASUK,
  EVENT_KAS_KELUAR,
  adalahAlasanKas,
  alasanUntuk,
  counterpartUntuk,
  periksaKas,
  tipeMovement,
} from '../../packages/domain/src/kas-manual.ts';

/**
 * FR-D5 — kas masuk & kas keluar.
 *
 * Aturannya murni, dan itu yang membuat server dan perangkat tidak dapat
 * menyimpang: `periksaKas` yang sama dipanggil `apps/server/.../kas-manual.ts`
 * dan `apps/kasir/src/kas/manual.ts`.
 */

const KELUAR = { arah: 'keluar', jumlah: 50_000n, alasan: 'bayar_pemasok', catatan: null };
const MASUK = { arah: 'masuk', jumlah: 50_000n, alasan: 'tambah_modal', catatan: null };

test('tanda delta DITURUNKAN dari arah, bukan diterima dari pemanggil', () => {
  const keluar = periksaKas(KELUAR);
  const masuk = periksaKas(MASUK);
  assert.equal(keluar.ok, true);
  assert.equal(masuk.ok, true);
  assert.equal(keluar.delta, -50_000n);
  assert.equal(masuk.delta, 50_000n);
});

test('jumlah NEGATIF untuk kas masuk tidak dapat membalik arahnya', () => {
  // ⛔ Ini bentuk cacat yang aturan "jumlah selalu positif" ada untuk
  // menutupnya: klien yang mengirim -50000 untuk kas MASUK akan mengurangi
  // laci yang seharusnya bertambah, dan tidak ada apa pun di layar yang
  // berbeda. Yang menolaknya adalah pemeriksaan `<= 0`.
  const hasil = periksaKas({ ...MASUK, jumlah: -50_000n });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'VALIDATION_ERROR');
});

test('nol ditolak — movement bernilai nol tidak memindahkan uang', () => {
  const hasil = periksaKas({ ...KELUAR, jumlah: 0n });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'VALIDATION_ERROR');
});

test('alasan dari daftar arah LAIN ditolak', () => {
  // `bayar_pemasok` sah untuk keluar dan tidak sah untuk masuk. Daftar yang
  // dibaca dari arah yang salah menghasilkan `counterpart_type` yang salah
  // juga — dan itu tidak terlihat sampai pembukuan dibaca.
  const hasil = periksaKas({ ...MASUK, alasan: 'bayar_pemasok' });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'REASON_INVALID');
});

test('alasan asing ditolak — daftar TERTUTUP', () => {
  const hasil = periksaKas({ ...KELUAR, alasan: 'beli_kopi_buat_saya' });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'REASON_INVALID');
});

test('"lainnya" tanpa catatan ditolak; dengan catatan diterima', () => {
  const tanpa = periksaKas({ ...KELUAR, alasan: 'lainnya', catatan: null });
  assert.equal(tanpa.ok, false);
  assert.equal(tanpa.kode, 'REASON_NOTE_REQUIRED');

  const spasi = periksaKas({ ...KELUAR, alasan: 'lainnya', catatan: '   ' });
  assert.equal(spasi.ok, false, 'catatan berisi spasi saja tidak menjelaskan apa pun');

  const dengan = periksaKas({ ...KELUAR, alasan: 'lainnya', catatan: 'ganti galon' });
  assert.equal(dengan.ok, true);
});

test('counterpart diturunkan dari ALASAN, bukan dari arah', () => {
  // ⛔ Keduanya `paid_out` dengan jumlah yang sama; yang membedakan hanya
  // alasannya. Pembukuan yang menyamakannya melaporkan biaya operasional yang
  // tidak pernah terjadi (`spec-d:216`).
  const pemasok = periksaKas({ ...KELUAR, alasan: 'bayar_pemasok' });
  const pemilik = periksaKas({ ...KELUAR, alasan: 'ambil_pemilik' });
  assert.equal(pemasok.counterpart, 'expense');
  assert.equal(pemilik.counterpart, 'owner_draw');
  assert.equal(pemasok.delta, pemilik.delta, 'jumlah dan arahnya identik');
});

test('"lainnya" dan "koreksi_pencatatan" tidak ditebak sebagai expense', () => {
  assert.equal(counterpartUntuk('lainnya'), 'unidentified');
  assert.equal(counterpartUntuk('koreksi_pencatatan'), 'unidentified');
});

test('setor_ke_bank tetap counterpart bank meski bank_deposit belum dibangun', () => {
  // `spec-d:339` menunda fitur setoran; barisnya tetap dapat ditemukan lagi
  // bila `bank_deposit` kelak lahir.
  assert.equal(counterpartUntuk('setor_ke_bank'), 'bank');
  assert.equal(counterpartUntuk('kembalian_dari_bank'), 'bank');
});

test('setiap alasan di kedua daftar punya counterpart yang bukan tebakan diam', () => {
  // Penjaga struktural: alasan yang ditambahkan kelak tanpa entri COUNTERPART
  // akan jatuh ke `unidentified` tanpa satu pun error. Yang boleh
  // `unidentified` hanya dua yang memang tidak dapat dipetakan.
  const bolehTakDikenal = new Set(['lainnya', 'koreksi_pencatatan']);
  for (const a of [...ALASAN_KAS_MASUK, ...ALASAN_KAS_KELUAR]) {
    const c = counterpartUntuk(a);
    if (bolehTakDikenal.has(a)) {
      assert.equal(c, 'unidentified', a);
    } else {
      assert.notEqual(c, 'unidentified', `${a} jatuh ke tebakan diam`);
    }
  }
});

test('eventType dan tipe movement sepakat dengan arahnya', () => {
  assert.equal(periksaKas(MASUK).eventType, EVENT_KAS_MASUK);
  assert.equal(periksaKas(KELUAR).eventType, EVENT_KAS_KELUAR);
  assert.equal(tipeMovement('masuk'), 'paid_in');
  assert.equal(tipeMovement('keluar'), 'paid_out');
});

test('alasanUntuk dan adalahAlasanKas konsisten', () => {
  assert.deepEqual([...alasanUntuk('masuk')], [...ALASAN_KAS_MASUK]);
  assert.deepEqual([...alasanUntuk('keluar')], [...ALASAN_KAS_KELUAR]);
  for (const a of ALASAN_KAS_KELUAR) assert.equal(adalahAlasanKas('keluar', a), true, a);
  assert.equal(adalahAlasanKas('keluar', 42), false, 'non-string ditolak');
  assert.equal(adalahAlasanKas('keluar', null), false);
});

test('property: |delta| selalu sama dengan jumlah yang diminta', () => {
  // Yang dijaga: pembulatan atau konversi apa pun yang menyelinap ke jalur ini
  // akan mengubah nilai absolutnya, dan uang laci berhenti cocok dengan yang
  // orang serahkan.
  for (let n = 1n; n < 5_000_000_000n; n = n * 7n + 13n) {
    for (const arah of ['masuk', 'keluar']) {
      const h = periksaKas({ arah, jumlah: n, alasan: 'koreksi_pencatatan', catatan: null });
      assert.equal(h.ok, true);
      assert.equal(h.delta < 0n ? -h.delta : h.delta, n);
      assert.equal(h.delta > 0n, arah === 'masuk');
    }
  }
});
