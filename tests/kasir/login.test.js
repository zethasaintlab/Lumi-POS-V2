'use strict';

// §6 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- login PIN offline
// (FR-F3) dan penguncian (FR-F4).
//
// Murni: seluruh I/O lewat port `DbLokal`, waktu di-inject. Yang diuji di
// sini adalah keputusan, bukan layar.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/identitas/login.ts';

/** DbLokal palsu di atas peta sederhana. */
function dbPalsu({ pengguna = [], kunci = [] } = {}) {
  const state = { pengguna, kunci, ditulis: [] };
  return {
    state,
    async getAll(sql, params = []) {
      if (/FROM "user"/.test(sql)) {
        return state.pengguna.filter((u) => u.is_active === 1);
      }
      if (/FROM pin_lockout_lokal/.test(sql)) {
        return state.kunci.filter((k) => k.user_id === params[0]);
      }
      if (/FROM user_role/.test(sql)) {
        return state.pengguna.find((u) => u.id === params[0])?.peran ?? [];
      }
      if (/FROM sesi_lokal/.test(sql)) return state.sesi ? [state.sesi] : [];
      return [];
    },
    async execute(sql, params = []) {
      state.ditulis.push({ sql, params });
      if (/INSERT OR REPLACE INTO sesi_lokal|INSERT INTO sesi_lokal/.test(sql)) {
        state.sesi = { user_id: params[0], nama: params[1] };
      }
      if (/DELETE FROM sesi_lokal/.test(sql)) state.sesi = null;

      // ⛔ Fake ini harus benar-benar MEMODELKAN tabel penguncian, bukan
      // sekadar mencatat SQL-nya. Versi pertamanya hanya menyimpan pernyataan
      // ke `ditulis`, jadi hitungan gagal tidak pernah bertambah -- dan test
      // "5 gagal mengunci" akan gagal terus tanpa ada yang salah di kode
      // produksi. Fake yang tidak menyimpan state menguji pemanggilan, bukan
      // perilaku.
      if (/INSERT INTO pin_lockout_lokal/.test(sql)) {
        const [userId, gagal, sampai = null, jumlah = 0, jendela = null] = params;
        const ada = state.kunci.find((k) => k.user_id === userId);
        const baris = ada ?? { user_id: userId };
        baris.gagal_berturut = gagal;
        baris.terkunci_sampai = sampai;
        baris.jumlah_penguncian = jumlah;
        baris.jendela_mulai = jendela;
        if (!ada) state.kunci.push(baris);
      }
      if (/DELETE FROM pin_lockout_lokal/.test(sql)) {
        state.kunci = state.kunci.filter((k) => k.user_id !== params[0]);
      }
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2ExMg$dGFndGFndGFndGFndGFndGFndGFndGFndGFndGFndGFn';

function penggunaUji(over = {}) {
  return {
    id: 'u-sari',
    name: 'Sari',
    pin_hash: HASH,
    pin_must_change: 0,
    is_active: 1,
    peran: [{ role: 'cashier' }],
    ...over,
  };
}

/** Hasher palsu: PIN '482913' cocok dengan HASH, sisanya tidak. */
const hasherPalsu = {
  async hash(pin) {
    return `${HASH}#${pin}`;
  },
  async verifikasi(pin) {
    return pin === '482913';
  },
};

const JAM = () => new Date('2026-08-11T10:00:00.000Z');

// ---------------------------------------------------------------------------

test('login: PIN benar membuat sesi, tanpa jaringan sama sekali', async () => {
  const { masuk } = await import(MOD);
  const db = dbPalsu({ pengguna: [penggunaUji()] });

  const hasil = await masuk({ db, hasher: hasherPalsu, waktu: JAM, pin: '482913' });

  assert.equal(hasil.status, 'berhasil');
  assert.equal(hasil.sesi.userId, 'u-sari');
  assert.equal(hasil.sesi.nama, 'Sari');
  assert.deepEqual(hasil.sesi.peran, ['cashier']);
  assert.equal(db.state.sesi.user_id, 'u-sari');
});

test('login: PIN salah — pesan NETRAL, tidak menyebut apakah pengguna ada', async () => {
  const { masuk } = await import(MOD);

  // `spec-f:161`: "pesan netral: 'PIN salah' -- tidak menyebut apakah
  // pengguna ada". Perangkat kasir berdiri di ruang publik; pesan yang
  // membedakan "tidak ada" dari "salah" memberi tahu siapa pun yang berdiri
  // di sana PIN mana yang mendekati.
  const adaPengguna = await masuk({
    db: dbPalsu({ pengguna: [penggunaUji()] }),
    hasher: hasherPalsu,
    waktu: JAM,
    pin: '739154',
  });
  const tanpaPengguna = await masuk({
    db: dbPalsu({ pengguna: [] }),
    hasher: hasherPalsu,
    waktu: JAM,
    pin: '739154',
  });

  assert.equal(adaPengguna.status, 'pin_salah');
  assert.equal(tanpaPengguna.status, 'pin_salah');
  assert.equal(adaPengguna.pesan, tanpaPengguna.pesan, 'kedua pesan HARUS identik');
});

test('login: pengguna nonaktif tidak dapat masuk meski PIN benar', async () => {
  const { masuk } = await import(MOD);
  const db = dbPalsu({ pengguna: [penggunaUji({ is_active: 0 })] });

  // `spec-f:422`: "Kasir dinonaktifkan saat shift aktif -> shift berjalan
  // tetap dapat ditutup; login berikutnya ditolak."
  const hasil = await masuk({ db, hasher: hasherPalsu, waktu: JAM, pin: '482913' });
  assert.equal(hasil.status, 'pin_salah', 'dan pesannya tetap netral');
});

test('login: pengguna tanpa PIN dilewati, bukan dianggap cocok', async () => {
  const { masuk } = await import(MOD);
  // Akuntan dan owner yang hanya punya password ada di tabel yang sama.
  // `pin_hash` NULL yang lolos berarti siapa pun dapat masuk sebagai mereka.
  const db = dbPalsu({ pengguna: [penggunaUji({ pin_hash: null })] });
  const hasil = await masuk({ db, hasher: hasherPalsu, waktu: JAM, pin: '482913' });
  assert.equal(hasil.status, 'pin_salah');
});

test('FR-F4: 5 gagal berturut mengunci 60 detik, dan penguncian BERTAHAN', async () => {
  const { masuk } = await import(MOD);
  const db = dbPalsu({ pengguna: [penggunaUji()] });

  let hasil;
  for (let i = 0; i < 5; i += 1) {
    hasil = await masuk({ db, hasher: hasherPalsu, waktu: JAM, pin: '739154' });
  }
  assert.equal(hasil.status, 'terkunci');
  assert.equal(hasil.detikTersisa, 60);

  // ⛔ Ditulis ke TABEL, bukan disimpan di memori. `spec-f:226`: penguncian
  // tetap berlaku setelah perangkat di-restart. Penguncian yang hilang saat
  // restart dapat dilewati siapa pun yang dapat mematikan tablet.
  const tulisKunci = db.state.ditulis.filter((t) => /pin_lockout_lokal/.test(t.sql));
  assert.ok(tulisKunci.length > 0, 'penguncian WAJIB persisten');
});

test('FR-F4: penguncian yang sudah tersimpan menolak login SEBELUM PIN diperiksa', async () => {
  const { masuk } = await import(MOD);
  const db = dbPalsu({
    pengguna: [penggunaUji()],
    kunci: [
      {
        user_id: 'u-sari',
        gagal_berturut: 5,
        terkunci_sampai: '2026-08-11T10:00:30.000Z',
        jumlah_penguncian: 1,
        jendela_mulai: '2026-08-11T09:59:00.000Z',
      },
    ],
  });

  // PIN yang BENAR pun ditolak selama penguncian aktif — kalau tidak,
  // penguncian hanya memperlambat orang yang menebak, bukan menghentikannya.
  const hasil = await masuk({ db, hasher: hasherPalsu, waktu: JAM, pin: '482913' });
  assert.equal(hasil.status, 'terkunci');
  assert.equal(hasil.detikTersisa, 30, 'hitung mundur ditampilkan — spec-f:220');
  assert.equal(db.state.sesi, undefined, 'tidak boleh ada sesi');
});

test('FR-F4: penguncian PER PENGGUNA — kasir lain tidak ikut terhalang', async () => {
  const { masuk } = await import(MOD);

  // `spec-f:236`. Penguncian per perangkat akan membuat satu orang yang salah
  // ketik lima kali menghentikan seluruh outlet di tengah antrean.
  // Hash Budi HARUS berbeda dari Sari. Versi pertama test ini memberi keduanya
  // hash yang sama, dan PIN Budi cocok dengan baris Sari lebih dulu -- fake
  // yang melanggar aturan yang justru membuat alur ini benar: PIN unik per
  // outlet (`spec-f:126`), jadi dua hash tidak pernah cocok dengan PIN sama.
  const HASH_BUDI = HASH.replace('dGFn', 'YnVkaQ');
  const budi = penggunaUji({ id: 'u-budi', name: 'Budi', pin_hash: HASH_BUDI });
  const db = dbPalsu({
    pengguna: [penggunaUji(), budi],
    kunci: [
      {
        user_id: 'u-sari',
        gagal_berturut: 5,
        terkunci_sampai: '2026-08-11T10:00:30.000Z',
        jumlah_penguncian: 1,
        jendela_mulai: '2026-08-11T09:59:00.000Z',
      },
    ],
  });

  // Hasher yang mencocokkan PIN Budi, bukan Sari.
  const hasher = { ...hasherPalsu, verifikasi: async (pin, phc) => pin === '905172' && phc === HASH_BUDI };
  const hasil = await masuk({ db, hasher, waktu: JAM, pin: '905172' });

  assert.equal(hasil.status, 'berhasil');
  assert.equal(hasil.sesi.userId, 'u-budi', 'yang masuk harus Budi, bukan Sari yang terkunci');
});

test('FR-F4: penguncian ketiga dalam satu jam naik jadi 15 menit', async () => {
  const { hitungPenguncian } = await import(MOD);

  // `spec-f:229`. Diuji sebagai fungsi murni: menjalankan 15 login gagal
  // lewat `masuk` akan menguji hal yang sama dengan sepuluh kali lipat
  // gerakan.
  const sekarang = new Date('2026-08-11T10:00:00.000Z');
  const dalamJendela = { jumlah_penguncian: 2, jendela_mulai: '2026-08-11T09:30:00.000Z' };
  assert.equal(hitungPenguncian(dalamJendela, sekarang).detik, 900);

  const jendelaHabis = { jumlah_penguncian: 2, jendela_mulai: '2026-08-11T08:30:00.000Z' };
  assert.equal(hitungPenguncian(jendelaHabis, sekarang).detik, 60, 'jendela habis -> hitungan mulai lagi');
  assert.equal(hitungPenguncian(jendelaHabis, sekarang).jumlah, 1);

  assert.equal(hitungPenguncian(null, sekarang).detik, 60, 'penguncian pertama');
});

test('login berhasil mereset hitungan gagal', async () => {
  const { masuk } = await import(MOD);
  const db = dbPalsu({
    pengguna: [penggunaUji()],
    kunci: [{ user_id: 'u-sari', gagal_berturut: 3, terkunci_sampai: null, jumlah_penguncian: 0, jendela_mulai: null }],
  });

  const hasil = await masuk({ db, hasher: hasherPalsu, waktu: JAM, pin: '482913' });
  assert.equal(hasil.status, 'berhasil');

  const reset = db.state.ditulis.find((t) => /gagal_berturut = 0|DELETE FROM pin_lockout_lokal/.test(t.sql));
  assert.ok(reset, 'hitungan gagal harus direset');
});

test('login menandai wajib ganti PIN setelah reset manajer', async () => {
  const { masuk } = await import(MOD);
  const db = dbPalsu({ pengguna: [penggunaUji({ pin_must_change: 1 })] });

  // `spec-f:420`: PIN baru wajib diubah kasir saat login pertama. Sesinya
  // TETAP dibuat -- kasir harus dapat masuk untuk menggantinya.
  const hasil = await masuk({ db, hasher: hasherPalsu, waktu: JAM, pin: '482913' });
  assert.equal(hasil.status, 'berhasil');
  assert.equal(hasil.sesi.wajibGantiPin, true);
});

test('⛔ FR-H4: logout DIBLOKIR saat antrean tidak kosong', async () => {
  const { bolehLogout } = await import(MOD);

  // `spec-f:207`: "Logout diblokir saat antrean upload tidak kosong, dengan
  // pesan yang menjelaskan -- pelajaran dari Toast, di mana logout offline
  // mengunci pengguna."
  const diblokir = bolehLogout({ jumlahBelumTerkirim: 3 });
  assert.equal(diblokir.boleh, false);
  // Pesannya menyebut JUMLAH -- kasir yang tidak tahu berapa banyak tidak
  // dapat menilai apakah menunggu sebentar cukup.
  assert.match(diblokir.pesan, /3/);

  assert.equal(bolehLogout({ jumlahBelumTerkirim: 0 }).boleh, true);
});
