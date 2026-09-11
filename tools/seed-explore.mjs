/**
 * Seed eksplorasi — satu tenant lengkap, satu akun per peran.
 *
 * Jalankan:  node --env-file=.env tools/seed-explore.mjs
 *
 * Berbeda dari `tools/dev-seed.mjs`, yang menulis SQL langsung karena endpoint
 * yang dibutuhkannya belum ada. Skrip ini menembak API sungguhan untuk hampir
 * semuanya — katalog, stok, pengguna, outlet kedua — supaya data yang lahir
 * benar-benar melewati validasi, RLS, dan guard FK yang sama dengan produksi.
 *
 * Satu-satunya yang TIDAK lewat API adalah penetapan password. Lihat
 * `setelPassword` di bawah; alasannya panjang dan penting.
 *
 * Aman diulang: setiap run membuat tenant BARU. Ia tidak pernah menghapus apa
 * pun. Email pengguna diberi akhiran angka run supaya run kedua tidak
 * bertabrakan dengan run pertama — kecuali `--email-bersih`, lihat di bawah.
 */

import crypto from 'node:crypto';
import { buatPinHasher } from '../apps/server/src/modules/identity/pin-hasher.ts';
import pg from 'pg';

const API = process.env.SEED_API ?? 'http://localhost:3000';
const PASSWORD = 'password123';
const PIN_KASIR = '246810';

// Password bootstrap owner. `POST /tenants` menuntut FR-F2b, dan `password123`
// tidak memenuhinya — jadi owner lahir dengan password ini lalu diturunkan ke
// `PASSWORD` bersama yang lain di langkah terakhir.
const PASSWORD_BOOTSTRAP = 'Eksplorasi#2026Lumi';

const id = () => crypto.randomUUID();
const j = async (r) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

/**
 * ⛔ Penjaga localhost, dan ia bukan formalitas.
 *
 * Skrip ini menulis password lemah yang diketahui bocor ke tabel `user`.
 * Diarahkan ke database sungguhan, ia membuat lima akun yang dapat ditebak
 * siapa pun — termasuk akun Owner, yang memegang pengaturan pajak dan
 * tagihan. Karena itu ia menolak berjalan kecuali databasenya jelas-jelas
 * lokal, dan penolakannya keras.
 */
function pastikanLokal(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('DATABASE_URL tidak diset. Jalankan dengan --env-file=.env');
  }
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error(
      `Menolak jalan: DATABASE_URL menunjuk "${host}", bukan localhost.\n` +
        'Skrip ini menulis password yang diketahui bocor ke tabel user. ' +
        'Ia hanya untuk database eksplorasi di mesin sendiri.'
    );
  }
}

// ---------------------------------------------------------------------------
// Peran — DIBACA dari matriks, tidak ditulis ulang di sini
// ---------------------------------------------------------------------------

/**
 * ⛔ Diimpor dari `packages/domain/src/rbac.ts`, bukan disalin.
 *
 * `spec-f:83` menuntut "penambahan peran baru tidak memerlukan perubahan di
 * layar kasir", dan alasan yang sama berlaku di sini: daftar peran yang
 * ditulis tangan di skrip seed akan diam-diam ketinggalan satu peran, dan
 * yang menemukannya adalah orang yang mengira peran itu tidak ada.
 *
 * `CAKUPAN_TENANT` dan `CAKUPAN_SATU_OUTLET` ikut dibaca supaya cakupan tiap
 * akun benar tanpa ada yang perlu mengingat tabel `spec-f:152-157`.
 */
const { PERAN_DIKENAL, CAKUPAN_SATU_OUTLET } = await import(
  '../packages/domain/src/rbac.ts'
);
const { KUOTA_PAKET } = await import('../packages/domain/src/paket.ts');

const PERAN = [...PERAN_DIKENAL];

