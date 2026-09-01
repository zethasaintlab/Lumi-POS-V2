import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Penjaga STRUKTURAL: setiap layar kasir yang memuat datanya sendiri wajib
 * punya keadaan error.
 *
 * ## ⛔ Cacat yang melahirkannya
 *
 * K-03, K-08, K-12, dan K-15 memuat datanya di `useEffect` tanpa satu pun
 * `catch`. Pembacaan yang menolak meninggalkan `siap = false` selamanya, dan
 * yang kasir tatap adalah penanda MEMUAT — tidak dapat dibedakan dari memuat
 * yang sedang berjalan, tanpa batas waktu, tanpa tombol. Aturan design system
 * #7 menuntut keadaan kosong DAN error; keempatnya punya yang pertama saja.
 *
 * Tidak satu pun dari 515 test kasir merah karenanya, dan itu bukan kebetulan:
 * seluruhnya memanggil fungsi bacanya langsung. Yang hanya terlihat lewat
 * pohon React tidak terlihat test mana pun di repo ini.
 *
 * ## ⛔ Kenapa penjaga BERBASIS TEKS, dan batasnya
 *
 * Ia memeriksa bahwa berkasnya menyebut `GagalBaca` — bukan bahwa keadaannya
 * benar-benar dirender. Yang membuktikan itu adalah galeri komponen
 * (`harness-galeri.html`, skenario "Error"), dijalankan di browser. Penjaga
 * ini ada untuk layar BERIKUTNYA, yang ditulis orang yang tidak pernah membaca
 * cacat ini.
 *
 * Sabotase yang harus membuatnya merah: hapus `<GagalBaca …>` dari salah satu
 * layar.
 */

const DIR = new URL('../../apps/kasir/src/layar/', import.meta.url).pathname;

/**
 * Layar yang TIDAK memuat data lokal saat dibuka dikecualikan — dan daftarnya
 * ditulis dengan alasan per baris, bukan sebagai daftar nama.
 *
 * ⛔ Pengecualian yang alasannya tidak tertulis adalah tempat cacat berikutnya
 * bersembunyi: yang menambahkan nama ke sini besok tidak akan menjelaskan
 * kenapa, dan yang membacanya lusa tidak dapat menilai apakah masih benar.
 */
const DIKECUALIKAN = new Map([
  // Menerima datanya dari K-03 lewat props; tidak membaca apa pun sendiri.
  ['Bayar.tsx', 'menerima keranjang dari K-03'],
  ['Struk.tsx', 'menerima dokumen struk dari pemanggilnya'],
]);

function berkasLayar() {
  return readdirSync(DIR).filter((f) => f.endsWith('.tsx'));
}

test('setiap layar yang membaca db lokal punya keadaan error', () => {
  const tanpaKeadaanError = [];
  for (const berkas of berkasLayar()) {
    if (DIKECUALIKAN.has(berkas)) continue;
    const isi = readFileSync(join(DIR, berkas), 'utf8');
    // Layar yang tidak menyentuh database lokal tidak punya kewajiban ini.
    if (!isi.includes('useDbLokal')) continue;

    /* Dua bentuk yang sah, dan keduanya harus sah.
     *
     * `GagalBaca` menggantikan SELURUH layar, dan itu benar untuk layar yang
     * tanpa datanya tidak dapat berbuat apa pun (K-03, K-08, K-12, K-15).
     *
     * K-01 dan K-14 justru tidak boleh menghilang: keypad PIN harus tetap ada
     * supaya kasir dapat mencoba lagi, dan K-14 memuat empat bagian yang
     * kegagalan salah satunya tidak membatalkan sisanya. Keduanya karena itu
     * merender pesan di TEMPAT keadaan itu muncul. Penjaga menerima keduanya;
     * yang ia tolak adalah kegagalan yang tidak menghasilkan kalimat apa pun.
     */
    const punyaKeadaanError =
      isi.includes('<GagalBaca') || /\{gagal(Muat|Teknis)\b/.test(isi);
    if (!punyaKeadaanError) tanpaKeadaanError.push(berkas);
  }
  assert.deepEqual(
    tanpaKeadaanError,
    [],
    `Layar berikut membaca database lokal tanpa keadaan error (aturan DS #7). ` +
      `Pembacaan yang menolak akan meninggalkannya di penanda memuat selamanya: ` +
      tanpaKeadaanError.join(', ')
  );
});

test('pesan GagalBaca menyebut AKIBAT, bukan hanya nama galat', () => {
  const isi = readFileSync(
    new URL('../../apps/kasir/src/komponen/GagalBaca.tsx', import.meta.url).pathname,
    'utf8'
  );
  // `akibat` wajib dan tanpa nilai bawaan: bawaan yang benar untuk satu layar
  // akan tertinggal apa adanya di layar berikutnya.
  assert.match(isi, /akibat: string/, 'prop `akibat` harus wajib dan bertipe string');
  assert.doesNotMatch(isi, /akibat = /, 'prop `akibat` tidak boleh punya nilai bawaan');

  // Dan setiap pemanggil harus benar-benar mengisinya dengan kalimat, bukan
  // dengan nama galatnya.
  for (const berkas of berkasLayar()) {
    const layar = readFileSync(join(DIR, berkas), 'utf8');
    if (!layar.includes('<GagalBaca')) continue;
    const m = /<GagalBaca\s+akibat="([^"]+)"/.exec(layar);
    assert.ok(m, `${berkas}: <GagalBaca> harus memberikan prop \`akibat\` literal`);
    assert.ok(
      m[1].length > 40,
      `${berkas}: \`akibat\` terlalu pendek untuk menyebut akibat bagi kasir: ${m[1]}`
    );
  }
});
