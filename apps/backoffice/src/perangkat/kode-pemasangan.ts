/**
 * Kode pemasangan perangkat — B-28.
 *
 * Murni: tanpa DOM, tanpa jaringan. Yang di sini string masuk → string
 * keluar, jadi perjalanan pulang-pergi dapat diuji di `node --test`.
 *
 * ## ⛔ Kenapa BUKAN "PIN sementara"
 *
 * Perangkat kasir butuh ENAM nilai untuk tersambung
 * (`packages/sync-client/src/perangkat.ts`): `deviceId`, `deviceCode`,
 * `tenantId`, `outletId`, `baseUrl`, `tokenSecret`. Yang terakhir sendiri 43
 * karakter base64url dari CSPRNG — ia tidak dapat dipendekkan tanpa
 * memperlemah kredensialnya.
 *
 * PIN enam digit hanya dapat membawa satu nilai. Yang dapat membawa enam
 * adalah satu baris yang membungkus semuanya, dan itulah bentuk yang layar
 * K-15 kasir sudah sebut dengan namanya: *"kasir memindai/menempelkannya
 * sekali"*.
 *
 * ## ⛔ Ini BUKAN enkripsi
 *
 * Base64 bukan rahasia. Siapa pun yang memegang kode ini memegang secret
 * perangkat — persis seperti memegang secret-nya langsung. Ia dibungkus
 * supaya menjadi SATU hal yang disalin, bukan supaya aman disebar.
 *
 * Yang menahan penyalahgunaannya: secret hanya dapat dibaca SEKALI (respons
 * yang menerbitkannya), kredensial punya `credentials_expire_at`, dan
 * perangkat dapat dicabut kapan pun.
 *
 * ## Awalan versi
 *
 * `LUMI1.` ada supaya pembaca yang lebih baru dapat MENOLAK kode lama alih-
 * alih menerimanya separuh. Bentuk paketnya akan berubah — `schemaVersion`
 * atau kredensial perangkat yang berubah bentuk — dan perangkat yang
 * tersambung setengah gagal berhari-hari kemudian, di outlet.
 */

export interface KonfigPemasangan {
  deviceId: string;
  deviceCode: string;
  tenantId: string;
  outletId: string;
  baseUrl: string;
  tokenSecret: string;
}

const AWALAN = 'LUMI1.';

const WAJIB: readonly (keyof KonfigPemasangan)[] = [
  'deviceId',
  'deviceCode',
  'tenantId',
  'outletId',
  'baseUrl',
  'tokenSecret',
];

/**
 * base64url, tanpa padding.
 *
 * ⛔ Bukan `btoa` mentah: ia melempar untuk karakter di atas U+00FF, dan nama
 * outlet boleh memuat huruf beraksen. Teks dilewatkan UTF-8 lebih dulu.
 *
 * ⛔ Tanpa `=`, `+`, dan `/`: kode ini disalin dari layar back-office lalu
 * ditempel di tablet. Karakter yang dipotong pemilih teks atau diubah
 * aplikasi pesan membuat pemasangan gagal dengan cara yang mustahil
 * didiagnosis merchant.
 */
function keBase64Url(teks: string): string {
  const byte = new TextEncoder().encode(teks);
  let biner = '';
  for (const b of byte) biner += String.fromCharCode(b);
  return btoa(biner).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function dariBase64Url(kode: string): string | null {
  try {
    const b64 = kode.replace(/-/g, '+').replace(/_/g, '/');
    const biner = atob(b64);
    const byte = new Uint8Array(biner.length);
    for (let i = 0; i < biner.length; i += 1) byte[i] = biner.charCodeAt(i);
    return new TextDecoder().decode(byte);
  } catch {
    return null;
  }
}

export function bungkusKodePemasangan(konfig: Partial<KonfigPemasangan>): string {
  // Urutan kunci ditulis eksplisit, bukan diserahkan ke urutan properti
  // objek — kode yang sama harus menghasilkan string yang sama, dan itu yang
  // membuat "apakah ini kode yang sama" dapat dijawab dengan membandingkan.
  const paket: Record<string, unknown> = {};
  for (const k of WAJIB) paket[k] = konfig[k];
  return AWALAN + keBase64Url(JSON.stringify(paket));
}

/**
 * Membaca kode pemasangan, atau `null`.
 *
 * ⛔ Mengembalikan `null` untuk apa pun yang tidak berbentuk konfigurasi —
 * awalan salah, base64 rusak, JSON rusak, field hilang, field kosong.
 * Melempar berarti layar kasir jatuh karena satu karakter yang hilang saat
 * menyalin.
 *
 * Field KOSONG ditolak sama seperti field yang hilang: `baseUrl: ''` lolos
 * pemeriksaan "ada" tapi menghasilkan perangkat yang menembak alamat kosong.
 */
export function bukaKodePemasangan(kode: string): KonfigPemasangan | null {
  const bersih = String(kode ?? '').trim();
  if (!bersih.startsWith(AWALAN)) return null;

  const json = dariBase64Url(bersih.slice(AWALAN.length));
  if (json === null || json.length === 0) return null;

  let terurai: unknown;
  try {
    terurai = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof terurai !== 'object' || terurai === null) return null;

  const p = terurai as Record<string, unknown>;
  const hasil = {} as KonfigPemasangan;
  for (const k of WAJIB) {
    const nilai = p[k];
    if (typeof nilai !== 'string' || nilai.length === 0) return null;
    hasil[k] = nilai;
  }
  return hasil;
}
