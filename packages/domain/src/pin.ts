/**
 * Aturan PIN kasir (FR-F2, `product/specs/spec-f-rbac-audit.md` §F.2).
 *
 * ## Kenapa di packages/domain
 *
 * AC `spec-f:206` menuntut login berhasil "dengan jaringan dimatikan
 * sepenuhnya". Klien karena itu memvalidasi bentuk PIN dan menolak PIN lemah
 * tanpa bertanya ke siapa pun — dan kalau aturannya hidup di handler REST,
 * perangkat akan menerima PIN yang server tolak. Selisih itu baru terlihat
 * saat sinkronisasi, berbulan-bulan setelah PIN dipakai.
 *
 * Murni: tanpa I/O, tanpa waktu, tanpa database.
 *
 * ## Yang SENGAJA tidak ada di sini: hashing
 *
 * `node:crypto` tidak ada di webview, dan berkas ini harus dapat dimuat
 * keduanya. Hashing hidup di balik port `PengunciPin` (`kunci-pin.ts`);
 * yang ada di sini hanya aturan dan format penyimpanannya.
 *
 * ## PIN bukan batas keamanan
 *
 * `spec-f:118` menyatakannya, dan itu mengubah cara berkas ini harus dibaca:
 * keamanan perangkat berasal dari token yang dapat dicabut (FR-F12) dan
 * keberadaan fisik perangkat di outlet. PIN menjawab pertanyaan berbeda —
 * *siapa di antara staf outlet ini yang sedang mengoperasikan*. Itu
 * **atribusi**. Aturan di bawah menjaga atribusi tetap berarti, bukan menahan
 * penyerang.
 */

export const PIN_LENGTH = 6;

/**
 * Parameter Argon2id. SATU sumber untuk server dan klien.
 *
 * Mengikuti rekomendasi OWASP untuk Argon2id (19 MiB, 2 pass, p=1). Diukur
 * dengan `node:crypto` di mesin pengembangan: **23 ms per hash**.
 *
 * Angkanya diuji di `tests/domain/pin.test.js`, dan itu disengaja: menurunkan
 * `memory` adalah cara termurah membuat verifikasi PIN terasa cepat, dan
 * satu-satunya yang mencegahnya jadi penyuntingan diam-diam adalah test yang
 * merah ketika angkanya berubah.
 *
 * Nilainya ikut tertulis di setiap hash (format PHC di bawah), jadi menaikkan
 * parameter kelak tidak membatalkan hash lama — masing-masing diverifikasi
 * dengan parameternya sendiri.
 */
export const ARGON2_PARAMS = {
  memory: 19456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
  saltLength: 16,
} as const;

