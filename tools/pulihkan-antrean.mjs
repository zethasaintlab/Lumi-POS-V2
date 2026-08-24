/**
 * Alat koreksi F6 — memutar ulang ekspor pemulihan ke server.
 *
 * Jalankan:
 *   node tools/pulihkan-antrean.mjs <berkas.json> --tenant <id> [--server URL]
 *   node tools/pulihkan-antrean.mjs <berkas.json> --tenant <id> --penyetuju <id>
 *   node tools/pulihkan-antrean.mjs <berkas.json> --tenant <id> --kering
 *
 * Gate F6 (`ARCH:400`): *"alat koreksi ada **sebelum** insiden pertama."*
 *
 * ## Kapan ini dipakai
 *
 * Perangkat rusak, hilang, atau di-reset dengan penjualan yang belum terkirim.
 * Ekspor **teks** (K-14) dapat dibaca orang tapi tidak dapat dikirim ulang;
 * satu-satunya jalan memasukkan penjualannya kembali adalah mengetiknya ulang
 * dari kertas — untuk transaksi yang uangnya sudah masuk laci merchant.
 *
 * Ekspor **JSON** (K-14, tombol kedua) memuat payload dan idempotency key apa
 * adanya, dan alat ini mengirimkannya lewat endpoint REST yang SAMA yang
 * dipakai relay outbox.
 *
 * ## ⛔ Kenapa ini TIDAK melanggar invariant #2
 *
 * Ia tidak meng-`UPDATE` apa pun. Ia mengirim penjualan yang **belum pernah
 * sampai** lewat jalur normalnya, dengan id dan idempotency key aslinya.
 * Server memperlakukannya persis seperti perangkat yang akhirnya online.
 *
 * ## ⛔ Aman dijalankan DUA KALI
 *
 * Itu sifat yang harus dimiliki alat yang dipakai orang panik. Idempotency key
 * ikut di berkas, jadi item yang sebenarnya sudah sampai dijawab dengan
 * respons aslinya alih-alih menghasilkan penjualan kedua.
 *
 * ⛔ Key yang di-generate ulang di sini akan menghasilkan penjualan GANDA pada
 * setiap item yang sudah sampai. Jangan pernah.
 *
 * ## Urutan
 *
 * Item dikirim BERURUTAN dan mengikuti urutan di berkas (`created_at, id`).
 * `payment` menunjuk order yang harus ada lebih dulu; mengirim paralel membuat
 * sebagiannya 404 karena induknya belum mendarat.
 */

import { readFileSync } from 'node:fs';

const RUTE = {
  shift: () => '/shifts',
  order: () => '/orders',
  order_cancel: (id) => `/orders/${encodeURIComponent(id)}/cancel`,
  payment: (id) => `/orders/${encodeURIComponent(id)}/payments`,
  sold_out: () => '/inventory/sold-out',
  // FR-D7. `entityId`-nya adalah id SHIFT — rutenya bersarang di bawahnya.
  no_sale: (id) => `/shifts/${encodeURIComponent(id)}/no-sale`,
  cash_movement: (id) => `/shifts/${encodeURIComponent(id)}/cash-movements`,
  count_attempt: (id) => `/shifts/${encodeURIComponent(id)}/count-attempts`,
};

function argumen(nama, bawaan) {
  const i = process.argv.indexOf(`--${nama}`);
  if (i === -1) return bawaan;
  return process.argv[i + 1];
}

const berkas = process.argv[2];
const tenantId = argumen('tenant');
const server = argumen('server', process.env.LUMI_API ?? 'http://localhost:3000');
/**
 * Penyetuju CADANGAN untuk item yang barisnya tidak membawanya.
 *
 * Dipakai hanya oleh refund dari perangkat yang databasenya dibuat sebelum
 * `outbox_local.approver_id` ada. Item yang membawa penyetujunya sendiri
 * selalu menang atas nilai ini.
 */
const penyetuju = argumen('penyetuju', null);
const kering = process.argv.includes('--kering');

if (!berkas || !tenantId) {
  console.error(
    'Pemakaian: node tools/pulihkan-antrean.mjs <berkas.json> --tenant <id> [--server URL] [--penyetuju <id>] [--kering]'
  );
  process.exit(2);
}

const ekspor = JSON.parse(readFileSync(berkas, 'utf8'));

if (ekspor.versi !== 1) {
  console.error(`Versi ekspor ${ekspor.versi} tidak dikenal. Alat ini membaca versi 1.`);
  process.exit(2);
}

// ⛔ Diperiksa SEBELUM satu permintaan pun dikirim. Berkas yang memuat satu
// jenis tanpa rute akan berhenti di tengah, dan berhenti di tengah adalah
// keadaan yang paling sulit dijelaskan kepada merchant: sebagian penjualannya
// masuk, sebagian tidak, dan tidak ada yang tahu batasnya di mana.
const asing = [...new Set(ekspor.item.map((i) => i.entityType))].filter((t) => !RUTE[t]);
if (asing.length > 0) {
  console.error(`Jenis tanpa endpoint: ${asing.join(', ')}. Tidak ada yang dikirim.`);
  process.exit(2);
}

console.log(`Perangkat  : ${ekspor.deviceCode}`);
console.log(`Dibuat     : ${ekspor.dibuatPada}`);
console.log(`Item       : ${ekspor.item.length}`);
console.log(`Server     : ${server}`);
console.log(`Tenant     : ${tenantId}`);
console.log(kering ? 'Mode       : KERING (tidak mengirim apa pun)\n' : '');

