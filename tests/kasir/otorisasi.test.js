'use strict';

// §7 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- otorisasi step-up
// (K-11, FR-B8/B9, spec-f §F.3).
//
// Yang dijaga di sini adalah AC yang paling mudah rusak tanpa terlihat:
// "Sesi kasir identik sebelum dan sesudah otorisasi" (`spec-f:279`). Dialog
// yang diam-diam mengganti sesi akan membuat penjualan berikutnya
// dinisbatkan ke MANAJER, dan itu tidak akan pernah terlihat di layar -- hanya
// di laporan, berminggu-minggu kemudian.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/identitas/otorisasi.ts';

const HASH_MANAJER = '$argon2id$v=19$m=19456,t=2,p=1$bWFuYWplcm1hbmFqZXJtYQ$dGFndGFndGFndGFndGFndGFndGFndGFndGFndGFndGFn';
const HASH_KASIR = '$argon2id$v=19$m=19456,t=2,p=1$a2FzaXJrYXNpcmthc2lya2E$a2FzaXJrYXNpcmthc2lya2FzaXJrYXNpcmthc2lya2E';

function dbPalsu({ pengguna = [], kunci = [] } = {}) {
  const state = { pengguna, kunci, ditulis: [], sesi: { user_id: 'u-sari', nama: 'Sari' } };
  return {
    state,
    async getAll(sql, params = []) {
      if (/FROM "user"/.test(sql)) return state.pengguna.filter((u) => u.is_active === 1);
      if (/FROM pin_lockout_lokal/.test(sql)) return state.kunci.filter((k) => k.user_id === params[0]);
      if (/FROM user_role/.test(sql)) return state.pengguna.find((u) => u.id === params[0])?.peran ?? [];
      if (/FROM sesi_lokal/.test(sql)) return state.sesi ? [state.sesi] : [];
      return [];
    },
    async execute(sql, params = []) {
      state.ditulis.push({ sql, params });
      if (/INSERT INTO pin_lockout_lokal/.test(sql)) {
        const [userId, gagal, sampai = null, jumlah = 0, jendela = null] = params;
        const ada = state.kunci.find((k) => k.user_id === userId);
        const baris = ada ?? { user_id: userId };
        Object.assign(baris, {
          gagal_berturut: gagal,
          terkunci_sampai: sampai,
          jumlah_penguncian: jumlah,
          jendela_mulai: jendela,
        });
        if (!ada) state.kunci.push(baris);
      }
      if (/DELETE FROM pin_lockout_lokal/.test(sql)) {
        state.kunci = state.kunci.filter((k) => k.user_id !== params[0]);
      }
      // ⛔ Sesi sengaja TIDAK dimodelkan sebagai dapat ditulis di sini. Kalau
      // `otorisasi` menyentuh sesi_lokal, test di bawah menangkapnya lewat
      // `ditulis` -- bukan lewat state yang diam-diam berubah.
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

const PENGGUNA = [
  {
    id: 'u-sari', name: 'Sari', pin_hash: HASH_KASIR, pin_must_change: 0, is_active: 1,
    peran: [{ role: 'cashier' }],
  },
  {
    id: 'u-budi', name: 'Budi', pin_hash: HASH_MANAJER, pin_must_change: 0, is_active: 1,
    peran: [{ role: 'outlet_manager' }],
  },
];

const hasher = {
  async hash(pin) { return `hash#${pin}`; },
  async verifikasi(pin, phc) {
    if (pin === '905172') return phc === HASH_MANAJER;
    if (pin === '482913') return phc === HASH_KASIR;
    return false;
  },
};

const JAM = () => new Date('2026-08-11T10:00:00.000Z');

// ---------------------------------------------------------------------------

test('otorisasi: PIN manajer benar → disetujui, dengan id penyetuju', async () => {
  const { otorisasi } = await import(MOD);
  const db = dbPalsu({ pengguna: PENGGUNA });

  const hasil = await otorisasi({
    db, hasher, waktu: JAM,
    pin: '905172',
    aktorId: 'u-sari',
    operasi: 'approve_authorization',
  });

  assert.equal(hasil.status, 'disetujui');
  assert.equal(hasil.approverId, 'u-budi');
  assert.equal(hasil.approverNama, 'Budi');
});

test('⛔ sesi kasir IDENTIK sebelum dan sesudah otorisasi (spec-f:279)', async () => {
  const { otorisasi } = await import(MOD);
  const db = dbPalsu({ pengguna: PENGGUNA });
  const sebelum = JSON.stringify(db.state.sesi);

  await otorisasi({
    db, hasher, waktu: JAM, pin: '905172', aktorId: 'u-sari',
    operasi: 'approve_authorization',
  });

  assert.equal(JSON.stringify(db.state.sesi), sebelum, 'sesi berubah');
  // Dan tidak ada satu pun pernyataan yang MENYENTUH sesi_lokal. Memeriksa
  // nilainya saja tidak cukup: tulis-lalu-tulis-balik akan lolos, dan itu
  // persis bentuk bug yang muncul kalau dialog memakai ulang `masuk()`.
  const sentuhSesi = db.state.ditulis.filter((t) => /sesi_lokal/.test(t.sql));
  assert.deepEqual(sentuhSesi, [], 'otorisasi tidak boleh menulis ke sesi_lokal sama sekali');
});

test('penyetuju tanpa hak DITOLAK meski PIN benar (spec-f:278)', async () => {
  const { otorisasi } = await import(MOD);
  const db = dbPalsu({ pengguna: PENGGUNA });

  // Kasir kedua, PIN-nya sah, tapi `cashier` tidak punya
  // `approve_authorization`. Ini AC yang membedakan otorisasi dari sekadar
  // "ada orang lain yang tahu PIN".
  const hasil = await otorisasi({
    db, hasher, waktu: JAM,
    pin: '482913',
    aktorId: 'u-budi',
    operasi: 'approve_authorization',
  });

  assert.equal(hasil.status, 'tidak_berhak');
  // Pesannya BERBEDA dari "PIN salah" -- manajer yang PIN-nya benar tapi
  // perannya kurang harus tahu bahwa yang salah bukan ketikannya.
  assert.match(hasil.pesan, /tidak berhak|wewenang/i);
});

test('⛔ penyetuju TIDAK BOLEH sama dengan aktor (spec-f:96, FR-F7)', async () => {
  const { otorisasi } = await import(MOD);
  const db = dbPalsu({ pengguna: PENGGUNA });

  // Manajer outlet yang menjalankan kasir sendiri adalah hal biasa di kafe
  // kecil -- ia punya hak `approve_authorization`, jadi tanpa pemeriksaan ini
  // ia dapat menyetujui refundnya sendiri. `audit_event` punya CHECK yang
  // menolaknya di server, tapi kalau dialog di perangkat meloloskannya,
  // kasir baru tahu setelah refund gagal terkirim -- uangnya sudah keluar
  // laci.
  const hasil = await otorisasi({
    db, hasher, waktu: JAM,
    pin: '905172',
    aktorId: 'u-budi',
    operasi: 'approve_authorization',
  });

  assert.equal(hasil.status, 'sama_dengan_aktor');
  assert.match(hasil.pesan, /sendiri/i);
});

test('PIN salah → pesan netral, sama seperti login', async () => {
  const { otorisasi } = await import(MOD);
  const db = dbPalsu({ pengguna: PENGGUNA });

  const hasil = await otorisasi({
    db, hasher, waktu: JAM, pin: '739154', aktorId: 'u-sari',
    operasi: 'approve_authorization',
  });
  assert.equal(hasil.status, 'pin_salah');
});

test('rate limiting berlaku pada PIN penyetuju (spec-f:280)', async () => {
  const { otorisasi } = await import(MOD);
  const db = dbPalsu({ pengguna: PENGGUNA });

  // AC-nya eksplisit, dan alasannya langsung: dialog otorisasi adalah
  // permukaan tebak-PIN yang JAUH lebih sering muncul daripada layar login --
  // ia terbuka setiap refund. Tanpa penguncian, ia jadi jalan masuk termudah.
  let hasil;
  for (let i = 0; i < 5; i += 1) {
    hasil = await otorisasi({
      db, hasher, waktu: JAM, pin: '739154', aktorId: 'u-sari',
      operasi: 'approve_authorization',
    });
  }
  assert.equal(hasil.status, 'terkunci');
  assert.equal(hasil.detikTersisa, 60);
});

test('penyetuju yang sedang TERKUNCI ditolak meski PIN benar', async () => {
  const { otorisasi } = await import(MOD);
  const db = dbPalsu({
    pengguna: PENGGUNA,
    kunci: [{
      user_id: 'u-budi', gagal_berturut: 5,
      terkunci_sampai: '2026-08-11T10:00:45.000Z',
      jumlah_penguncian: 1, jendela_mulai: '2026-08-11T09:59:00.000Z',
    }],
  });

  const hasil = await otorisasi({
    db, hasher, waktu: JAM, pin: '905172', aktorId: 'u-sari',
    operasi: 'approve_authorization',
  });
  assert.equal(hasil.status, 'terkunci');
  assert.equal(hasil.detikTersisa, 45);
});

test('alasan: daftar tertutup, dan "lainnya" menuntut catatan >= 10 karakter', async () => {
  const { validasiAlasan, ALASAN_REFUND } = await import(MOD);

  // `spec-b` §B.4 + AC `spec-f:385`. Free text tidak dapat diagregasi jadi
  // laporan fraud, dan itu seluruh gunanya.
  assert.deepEqual(
    ALASAN_REFUND.map((a) => a.kode),
    ['barang_rusak', 'pesanan_salah', 'pelanggan_tidak_puas', 'kelebihan_bayar', 'lainnya']
  );

  assert.equal(validasiAlasan(ALASAN_REFUND, 'barang_rusak', null), null);
  assert.match(validasiAlasan(ALASAN_REFUND, 'karangan', null), /alasan/i);

  assert.match(validasiAlasan(ALASAN_REFUND, 'lainnya', null), /10/);
  assert.match(validasiAlasan(ALASAN_REFUND, 'lainnya', 'pendek'), /10/);
  assert.equal(validasiAlasan(ALASAN_REFUND, 'lainnya', 'pelanggan pindah ke cabang lain'), null);
});
