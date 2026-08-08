'use strict';

// Connector PowerSync dan sumber token.
//
// Dua aturan mengikat diuji di sini, dan keduanya tentang hal yang TIDAK
// boleh terjadi:
//
//   1. Jalur naik PowerSync harus kosong. Kalau ia berisi, itu berarti jalur
//      naik kedua sudah lahir tanpa disengaja -- dan jalur itu tidak punya
//      idempotency, tidak punya penomoran struk, dan tidak pernah diuji.
//   2. Token TIDAK PERNAH dicetak di klien (keputusan user 8 Agustus 2026).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KONEKTOR = '../../apps/kasir/src/sync/konektor.ts';
const TOKEN = '../../apps/kasir/src/sync/token.ts';

test('antrean CRUD kosong: uploadData tidak melakukan apa-apa', async () => {
  const { tolakJalurNaikPowerSync } = await import(KONEKTOR);
  await tolakJalurNaikPowerSync({ getCrudBatch: async () => null });
  await tolakJalurNaikPowerSync({ getCrudBatch: async () => undefined });
});

// Kalau ini pernah menyala di produksi, ia menyala KERAS. Alternatifnya --
// menyelesaikan batch diam-diam -- membuang penulisan lokal tanpa jejak.
test('antrean CRUD berisi: gagal keras, tidak diselesaikan diam-diam', async () => {
  const { tolakJalurNaikPowerSync } = await import(KONEKTOR);
  let diselesaikan = false;
  await assert.rejects(
    tolakJalurNaikPowerSync({
      getCrudBatch: async () => ({
        crud: [{ op: 'PUT' }],
        complete: async () => {
          diselesaikan = true;
        },
      }),
    }),
    /jalur naik/i
  );
  assert.equal(diselesaikan, false, 'batch diselesaikan -- penulisan lokal terbuang diam-diam');
});

test('connector meneruskan kredensial dari sumber token, tanpa cache sendiri', async () => {
  const { buatConnector } = await import(KONEKTOR);
  let panggilan = 0;
  const connector = buatConnector({
    ambil: async () => {
      panggilan += 1;
      return { endpoint: 'http://sync.lokal', token: `t-${panggilan}` };
    },
  });

  assert.deepEqual(await connector.fetchCredentials(), {
    endpoint: 'http://sync.lokal',
    token: 't-1',
  });
  // PowerSync memanggil ulang saat token kedaluwarsa; connector yang meng-cache
  // sendiri akan menyodorkan token mati selamanya.
  assert.equal((await connector.fetchCredentials()).token, 't-2');
});

test('sumber token meminta ke server, tidak mencetak apa pun', async () => {
  const { buatSumberTokenServer } = await import(TOKEN);
  const panggilan = [];
  const sumber = buatSumberTokenServer({
    baseUrl: 'http://server.lokal',
    deviceId: 'dev-1',
    fetchFn: async (url, opsi) => {
      panggilan.push({ url, method: opsi.method });
      return { status: 200, json: async () => ({ endpoint: 'http://sync', token: 'jwt' }) };
    },
  });

  assert.deepEqual(await sumber.ambil(), { endpoint: 'http://sync', token: 'jwt' });
  assert.deepEqual(panggilan, [
    { url: 'http://server.lokal/devices/dev-1/sync-token', method: 'POST' },
  ]);
});

// Endpoint-nya belum ada. Yang penting bukan bahwa ia gagal, melainkan bahwa
// pesannya menjelaskan APA yang belum ada -- 404 telanjang akan terbaca
// seperti perangkat yang tidak terdaftar.
test('endpoint token belum ada: pesannya menyebut Modul F, bukan 404 telanjang', async () => {
  const { buatSumberTokenServer } = await import(TOKEN);
  const sumber = buatSumberTokenServer({
    baseUrl: 'http://server.lokal',
    deviceId: 'dev-1',
    fetchFn: async () => ({ status: 404, json: async () => ({}) }),
  });
  await assert.rejects(sumber.ambil(), /Modul F/);
});

test('respons tanpa token ditolak, bukan diteruskan sebagai kredensial kosong', async () => {
  const { buatSumberTokenServer } = await import(TOKEN);
  const sumber = buatSumberTokenServer({
    baseUrl: 'http://server.lokal',
    deviceId: 'dev-1',
    fetchFn: async () => ({ status: 200, json: async () => ({ endpoint: 'http://sync' }) }),
  });
  await assert.rejects(sumber.ambil(), /token/i);
});

// Penjaga terhadap kode, bukan terhadap niat. Prototipe 04 dan 05 mencetak JWT
// simetris DI BROWSER; kalau pola itu tersalin ke aplikasi, satu perangkat
// dapat mencetak token untuk tenant mana pun -- dan pada jalur turun, sync
// rules adalah satu-satunya yang menahannya.
test('tidak ada penandatanganan JWT di mana pun dalam kode klien', async () => {
  const dir = path.join(__dirname, '..', '..', 'apps', 'kasir', 'src');
  const terlarang = /\b(SubtleCrypto|crypto\.subtle|importKey|HS256|RS256|jsonwebtoken|SignJWT)\b/;

  const berkas = [];
  (function telusur(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) telusur(p);
      else if (/\.(ts|tsx)$/.test(e.name)) berkas.push(p);
    }
  })(dir);

  assert.ok(berkas.length > 5, `hanya ${berkas.length} berkas dipindai -- penjaga ini hampa`);
  for (const p of berkas) {
    const isi = fs.readFileSync(p, 'utf8');
    // Komentar dibuang: berkas token.ts MENJELASKAN larangan ini, dan
    // penjelasannya tidak boleh membuat penjaganya sendiri merah.
    const kode = isi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(
      !terlarang.test(kode),
      `${path.relative(dir, p)} tampak mencetak/menandatangani token di klien`
    );
  }
});