export function isValidPinShape(pin: unknown): boolean {
  // `/^\d{6}$/` dan BUKAN pemeriksaan panjang + Number(): '048291' yang
  // melewati Number() menjadi 48291, berubah jadi PIN 5 digit, dan pengguna
  // yang PIN-nya dimulai nol tidak akan pernah bisa masuk.
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

/**
 * 20 PIN 6-digit paling umum.
 *
 * Sebagian tumpang tindih dengan aturan struktural di bawah, dan itu tidak
 * apa-apa — yang penting adalah sisanya. `159753`, `147258`, `852456`, dan
 * `789456` adalah pola **keypad**: garis lurus dan diagonal di atas grid
 * 3×3. Tidak ada aturan aritmetika yang menangkapnya, karena polanya spasial,
 * bukan numerik. Itulah kenapa daftar statis harus ada di samping keempat
 * aturan lain, bukan sebagai gantinya.
 */
const PIN_UMUM: ReadonlySet<string> = new Set([
  '123456', '111111', '000000', '123123', '666666',
  '121212', '112233', '789456', '654321', '159753',
  '147258', '852456', '999999', '888888', '555555',
  '222222', '333333', '777777', '101010', '123321',
]);

export type PolaPinLemah =
  | 'repeated_digit'
  | 'sequence'
  | 'birth_date'
  | 'repeating_block'
  | 'common_pin';

export interface TemuanPinLemah {
  pattern: PolaPinLemah;
  /** Pesan berbahasa Indonesia yang menyebut POLA MANA — lihat catatan di bawah. */
  message: string;
}

export interface OpsiPinLemah {
  /** Tanggal lahir pengguna, `YYYY-MM-DD`. Aturannya bersyarat: "jika diketahui". */
  birthDate?: string | null;
}

function semuaDigitSama(pin: string): boolean {
  return pin.split('').every((d) => d === pin[0]);
}

/**
 * Urutan naik atau turun, dinilai **per langkah** dan modulo 10.
 *
 * Membandingkan digit pertama dengan terakhir tidak cukup: `135790` naik
 * dari 1 ke 0 secara keseluruhan tapi langkahnya +2, dan menolaknya berarti
 * menolak PIN yang sah. Modulo 10 supaya `890123` — yang jelas berurutan
 * bagi manusia — tidak lolos hanya karena melewati sembilan.
 */
function urutanBerturut(pin: string): boolean {
  const langkah = (a: string, b: string) => (Number(b) - Number(a) + 10) % 10;
  const pertama = langkah(pin[0], pin[1]);
  if (pertama !== 1 && pertama !== 9) return false;
  for (let i = 1; i < pin.length - 1; i += 1) {
    if (langkah(pin[i], pin[i + 1]) !== pertama) return false;
  }
  return true;
}

/** Pola berulang berperiode 2 atau 3. Periode 1 sudah ditangani `semuaDigitSama`. */
function blokBerulang(pin: string): boolean {
  for (const periode of [2, 3]) {
    const blok = pin.slice(0, periode);
    if (blok.repeat(pin.length / periode) === pin) return true;
  }
  return false;
}

function susunanTanggal(birthDate: string): string[] {
  const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!cocok) return [];
  const [, yyyy, mm, dd] = cocok;
  const yy = yyyy.slice(2);
  // Ketiganya adalah susunan yang benar-benar dipakai orang. `spec-f:135`
  // mencontohkan yang pertama.
  return [`${dd}${mm}${yy}`, `${mm}${dd}${yy}`, `${yy}${mm}${dd}`];
}

/**
 * Mendeteksi PIN lemah.
 *
 * ## Kenapa mengembalikan POLA, bukan boolean
 *
 * AC `spec-f:144` menuntut "pesan yang menjelaskan pola mana". Itu bukan
 * kemewahan: manajer yang ditolak tiga kali tanpa tahu apa yang salah akan
 * memilih PIN lemah yang keempat. Boolean memaksa pemanggil mengarang pesan
 * seragam, dan pesan seragam persis yang AC itu larang.
 *
 * Urutan pemeriksaan mengikuti urutan tabel `spec-f:131-137`, jadi `111111`
 * dilaporkan sebagai "digit berulang" — bukan "pola berulang", yang juga
 * benar tapi kurang langsung menjelaskan.
 */