const hasil = { terkirim: 0, sudahAda: 0, gagal: 0 };
const gagal = [];

for (const [n, item] of ekspor.item.entries()) {
  const jalur = RUTE[item.entityType](item.entityId);
  const label = `${n + 1}/${ekspor.item.length} ${item.entityType} ${item.entityId}`;

  if (kering) {
    console.log(`[kering] ${label} → POST ${jalur}`);
    continue;
  }

  let res;
  try {
    res = await fetch(`${server}${jalur}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
        // ⛔ Aktor dari BARIS, bukan dari operator yang menjalankan alat ini.
        // Antrean yang dipulihkan harus tetap menisbatkan penjualan kepada
        // kasir yang benar-benar melakukannya — sama seperti relay.
        'X-Actor-Id': item.actorId ?? '',
        // ⛔ Penyetuju dari BARIS, dengan `--penyetuju` sebagai cadangan.
        //
        // Cadangannya bukan kenyamanan: `outbox_local.approver_id` baru ada
        // sejak 21 Agustus 2026, dan refund yang dibuat perangkat SEBELUM
        // pembaruan itu tidak menyimpan penyetuju di mana pun. Berkas
        // pemulihannya karena itu tidak dapat memuatnya, dan satu-satunya
        // jalan memutar ulang refund itu adalah operator menyebutkan
        // penyetujunya — yang memang tercatat di struk dan di ingatan orang
        // yang berdiri di sana.
        //
        // Header KOSONG lebih buruk daripada tidak ada: `getApproverId`
        // menolaknya dengan pesan yang sama.
        ...(item.approverId || penyetuju
          ? { 'X-Approver-Id': item.approverId ?? penyetuju }
          : {}),
        // ⛔ Key ASLI. Lihat komentar kepala berkas.
        'Idempotency-Key': item.idempotencyKey,
      },
      // ⛔ Payload APA ADANYA, tidak diurai lalu dirangkai ulang.
      body: item.payload,
    });
  } catch (e) {
    hasil.gagal += 1;
    gagal.push(`${label}: jaringan — ${e.name}`);
    console.error(`✖ ${label}: jaringan`);
    continue;
  }

  if (res.status >= 200 && res.status < 300) {
    hasil.terkirim += 1;
    console.log(`✔ ${label} → ${res.status}`);
    continue;
  }

  const teks = await res.text();
  let kode = '';
  try {
    kode = JSON.parse(teks).error?.code ?? '';
  } catch {
    kode = '';
  }

  // Item yang SUDAH ada bukan kegagalan — ia justru bukti idempotensi
  // bekerja. Menghitungnya sebagai gagal membuat operator mengulang
  // pemulihan yang sudah berhasil.
  //
  // ⛔ HANYA `ID_ALREADY_EXISTS`, bukan setiap 409. Versi pertama alat ini
  // memperlakukan semua 409 begitu, dan itu ditemukan saat menjalankannya
  // terhadap server sungguhan: `POST /shifts` menjawab
  // `409 SHIFT_ALREADY_OPEN` — perangkat itu punya shift LAIN yang masih
  // terbuka — dan alatnya melaporkan "sudah ada di server". Shift-nya tidak
  // pernah dibuat, order berikutnya gagal `SHIFT_NOT_FOUND`, dan ringkasannya
  // menyebut satu keberhasilan yang tidak pernah terjadi.
  //
  // Sukses karena alasan yang salah adalah bentuk kegagalan terburuk untuk
  // alat pemulihan: operator menutup insiden dengan penjualan yang masih
  // hilang.
  if (kode === 'ID_ALREADY_EXISTS') {
    hasil.sudahAda += 1;
    console.log(`• ${label} → sudah ada di server`);
    continue;
  }

  hasil.gagal += 1;
  gagal.push(`${label}: HTTP ${res.status} ${kode} ${teks.slice(0, 200)}`);
  console.error(`✖ ${label} → HTTP ${res.status} ${kode}`);
}

console.log('');
console.log(`Terkirim   : ${hasil.terkirim}`);
console.log(`Sudah ada  : ${hasil.sudahAda}`);
console.log(`Gagal      : ${hasil.gagal}`);

if (gagal.length > 0) {
  console.log('\nYang gagal — SIMPAN berkas ekspornya, jangan dibuang:');
  for (const g of gagal) console.log(`  ${g}`);

  // ⛔ Petunjuk untuk kegagalan yang paling sering, dan yang paling mudah
  // salah dibaca sebagai kerusakan data.
  if (gagal.some((g) => g.includes('SHIFT_ALREADY_OPEN'))) {
    console.log(
      '\n⛔ SHIFT_ALREADY_OPEN: perangkat itu punya shift LAIN yang masih terbuka di server.\n' +
        '   Shift dari berkas ini TIDAK dibuat, dan order yang menunjuknya akan gagal 404.\n' +
        '   Tutup shift yang terbuka itu lebih dulu (B-04), lalu jalankan ulang alat ini.'
    );
  }
  if (gagal.some((g) => g.includes('SHIFT_NOT_FOUND'))) {
    console.log(
      '\n⛔ SHIFT_NOT_FOUND: order menunjuk shift yang belum mendarat. Perbaiki kegagalan\n' +
        '   shift di atas lebih dulu — urutan di berkas ini memang menempatkannya duluan.'
    );
  }
  process.exit(1);
}