/**
 * Paket yang dinaikkan sebelum akun dibuat.
 *
 * ⛔ `POST /tenants` selalu mendaftar ke `free` — dan `free` memuat **1 outlet
 * dan 3 pengguna**. Lima peran tidak muat, dan outlet kedua ditolak `403`
 * sebelum pengguna pertama dibuat. Keduanya BUKAN bug: `research/09` § 6
 * menetapkan titik penegakannya, dan endpoint pendaftaran sengaja tidak
 * menerima nama paket dari body ("siapa pun memberi dirinya kuota tanpa batas
 * lewat satu field JSON").
 *
 * Tidak ada endpoint untuk menaikkan paket — B-29 hanya MEMBACA pemakaian.
 * Jadi kenaikannya ditulis lewat SQL, sejajar dengan `tools/dev-seed.mjs` yang
 * juga menulis langsung untuk baris yang belum punya endpoint. Angkanya
 * diambil dari `KUOTA_PAKET`, bukan diketik ulang — kuota seed yang menyimpang
 * dari kuota produk akan membuat batas diuji pada angka yang salah.
 */
const PAKET = 'pro';

/** Label untuk ringkasan di akhir. */
const LABEL = {
  owner: 'Owner',
  area_manager: 'Manajer Area',
  outlet_manager: 'Manajer Outlet',
  cashier: 'Kasir',
  accountant: 'Akuntan',
};

// ---------------------------------------------------------------------------
// Katalog — nama, harga, dan stok yang membuat B-12 punya sesuatu untuk diuji
// ---------------------------------------------------------------------------

/**
 * `stok` adalah saldo yang DIINGINKAN dalam satuan utuh, bukan jumlah yang
 * dimasukkan. Penjualan di bawah mengurangi sebagian, jadi angka masuknya
 * dihitung mundur — kalau tidak, "menipis" berubah jadi "aman" begitu resep
 * penjualannya disentuh.
 *
 * Ambang bawaan B-12 adalah 5 (`AMBANG_MENIPIS_BAWAAN`), jadi:
 *   > 5 → aman · 1..5 → menipis · 0 → habis · < 0 → minus
 */
const KATALOG = [
  {
    kategori: 'Kopi',
    item: [
      { nama: 'Kopi Susu Gula Aren', varian: [['Regular', 24000, 40], ['Large', 30000, 12]] },
      { nama: 'Americano', varian: [['Hot', 22000, 25], ['Iced', 25000, 4]] },
      { nama: 'Cappuccino', varian: [['Regular', 28000, 3]] },
      { nama: 'Kopi Tubruk ORIGEN', varian: [['Regular', 18000, 0]] },
      { nama: 'Cold Brew 500ml', varian: [['Botol', 45000, -2]] },
    ],
  },
  {
    kategori: 'Non-Kopi',
    item: [
      { nama: 'Matcha Latte', varian: [['Regular', 32000, 18], ['Large', 38000, 2]] },
      { nama: 'Cokelat Klasik', varian: [['Regular', 26000, 30]] },
      { nama: 'Teh Melati Dingin', varian: [['Regular', 15000, 5]] },
    ],
  },
  {
    kategori: 'Makanan',
    item: [
      { nama: 'Nasi Ayam Rica', varian: [['Porsi', 42000, 14]] },
      { nama: 'Roti Bakar Cokelat Keju', varian: [['Porsi', 27000, 1]] },
      { nama: 'Kentang Goreng Truffle', varian: [['Porsi', 35000, 0]] },
    ],
  },
  {
    kategori: 'Pastry',
    item: [
      { nama: 'Butter Croissant', varian: [['Pcs', 28000, 22]] },
      { nama: 'Pain au Chocolat', varian: [['Pcs', 32000, 3]] },
      { nama: 'Cinnamon Roll', varian: [['Pcs', 30000, 9]] },
      { nama: 'Banana Bread', varian: [['Slice', 24000, 0]] },
    ],
  },
];

/** Kuantitas yang benar-benar dijual, per NAMA varian penuh. Sisanya nol. */
const PENJUALAN = [
  ['Kopi Susu Gula Aren', 'Regular', 6],
  ['Kopi Susu Gula Aren', 'Large', 3],
  ['Americano', 'Iced', 4],
  ['Cappuccino', 'Regular', 5],
  ['Kopi Tubruk ORIGEN', 'Regular', 2],
  ['Cold Brew 500ml', 'Botol', 4],
  ['Matcha Latte', 'Regular', 3],
  ['Butter Croissant', 'Pcs', 2],
  ['Roti Bakar Cokelat Keju', 'Porsi', 3],
  ['Nasi Ayam Rica', 'Porsi', 2],
];

