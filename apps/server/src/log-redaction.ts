/**
 * Redaksi log (FR-C5).
 *
 * AC FR-C5 ketiga: "**Lapisan logging** meredaksi payload pembayaran secara
 * otomatis — diverifikasi test yang mengirim payload berisi pola nomor kartu
 * dan memeriksa log."
 *
 * Kata "lapisan logging" menentukan bentuknya. Fungsi ini dipasang di logger,
 * bukan dipanggil dari tiap handler: redaksi yang bergantung pada pemanggil
 * mengingat untuk memakainya akan bocor lewat jalur yang lupa — dan jalur itu
 * belum tentu sudah ditulis hari ini.
 *
 * ## Dua hal yang disaring, dengan alasan berbeda
 *
 * 1. **Bentuk nomor kartu** (13–19 digit berurutan). Nomor kartu tidak
 *    seharusnya pernah masuk ke sistem ini sama sekali — jalur masuknya sudah
 *    menolaknya (`assertBukanNomorKartu`). Ini lapisan kedua, untuk yang
 *    terlanjur menyelinap lewat field yang belum terpikirkan.
 * 2. **Nilai berkunci rahasia** (`*key*`, `*secret*`, `*token*`,
 *    `authorization`, `password`). `MIDTRANS_SERVER_KEY` dipakai di header
 *    Authorization — itu memang tempatnya. Yang dilarang adalah ia mendarat di
 *    log, karena log disalin ke tiket, ditempel ke chat, dan dikirim ke
 *    layanan pihak ketiga.
 *
 * ## Yang sengaja TIDAK disaring
 *
 * Redaksi yang terlalu rakus sama berbahayanya dengan yang bocor: log yang
 * tidak bisa dipakai mendiagnosis apa pun akan dimatikan orang, dan hilanglah
 * seluruh gunanya. Ambang 13 digit dipilih supaya nomor struk, nominal rupiah,
 * `hlc` 12 digit, dan UUID tetap terbaca utuh.
 */

/** Sama dengan ambang di jalur masuk pembayaran — 13 adalah PAN terpendek yang beredar. */
const KEMUNGKINAN_PAN = /\d{13,19}/;

/**
 * Deret digit yang mungkin PAN, TERMASUK yang dipisah spasi atau tanda hubung.
 *
 * `4111 1111 1111 1111` adalah bentuk yang paling mungkin diketik orang, jadi
 * mencari digit berurutan saja akan meloloskannya.
 *
 * ## Kenapa pengelompokannya DIKUNCI, bukan "digit dengan pemisah sembarang"
 *
 * Versi pertama memakai `\d(?:[\s-]?\d){12,18}` — digit apa pun dengan
 * pemisah opsional di antaranya. Ia meredaksi **nomor struk**:
 * `K1-20260807-0007` menyusut jadi `1202608070007`, tiga belas digit, dan
 * hilanglah satu-satunya penanda yang dipakai merchant untuk menemukan
 * transaksi.
 *
 * Itu bukan cacat kecil. Redaksi yang terlalu rakus akan dimatikan orang
 * pertama yang butuh log untuk mendiagnosis sesuatu, dan setelah itu tidak ada
 * redaksi sama sekali.
 *
 * Karena itu bentuk berpemisah dibatasi pada pengelompokan yang benar-benar
 * dipakai kartu: 4-4-4-4 (Visa/Mastercard) dan 4-6-5 (Amex). Nomor struk
 * berpola 2-8-4 dan tidak cocok dengan keduanya.
 */
const PAN_BERKELOMPOK = /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{1,4}\b|\b\d{4}[\s-]\d{6}[\s-]\d{5}\b/g;

/** Deret digit tanpa pemisah, 13-19 angka. */
const PAN_BERURUTAN = /\d{13,19}/g;

const KUNCI_RAHASIA = /key|secret|token|authorization|password|pin|credential/i;

const PENGGANTI = '[REDAKSI]';

/**
 * Nilai rahasia yang diketahui saat boot (kunci gateway, dan seterusnya).
 *
 * Penyaringan berbasis NAMA field saja tidak cukup: kunci yang menyelinap ke
 * dalam pesan error muncul sebagai teks bebas, tanpa nama field apa pun yang
 * bisa dikenali. Menyaring berdasarkan NILAI menutup jalur itu.
 *
 * Diisi sekali di `buildApp` dari environment variable. Nilai pendek diabaikan
 * — CI mengisi kunci Midtrans dengan string kosong, dan meredaksi string kosong
 * berarti meredaksi seluruh isi log.
 */
const MIN_PANJANG_RAHASIA = 8;
let nilaiRahasia: readonly string[] = [];

export function registerSecretValues(values: ReadonlyArray<string | undefined>): void {
  nilaiRahasia = values.filter(
    (v): v is string => typeof v === 'string' && v.trim().length >= MIN_PANJANG_RAHASIA
  );
}

function redaksiString(value: string): string {
  let hasil = value;
  for (const rahasia of nilaiRahasia) {
    if (hasil.includes(rahasia)) {
      hasil = hasil.split(rahasia).join(PENGGANTI);
    }
  }
  hasil = hasil.replace(PAN_BERKELOMPOK, PENGGANTI);
  hasil = hasil.replace(PAN_BERURUTAN, (cocok) => (KEMUNGKINAN_PAN.test(cocok) ? PENGGANTI : cocok));
  return hasil;
}

/**
 * Mengembalikan salinan yang sudah disaring. Objek asli **tidak** disentuh —
 * ia masih dipakai pemanggil setelah baris log ditulis, dan memutasinya berarti
 * logging diam-diam mengubah data yang sedang diproses.
 *
 * Struktur melingkar dijaga dengan `seen`: log ditulis di jalur panas, dan
 * kehilangan satu baris log jauh lebih ringan daripada server yang jatuh
 * karena rekursi tak berujung.
 */
export function redactSensitive(input: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof input === 'string') {
    return redaksiString(input);
  }
  if (input === null || typeof input !== 'object') {
    return input;
  }
  if (seen.has(input)) {
    return '[MELINGKAR]';
  }
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((v) => redactSensitive(v, seen));
  }

  // Error tidak dapat disalin lewat spread -- `message` dan `stack` tidak
  // enumerable. Keduanya diambil eksplisit, dan keduanya ikut disaring: pesan
  // error adalah tempat kredensial paling sering menyelinap.
  if (input instanceof Error) {
    return {
      name: input.name,
      message: redaksiString(input.message),
      stack: typeof input.stack === 'string' ? redaksiString(input.stack) : undefined,
    };
  }

  const keluar: Record<string, unknown> = {};
  for (const [kunci, nilai] of Object.entries(input as Record<string, unknown>)) {
    if (KUNCI_RAHASIA.test(kunci)) {
      keluar[kunci] = PENGGANTI;
      continue;
    }
    keluar[kunci] = redactSensitive(nilai, seen);
  }
  return keluar;
}

/**
 * Hook `logMethod` untuk pino: setiap argumen objek yang di-log lewat sini
 * disaring lebih dulu.
 *
 * Dipasang sekali di `buildApp`. Karena ia ada di logger, bukan di pemanggil,
 * baris log yang ditulis modul mana pun — termasuk yang belum ditulis — ikut
 * tersaring.
 */
export function createRedactingLogMethod() {
  return function logMethod(this: unknown, args: unknown[], method: (...a: unknown[]) => void): void {
    const disaring = args.map((a) => (typeof a === 'string' ? redaksiString(a) : redactSensitive(a)));
    method.apply(this, disaring);
  };
}
