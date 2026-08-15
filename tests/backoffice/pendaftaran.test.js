'use strict';

// B-00b — muatan pendaftaran merchant.
//
// Murni: form masuk → muatan `POST /tenants` keluar. Tidak ada DOM dan tidak
// ada jaringan di sini, jadi seluruh aturannya dapat diuji di `node --test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/daftar/pendaftaran.ts';

const IDENTITAS = {
  tenantId: '018f2a10-0000-7000-8000-000000000001',
  outletId: '018f2a10-0000-7000-8000-000000000002',
  ownerId: '018f2a10-0000-7000-8000-000000000003',
};

const FORM = {
  namaMerchant: 'Kopi Lumi',
  namaOutlet: 'Cabang Sudirman',
  zonaWaktu: 'Asia/Jakarta',
  namaOwner: 'Sri Wahyuni',
  email: 'sri@kopilumi.id',
  password: 'kopi susu gula aren',
};

// ---------------------------------------------------------------------------

test('form lengkap menghasilkan muatan yang bentuknya sesuai POST /tenants', async () => {
  const { buatMuatanPendaftaran } = await import(MOD);
  const hasil = buatMuatanPendaftaran(FORM, IDENTITAS);

  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.deepEqual(hasil.muatan, {
    tenant: { id: IDENTITAS.tenantId, name: 'Kopi Lumi' },
    outlet: {
      id: IDENTITAS.outletId,
      name: 'Cabang Sudirman',
      timezone: 'Asia/Jakarta',
      address: null,
    },
    owner: {
      id: IDENTITAS.ownerId,
      name: 'Sri Wahyuni',
      email: 'sri@kopilumi.id',
      password: 'kopi susu gula aren',
    },
  });
});

test('⛔ id TIDAK di-generate di dalam fungsi — ia diterima dari luar', async () => {
  // Ini yang membuat percobaan ULANG aman.
  //
  // `POST /tenants` idempoten HANYA lewat PK `tenant.id` (lihat
  // `register.ts`): id yang sama diulang menjawab 409, id BARU menghasilkan
  // tenant KEDUA. Kalau fungsi ini memanggil `randomUUID()` sendiri, merchant
  // yang menekan "Daftar" dua kali karena responsnya lambat mendapat dua
  // tenant — dan yang kedua tidak dapat dihapus lewat API mana pun.
  const { buatMuatanPendaftaran } = await import(MOD);
  const a = buatMuatanPendaftaran(FORM, IDENTITAS);
  const b = buatMuatanPendaftaran({ ...FORM, namaMerchant: 'Kopi Lumi ' }, IDENTITAS);

  assert.deepEqual(a.muatan, b.muatan, 'muatan berubah untuk identitas yang sama');
});

test('spasi di tepi dipangkas — nama merchant tidak diketik dua kali', async () => {
  const { buatMuatanPendaftaran } = await import(MOD);
  const hasil = buatMuatanPendaftaran(
    { ...FORM, namaMerchant: '  Kopi Lumi  ', email: ' sri@kopilumi.id ' },
    IDENTITAS
  );
  assert.equal(hasil.muatan.tenant.name, 'Kopi Lumi');
  assert.equal(hasil.muatan.owner.email, 'sri@kopilumi.id');
});

test('⛔ password TIDAK dipangkas', async () => {
  // Spasi di tepi adalah karakter password yang sah, dan memangkasnya membuat
  // password yang diterima saat mendaftar ditolak saat masuk — di jalur yang
  // menjawab satu pesan yang sama untuk setiap sebab, jadi merchant tidak
  // akan pernah tahu kenapa.
  const { buatMuatanPendaftaran } = await import(MOD);
  const hasil = buatMuatanPendaftaran({ ...FORM, password: ' kopi susu gula aren ' }, IDENTITAS);
  assert.equal(hasil.muatan.owner.password, ' kopi susu gula aren ');
});