export function detectWeakPin(pin: string, opsi: OpsiPinLemah = {}): TemuanPinLemah | null {
  if (semuaDigitSama(pin)) {
    return {
      pattern: 'repeated_digit',
      message: 'PIN tidak boleh berupa digit yang berulang, seperti 000000.',
    };
  }
  if (urutanBerturut(pin)) {
    return {
      pattern: 'sequence',
      message: 'PIN tidak boleh berupa urutan naik atau turun, seperti 123456.',
    };
  }
  if (opsi.birthDate && susunanTanggal(opsi.birthDate).includes(pin)) {
    return {
      pattern: 'birth_date',
      message: 'PIN tidak boleh berupa tanggal lahir Anda.',
    };
  }
  if (blokBerulang(pin)) {
    return {
      pattern: 'repeating_block',
      message: 'PIN tidak boleh berupa pola yang berulang, seperti 121212.',
    };
  }
  if (PIN_UMUM.has(pin)) {
    return {
      pattern: 'common_pin',
      message: 'PIN ini termasuk yang paling sering dipakai orang. Pilih yang lain.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Format PHC
// ---------------------------------------------------------------------------

/**
 * `$argon2id$v=19$m=<mem>,t=<passes>,p=<par>$<salt>$<tag>`
 *
 * ## Kenapa PHC dan bukan kolom-kolom terpisah
 *
 * Hash ini dicetak **server** (`node:crypto`) lalu direplikasi ke perangkat
 * dan diverifikasi **klien** dengan implementasi Argon2 yang berbeda
 * (`spec-f:124-125`). PHC adalah format yang keduanya sepakati tanpa
 * kesepakatan tambahan: parameternya ikut di dalam string, jadi tidak ada
 * satu pun konstanta yang harus cocok di dua tempat.
 *
 * Ia juga yang membuat rotasi parameter mungkin. Kalau parameter dinaikkan
 * kelak, hash lama tetap dapat diverifikasi dengan parameternya sendiri —
 * tanpa itu, menaikkan `memory` akan mengunci setiap pengguna yang ada.
 *
 * ⛔ Base64 **tanpa padding**, mengikuti konvensi PHC. Padding `=` membuat
 * string tidak cocok dengan yang dicetak pustaka Argon2 lain, dan gejalanya
 * adalah "PIN salah" — kegagalan yang menunjuk ke tempat yang keliru
 * sepenuhnya.
 */
export interface Phc {
  algorithm: 'argon2id';
  version: number;
  memory: number;
  passes: number;
  parallelism: number;
  salt: string;
  tag: string;
}

const VERSI_ARGON2 = 19;

export function formatPhc(p: {
  memory: number;
  passes: number;
  parallelism: number;
  salt: string;
  tag: string;
}): string {
  return `$argon2id$v=${VERSI_ARGON2}$m=${p.memory},t=${p.passes},p=${p.parallelism}$${p.salt}$${p.tag}`;
}

const POLA_PHC = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export function parsePhc(s: unknown): Phc {
  if (typeof s !== 'string') throw new Error('Hash PHC tidak valid: bukan string.');
  const cocok = POLA_PHC.exec(s);
  if (!cocok) throw new Error('Hash PHC tidak valid: bentuknya tidak dikenali.');
  return {
    algorithm: 'argon2id',
    version: Number(cocok[1]),
    memory: Number(cocok[2]),
    passes: Number(cocok[3]),
    parallelism: Number(cocok[4]),
    salt: cocok[5],
    tag: cocok[6],
  };
}

/**
 * Base64 tanpa padding, dari dan ke byte.
 *
 * Memakai `btoa`/`atob` — keduanya global di Node 22+ **dan** di browser,
 * tidak seperti `Buffer`. Itu yang membuat encoding di kedua sisi dijamin
 * identik alih-alih hanya diharapkan identik.
 */
export function toBase64NoPad(bytes: Uint8Array): string {
  let biner = '';
  for (const b of bytes) biner += String.fromCharCode(b);
  return btoa(biner).replace(/=+$/, '');
}

export function fromBase64NoPad(s: string): Uint8Array {
  const biner = atob(s);
  const out = new Uint8Array(biner.length);
  for (let i = 0; i < biner.length; i += 1) out[i] = biner.charCodeAt(i);
  return out;
}

/**
 * Port hashing PIN.
 *
 * Ia ada supaya berkas ini tetap dapat dimuat di webview: `node:crypto` hanya
 * ada di server, dan Argon2 tidak ada di WebCrypto sama sekali. Server
 * mengimplementasikannya dengan `node:crypto`
 * (`apps/server/src/modules/identity/pin-hasher.ts`); klien dengan
 * implementasi Argon2 yang berlaku di browser.
 *
 * Format PHC di atas adalah kontrak di antara keduanya. Selama keduanya
 * membaca parameter dari string itu, hash yang dicetak server dapat
 * diverifikasi klien tanpa satu pun konstanta yang harus cocok.
 *
 * `verifikasi` menerima `unknown` dengan sengaja: hash yang dibacanya datang
 * dari database atau dari replikasi, bukan dari pemanggil, dan bentuk yang
 * rusak harus ditolak alih-alih melempar.
 */
export interface PinHasher {
  hash(pin: string): Promise<string>;
  verifikasi(pin: string, phc: unknown): Promise<boolean>;
}