// ---------------------------------------------------------------------------

/**
 * Apakah layar masuk back-office dapat meresolusi tenant dari email ini?
 *
 * ⛔ Ia memanggil `resolve_login_tenant` — **fungsi yang sama persis** yang
 * `POST /auth/login` pakai. Menghitung sendiri (`SELECT count(*) FROM "user"
 * WHERE email = …`) akan menjadi sumber KEDUA yang memutuskan hal yang sama,
 * dan yang menyimpang di antara keduanya menghasilkan skrip yang berkata
 * "aman" untuk email yang layar masuknya tolak. Satu oracle, dua pemanggil.
 *
 * Skrip ini baru saja membuat pengguna ber-email itu, jadi "nol baris"
 * mustahil di sini — `NULL` hanya dapat berarti AMBIGU.
 */
async function emailDapatDiresolusi(alamat) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT resolve_login_tenant($1) AS tenant', [alamat]);
    return rows[0]?.tenant != null;
  } finally {
    await client.end();
  }
}

async function main() {
  pastikanLokal(process.env.DATABASE_URL);

  // Email BERSIH secara default: `owner@lumipos.test`, `cashier@lumipos.test`,
  // dan seterusnya — itu yang dapat diketik dari ingatan.
  //
  // ⛔ CATATAN LAMA DI SINI SALAH, dan salahnya memakan satu sesi penuh.
  //
  // Ia berbunyi: *"run kedua menabrak `EMAIL_TAKEN`, karena email unik lintas
  // tenant"*. Keduanya tidak benar, dan tidak pernah benar:
  //
  //  - Tidak ada `EMAIL_TAKEN` di seluruh `apps/server/src`.
  //  - Tidak ada index unik pada `"user".email`, dan **tidak dapat ada** tanpa
  //    melanggar isolasi tenant (migrasi `0023`). Satu orang yang bekerja di
  //    dua merchant adalah keadaan sah.
  //
  // Yang benar-benar terjadi pada run kedua: tenant kedua BERHASIL dibuat
  // dengan email owner yang sama, dan sejak itu `resolve_login_tenant`
  // mengembalikan `NULL` — sesuai rancangan, karena menebak salah satunya
  // berarti memasukkan orang ke tenant yang SALAH dengan password yang BENAR.
  //
  // `--unik` tetap ada untuk run berdampingan yang benar-benar terpisah.
  const cap = Math.floor(Math.random() * 9000 + 1000);
  const suffix = process.argv.includes('--unik') ? `+${cap}` : '';
  const email = (peran) => `${peran}${suffix}@lumipos.test`;

  // ⛔ DI-HOIST, dan itu bukan kerapian: tanpa variabel ini langkah 2 tidak
  // punya apa pun untuk dikirim sebagai `x-tenant-id`, dan satu-satunya jalan
  // yang tersisa baginya adalah meminta server MENEBAK tenant dari email —
  // tebakan yang gagal tepat pada run kedua.
  const tenantId = id();
  const outletUtamaId = id();
  const outletKeduaId = id();
  const ownerId = id();

  // --- 1. tenant + outlet pertama + owner -----------------------------------
  let r = await fetch(`${API}/tenants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenant: { id: tenantId, name: 'The Cafe by ORIGEN' },
      outlet: { id: outletUtamaId, name: 'ORIGEN Menteng', timezone: 'Asia/Jakarta' },
      owner: {
        id: ownerId,
        name: 'Pemilik ORIGEN',
        email: email('owner'),
        password: PASSWORD_BOOTSTRAP,
      },
    }),
  });
  if (r.status !== 201) {
    throw new Error(`POST /tenants gagal: ${r.status} ${JSON.stringify(await j(r))}`);
  }
  console.log('tenant + outlet + owner : 201');

  // --- 2. login owner --------------------------------------------------------
  //
  // ⛔ `x-tenant-id` DIKIRIM, dan ketiadaannya adalah sebab seluruh kegagalan
  // run kedua. Skrip ini BARU SAJA membuat tenantnya dan memegang idnya di
  // `tenantId`; meminta server meresolusinya kembali dari email adalah tebakan
  // yang tidak perlu ia lakukan — dan tebakan itu mengembalikan `NULL` begitu
  // email yang sama ada di dua tenant, keadaan yang run kedua ciptakan sendiri.
  //
  // Gejalanya `401 INVALID_CREDENTIALS` berpesan "Email atau password salah."
  // Pesan itu SATU untuk setiap sebab kegagalan (`spec-f:148`), jadi ia
  // terbaca sebagai password yang salah — dan memang pernah dicatat begitu,
  // sebagai cacat kedua yang sebenarnya tidak ada.
  //
  // Header ini DIHORMATI bila dikirim (`handlers/auth.ts`), jadi jalur
  // resolusi tidak berubah untuk siapa pun; yang berubah hanya skrip ini
  // berhenti bertanya tentang hal yang sudah diketahuinya.
  r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId },
    body: JSON.stringify({ email: email('owner'), password: PASSWORD_BOOTSTRAP }),
  });
  const sesi = await j(r);
  if (r.status !== 200) throw new Error(`login gagal: ${r.status} ${JSON.stringify(sesi)}`);

  const H = {
    'content-type': 'application/json',
    authorization: `Bearer ${sesi.token}`,
    'x-tenant-id': sesi.tenantId,
    'x-actor-id': sesi.userId,
  };
  console.log('login owner             :', r.status, sesi.roles);

  // --- 3. naikkan paket ------------------------------------------------------
  // Lihat komentar di `PAKET`. Tanpa ini, langkah berikutnya menabrak kuota
  // `free` dan seed berhenti dengan setengah data.
  const kuota = KUOTA_PAKET[PAKET];
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // `tenant` dikecualikan RLS — ia akar model tenancy.
    await db.query(
      `UPDATE tenant
          SET plan = $2, max_outlets = $3, max_devices = $4,
              max_users = $5, max_products = $6
        WHERE id = $1`,
      [
        sesi.tenantId,
        PAKET,
        kuota.maxOutlets,
        kuota.maxDevices,
        kuota.maxUsers,
        kuota.maxProducts,
      ]
    );
  } finally {
    await db.end();
  }
  // `null` berarti TANPA BATAS, dan mencetaknya apa adanya menghasilkan
  // "null outlet" — yang terbaca seperti kegagalan, bukan seperti tak
  // berbatas. Sejak KEP-38 tier berbayar memang tidak membatasi outlet.
  const batas = (n) => (n === null ? 'tanpa batas' : String(n));
  console.log(
    `paket                   : free → ${PAKET} ` +
      `(${batas(kuota.maxOutlets)} outlet · ${batas(kuota.maxUsers)} pengguna)`
  );

  // --- 4. outlet kedua -------------------------------------------------------
  // Dua outlet, bukan satu: penyaring outlet di B-01/B-12/B-16 hanya MUNCUL
  // saat ada lebih dari satu, jadi tenant satu-outlet menyembunyikan separuh
  // permukaan yang mau dieksplorasi.
  r = await fetch(`${API}/outlets`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      id: outletKeduaId,
      name: 'ORIGEN Kemang',
      timezone: 'Asia/Jakarta',
      address: 'Jl. Kemang Raya No. 12, Jakarta Selatan',
    }),
  });
  console.log('outlet kedua            :', r.status);

  // --- 4. katalog ------------------------------------------------------------
  const varian = new Map(); // "Item|Varian" -> { varId, harga, stok }
  for (const grup of KATALOG) {
    const catId = id();
    r = await fetch(`${API}/categories`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ id: catId, name: grup.kategori }),
    });
    if (r.status !== 201) console.log(`  kategori ${grup.kategori} GAGAL`, r.status);

    for (const it of grup.item) {
      const variations = it.varian.map(([nama, harga]) => ({
        id: id(),
        name: nama,
        price: String(harga),
        trackStock: true,
      }));
      r = await fetch(`${API}/items`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ id: id(), name: it.nama, categoryId: catId, variations }),
      });
      if (r.status !== 201) {
        console.log(`  item ${it.nama} GAGAL`, r.status, JSON.stringify(await j(r)).slice(0, 160));
        continue;
      }
      it.varian.forEach(([nama, harga, stok], i) => {
        varian.set(`${it.nama}|${nama}`, { varId: variations[i].id, harga, stok, item: it.nama });
      });
    }
  }
  console.log(`katalog                 : ${KATALOG.length} kategori · ${varian.size} varian`);

  // --- 5. stok masuk ---------------------------------------------------------
  // ⛔ Dihitung MUNDUR dari saldo yang diinginkan: masuk = target + terjual.
  // Menuliskan angka masuk langsung membuat setiap perubahan resep penjualan
  // diam-diam menggeser barang dari "menipis" ke "aman".
  const terjual = new Map(PENJUALAN.map(([i, v, q]) => [`${i}|${v}`, q]));
  for (const [kunci, v] of varian) {
    const masuk = v.stok + (terjual.get(kunci) ?? 0);
    if (masuk <= 0) continue; // saldo minus lahir dari penjualan tanpa barang masuk
    r = await fetch(`${API}/inventory/movements`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        outletId: outletUtamaId,
        variationId: v.varId,
        type: 'receipt',
        delta: String(masuk * 1000),
        note: 'Stok awal eksplorasi',
      }),
    });
    if (r.status !== 201) console.log(`  stok ${kunci} GAGAL`, r.status);
  }
  console.log('stok masuk              : selesai');

  // --- 6. device + shift + penjualan ----------------------------------------
  const devId = id();
  const devCode = 'K1';
  await fetch(`${API}/devices`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ id: devId, outletId: outletUtamaId, code: devCode, name: 'Kasir Depan' }),
  });

  // ⛔ Kredensial perangkat diterbitkan DI SINI, dan tanpa langkah ini aplikasi
  // kasir tidak dapat dipakai sama sekali.
  //
  // K-15 menuntut enam nilai: alamat server, tenant, outlet, id perangkat, kode
  // perangkat, dan SECRET. Lima yang pertama adalah UUID yang hanya ada di
  // dalam proses ini; yang keenam dikembalikan `POST /devices/{id}/credentials`
  // **sekali saja** — yang tersimpan di server hanya SHA-256-nya (FR-F12).
  //
  // Sebelum ini seed mencetak email dan PIN lalu berhenti, jadi satu-satunya
  // jalan menyiapkan kasir adalah menggali UUID lewat psql. Orang yang mencoba
  // produk ini pertama kali tidak akan menemukannya, dan yang ia simpulkan
  // adalah aplikasi kasirnya rusak.
  //
  // `-d '{}'`-nya bukan hiasan: body kosong dengan `content-type: application/json`
  // ditolak Fastify sebagai `FST_ERR_CTP_EMPTY_JSON_BODY`.
  let devSecret = null;
  r = await fetch(`${API}/devices/${devId}/credentials`, {
    method: 'POST',
    headers: H,
    body: '{}',
  });
  if (r.status === 201) {
    devSecret = (await j(r)).secret;
  } else {
    console.log('  kredensial perangkat GAGAL', r.status, JSON.stringify(await j(r)).slice(0, 160));
  }

  const hariIni = new Date().toISOString().slice(0, 10);
  const shiftId = id();
  r = await fetch(`${API}/shifts`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      id: shiftId,
      outletId: outletUtamaId,
      deviceId: devId,
      businessDate: hariIni,
      openingFloat: 500000,
    }),
  });
  console.log('device + shift          :', r.status);

  let seq = 0;
  const dibuat = [];
  for (const [namaItem, namaVarian, qty] of PENJUALAN) {
    const v = varian.get(`${namaItem}|${namaVarian}`);
    if (!v) continue;
    seq += 1;
    const orderId = id();
    r = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { ...H, 'idempotency-key': id() },
      body: JSON.stringify({
        id: orderId,
        outletId: outletUtamaId,
        deviceId: devId,
        shiftId,
        receiptNumber: `K1-${hariIni.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`,
        businessDate: hariIni,
        sequence: seq,
        channel: 'takeaway',
        checkId: id(),
        lines: [{ id: id(), variationId: v.varId, quantityMilli: qty * 1000 }],
      }),
    });
    if (r.status !== 201) {
      console.log(`  order ${namaItem} GAGAL`, r.status, JSON.stringify(await j(r)).slice(0, 160));
      continue;
    }
    dibuat.push({ orderId, nilai: v.harga * qty });
  }

  // Sebagian besar dibayar; satu dibatalkan dan satu direfund supaya B-02,
  // B-21, dan rincian dasbor punya isi yang tidak nol.
  for (const o of dibuat.slice(0, -2)) {
    r = await fetch(`${API}/orders/${o.orderId}/payments`, {
      method: 'POST',
      headers: { ...H, 'idempotency-key': id() },
      body: JSON.stringify({
        id: id(),
        method: 'cash',
        amount: o.nilai,
        tenderedAmount: o.nilai,
      }),
    });
    if (![200, 201].includes(r.status)) console.log('  bayar GAGAL', r.status);
  }
  console.log(`penjualan               : ${dibuat.length} order`);

  // --- 7. pengguna per peran -------------------------------------------------
  const akun = [{ peran: 'owner', userId: ownerId, email: email('owner') }];

  for (const peran of PERAN) {
    if (peran === 'owner') continue;
    const userId = id();
    // Cakupan dari matriks, bukan dari ingatan: peran satu-outlet mendapat
    // satu, sisanya mendapat keduanya. Mengirim dua outlet untuk kasir
    // ditolak `ROLE_SCOPE_TOO_WIDE`, dan itu memang benar.
    const satuOutlet = CAKUPAN_SATU_OUTLET.has(peran);
    const outletIds = satuOutlet ? [outletUtamaId] : [outletUtamaId, outletKeduaId];
    const scopeType = satuOutlet ? 'outlet' : 'tenant';
    const scopeId = satuOutlet ? outletUtamaId : sesi.tenantId;

    r = await fetch(`${API}/users`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        id: userId,
        name: `${LABEL[peran] ?? peran} ORIGEN`,
        email: email(peran),
        roles: [{ role: peran, scopeType, scopeId }],
        outletIds,
      }),
    });
    if (r.status !== 201) {
      console.log(`  user ${peran} GAGAL`, r.status, JSON.stringify(await j(r)).slice(0, 200));
      continue;
    }
    akun.push({ peran, userId, email: email(peran) });
  }
  console.log(`pengguna                : ${akun.length} akun`);

  // --- 8. PIN kasir ----------------------------------------------------------
  // Lewat endpoint sungguhan. PIN adalah jalur masuk kasir yang SAH
  // (`spec-f:150`); password bukan.
  const kasir = akun.find((a) => a.peran === 'cashier');
  if (kasir) {
    // ⛔ PUT, bukan PATCH. `rbac-rute.ts` menuliskan polanya tanpa metode yang
    // terlihat sekilas, dan OpenAPI-lah yang menentukan: keduanya `put`.
    // PATCH menjawab 404 "Route not found" — penolakan yang terbaca seperti
    // pengguna tidak ada, bukan seperti metode yang salah.
    r = await fetch(`${API}/users/${kasir.userId}/pin`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ pin: PIN_KASIR }),
    });
    console.log('PIN kasir               :', r.status);
  }

  // --- 9. password -----------------------------------------------------------
  const catatanPassword = await setelPassword(akun, H);

  // --- ringkasan -------------------------------------------------------------
  console.log('\n' + '='.repeat(66));
  console.log('  The Cafe by ORIGEN — siap dieksplorasi');
  console.log('='.repeat(66));
  console.log(`  Back office : ${API.replace('3000', '1422')}`);
  console.log(`  Owner (HP)  : ${API.replace('3000', '1423')}`);
  console.log(`  Kasir       : ${API.replace('3000', '1420')}`);
  console.log(`  Password    : ${PASSWORD}   (semua akun)`);
  console.log(`  PIN kasir   : ${PIN_KASIR}`);
  console.log(`  Tanggal     : ${hariIni}`);
  console.log('');
  for (const a of akun) {
    console.log(`  ${(LABEL[a.peran] ?? a.peran).padEnd(16)} ${a.email}`);
  }

  // ⛔ Layar masuk back-office meresolusi tenant DARI EMAIL, dan resolusi itu
  // mengembalikan NULL begitu email yang sama ada di lebih dari satu tenant
  // (migrasi `0023` — menebak berarti memasukkan orang ke tenant yang SALAH
  // dengan password yang BENAR). Skrip ini memakai email tetap, jadi run kedua
  // MEMBUAT keadaan itu sendiri.
  //
  // Skrip ini sudah kebal terhadapnya — ia mengirim id tenant yang ia pegang.
  // Yang TIDAK kebal adalah orang yang membaca daftar email di atas lalu
  // mengetikkannya ke layar masuk: ia menerima 401 berpesan "Email atau
  // password salah.", dan pesan itu SATU untuk setiap sebab kegagalan
  // (`spec-f:148`). Ia akan menyalahkan passwordnya — dan itu persis salah
  // baca yang memakan satu sesi penuh pada 2 September 2026.
  //
  // Jadi keadaan itu DISEBUTKAN di sini, dengan jalan keluarnya, bukan
  // dibiarkan ditemukan di layar masuk.
  if (!(await emailDapatDiresolusi(email('owner')))) {
    console.log('');
    console.log('  ⛔ Email di atas kini ada di LEBIH DARI SATU tenant.');
    console.log('     Layar masuk back-office TIDAK dapat meresolusinya dari email');
    console.log('     dan akan menjawab "Email atau password salah." — itu BUKAN');
    console.log('     password yang salah, melainkan tenant yang ambigu.');
    console.log('');
    console.log('     Dua jalan keluar:');
    console.log(`       1. Isi "ID Tenant" di layar masuk dengan: ${tenantId}`);
    console.log('       2. `npm run db:reset && npm run db:bootstrap && npm run db:migrate`');
    console.log('          lalu seed ulang — database eksplorasi kembali bersih.');
    console.log('');
    console.log('     `--unik` memberi setiap run email tersendiri bila kamu memang');
    console.log('     ingin beberapa merchant berdampingan.');
  }

  // Blok K-15. Dicetak sebagai daftar berlabel, bukan JSON: yang membacanya
  // MENGETIKNYA ulang ke enam bidang di layar perangkat, satu per satu.
  console.log('');
  console.log('  ' + '-'.repeat(62));
  console.log('  Aplikasi kasir → layar "Perangkat" (K-15), isi enam bidang ini:');
  console.log('  ' + '-'.repeat(62));
  console.log(`  Alamat server       ${API}`);
  console.log(`  Tenant              ${sesi.tenantId}`);
  console.log(`  Outlet              ${outletUtamaId}`);
  console.log(`  ID perangkat        ${devId}`);
  console.log(`  Kode perangkat      ${devCode}`);
  console.log(`  Kredensial          ${devSecret ?? '(GAGAL diterbitkan — lihat pesan di atas)'}`);
  console.log('');
  console.log('  ⛔ Kredensial di atas TIDAK dapat dibaca lagi. Server hanya');
  console.log('     menyimpan SHA-256-nya (FR-F12). Kehilangannya berarti');
  console.log('     menerbitkan ulang, dan penerbitan ulang mematikan yang lama.');
  console.log('  Simpan, lalu MUAT ULANG aplikasi kasir — sinkronisasi menyala');
  console.log('  saat aplikasi dimuat, bukan saat pengaturan disimpan.');
  console.log('');
  console.log(`  Outlet kedua (tanpa transaksi): ${outletKeduaId}`);
  console.log('');
  for (const baris of catatanPassword) console.log(`  ${baris}`);
  console.log('='.repeat(66));
}

/**
 * Menetapkan password untuk setiap akun.
 *
 * ## ⛔ Kenapa ada jalur yang MELEWATI API
 *
 * `password123` ada di dalam `PASSWORD_BOCOR` (`packages/domain/src/password.ts`)
 * — daftar yang sengaja dibundel untuk FR-F2b. `PUT /users/{id}/password`
 * karena itu menjawab `400 PASSWORD_BREACHED`, dan itu **perilaku yang benar**.
 * Kontrolnya bekerja persis seperti seharusnya.
 *
 * Jadi skrip ini mencoba API dulu, dan hanya menulis hash langsung ke tabel
 * bila API menolaknya karena bocor. Urutan itu disengaja:
 *
 *  - Kalau kelak daftarnya berubah, atau password default diganti dengan yang
 *    memenuhi aturan, skrip ini otomatis kembali ke jalur yang sah tanpa ada
 *    yang perlu ingat menghapus bypass-nya.
 *  - Penolakan LAIN (terlalu pendek, pengguna tidak ditemukan) tidak di-bypass
 *    — ia dilaporkan. Bypass yang menelan semua penolakan adalah bypass yang
 *    menyembunyikan bug.
 *
 * Hash-nya dibuat `buatPinHasher()` yang SAMA dengan yang server pakai, jadi
 * parameter Argon2id-nya tidak dapat menyimpang dan login sungguhan
 * benar-benar memverifikasinya.
 *
 * Bahwa ini melangkahi kontrol produk adalah alasan `pastikanLokal` ada di
 * atas berkas ini.
 */
async function setelPassword(akun, H) {
  const catatan = [];
  const hasher = buatPinHasher();
  let lewatApi = 0;
  let lewatHash = 0;

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const taatSpec = process.argv.includes('--taat-spec');

  try {
    for (const a of akun) {
      // ⛔ Kasir dengan password DAPAT masuk back office — `login` hanya
      // menyaring `password_hash IS NOT NULL` dan tidak memeriksa peran sama
      // sekali. Yang menegakkan `spec-f:150` adalah kenyataan bahwa kasir
      // tidak pernah diberi password; memberinya satu di sini membuka pintu
      // yang produksi tutup. Diberikan karena diminta eksplisit, dan dapat
      // dimatikan dengan `--taat-spec`.
      if (a.peran === 'cashier' && taatSpec) {
        catatan.push('Password kasir DILEWATI (--taat-spec). Ia masuk lewat PIN.');
        continue;
      }

      const r = await fetch(`${API}/users/${a.userId}/password`, {
        method: 'PUT', // ⛔ PUT, bukan PATCH — lihat catatan di langkah PIN.
        headers: H,
        body: JSON.stringify({ password: PASSWORD }),
      });
      if (r.status === 204) {
        lewatApi += 1;
        continue;
      }

      const galat = await j(r);
      const kode = galat?.error?.code;
      if (kode !== 'PASSWORD_BREACHED') {
        console.log(`  password ${a.peran} GAGAL`, r.status, JSON.stringify(galat).slice(0, 200));
        continue;
      }

      // RLS: `app.tenant_id` di-SET LOCAL per transaksi, sama seperti aplikasi.
      const phc = await hasher.hash(PASSWORD);
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [H['x-tenant-id']]);
      const hasil = await client.query(
        'UPDATE "user" SET password_hash = $2 WHERE id = $1 RETURNING id',
        [a.userId, phc]
      );
      await client.query('COMMIT');
      if (hasil.rowCount === 1) lewatHash += 1;
      else console.log(`  password ${a.peran} tidak tertulis (RLS?)`);
    }
  } finally {
    await client.end();
  }

  if (lewatApi > 0) catatan.push(`${lewatApi} password diset lewat API.`);
  if (lewatHash > 0) {
    catatan.push(
      `⛔ ${lewatHash} password ditulis LANGSUNG ke tabel — API menolak "${PASSWORD}"`
    );
    catatan.push('   karena ia ada di daftar password bocor FR-F2b. Kontrolnya benar;');
    catatan.push('   yang dilewati hanya untuk database eksplorasi lokal ini.');
  }
  catatan.push('');
  catatan.push('⛔ Akun kasir DAPAT masuk back office di data seed ini, dan di');
  catatan.push('   produksi ia tidak boleh. Yang menegakkan spec-f:150 adalah');
  catatan.push('   kenyataan bahwa kasir tidak pernah DIBERI password sama sekali —');
  catatan.push('   `login` hanya menyaring `password_hash IS NOT NULL`, tanpa');
  catatan.push('   memeriksa peran. Memberinya password membuka pintu itu.');
  catatan.push(`   Jalur kasir yang sah: PIN ${PIN_KASIR} di aplikasi kasir.`);
  catatan.push('   Jalankan dengan --taat-spec untuk melewati password kasir.');
  return catatan;
}

await main();