test('setiap field wajib yang kosong ditolak, dan penolakannya MENUNJUK fieldnya', async () => {
  // Pesan tanpa field membuat form panjang menampilkan satu error merah di
  // bawah tombol, dan merchant memeriksa keenam isian satu per satu.
  const { buatMuatanPendaftaran } = await import(MOD);
  for (const bidang of ['namaMerchant', 'namaOutlet', 'namaOwner', 'email']) {
    const hasil = buatMuatanPendaftaran({ ...FORM, [bidang]: '   ' }, IDENTITAS);
    assert.equal(hasil.ok, false, `${bidang} kosong diterima`);
    assert.equal(hasil.bidang, bidang);
    assert.ok(hasil.pesan.length > 0);
  }
});

test('⛔ aturan password memakai FUNGSI domain, bukan salinannya', async () => {
  // `packages/domain/src/password.ts` adalah satu-satunya definisi FR-F2b, dan
  // `POST /tenants` menegakkannya di server. Salinan di klien akan menyimpang
  // — dan yang menyimpang di sini menghasilkan form yang menerima password
  // lalu server menolaknya, atau sebaliknya.
  const { buatMuatanPendaftaran } = await import(MOD);
  const { periksaPassword } = await import('../../packages/domain/src/password.ts');

  for (const password of ['pendek', 'password123', 'indonesia123', '1234567890']) {
    const domain = periksaPassword(password);
    const hasil = buatMuatanPendaftaran({ ...FORM, password }, IDENTITAS);

    assert.equal(hasil.ok, domain.ok, `beda putusan untuk "${password}"`);
    if (!domain.ok) {
      assert.equal(hasil.bidang, 'password');
      assert.equal(hasil.pesan, domain.pesan, 'pesan klien menyimpang dari pesan domain');
    }
  }
});

test('⛔ zona waktu di luar daftar ditolak — CHECK constraint menjawab 500', async () => {
  // `db/migrations/0002_tenancy.sql` punya CHECK untuk kolom ini. Yang
  // dibedakan: CHECK menjawab lewat error PostgreSQL yang tidak dikenal,
  // sementara penolakan di sini menyebut pilihan yang sah.
  const { buatMuatanPendaftaran } = await import(MOD);
  const hasil = buatMuatanPendaftaran({ ...FORM, zonaWaktu: 'Asia/Singapore' }, IDENTITAS);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'zonaWaktu');
});

test('⛔ daftar zona waktu klien SAMA dengan yang ditegakkan server', async () => {
  // Tiga salinan daftar ini sudah ada (dua handler server, OpenAPI, dan CHECK
  // di migrasi). Yang keempat di klien akan menyimpang tanpa satu pun error:
  // pilihan yang hilang membuat outlet Indonesia Timur mustahil didaftarkan,
  // pilihan yang ditambahkan menghasilkan 500 saat merchant memilihnya.
  const { ZONA_WAKTU } = await import('../../packages/domain/src/zona-waktu.ts');
  const { readFileSync } = require('node:fs');

  const sql = readFileSync('db/migrations/0002_tenancy.sql', 'utf8');
  const cocok = sql.match(/timezone\s+text NOT NULL CHECK \(timezone IN \(([^)]+)\)\)/);
  assert.ok(cocok, 'CHECK timezone tidak ditemukan di migrasi 0002');

  const dariSql = cocok[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual([...ZONA_WAKTU].sort(), dariSql.sort());
});

test('alamat opsional ikut bila diisi, dan null bila tidak', async () => {
  const { buatMuatanPendaftaran } = await import(MOD);
  assert.equal(buatMuatanPendaftaran(FORM, IDENTITAS).muatan.outlet.address, null);
  assert.equal(
    buatMuatanPendaftaran({ ...FORM, alamat: ' Jl. Sudirman 1 ' }, IDENTITAS).muatan.outlet.address,
    'Jl. Sudirman 1'
  );
});
