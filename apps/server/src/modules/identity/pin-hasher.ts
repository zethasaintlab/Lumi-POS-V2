import * as nodeCrypto from 'node:crypto';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ARGON2_PARAMS,
  formatPhc,
  fromBase64NoPad,
  parsePhc,
  toBase64NoPad,
  type PinHasher,
} from '../../../../../packages/domain/src/pin.ts';

/**
 * Implementasi server dari port `PinHasher` (FR-F2).
 *
 * ## ⛔ Argon2id datang dari `node:crypto`. Nol dependency baru.
 *
 * Node 24.18.0 menyediakan `crypto.argon2` / `argon2Sync`. Sampai ini diukur,
 * memenuhi `spec-f:146` ("Hash Argon2id, bukan bcrypt/SHA/MD5") terlihat
 * seperti menuntut pustaka pihak ketiga — dan aturan proyek melarang
 * menambah dependency tanpa persetujuan. Ternyata tidak perlu.
 *
 * Diukur di mesin pengembangan dengan parameter OWASP (m=19456, t=2, p=1):
 * **23 ms per hash**.
 *
 * ## Kenapa `argon2` (async), bukan `argon2Sync`
 *
 * Verifikasi PIN terjadi di jalur permintaan HTTP. `argon2Sync` memblokir
 * event loop selama 23 ms — dengan beberapa perangkat memverifikasi PIN
 * bersamaan, itu menahan setiap permintaan lain di server, termasuk penjualan
 * yang sedang berjalan. Varian async menjalankannya di threadpool.
 *
 * ## Kenapa implementasi ini TIDAK memaksakan ARGON2_PARAMS saat verifikasi
 *
 * Parameter dibaca dari hash-nya sendiri (format PHC). Itu yang membuat
 * menaikkan parameter kelak tidak mengunci setiap pengguna yang ada: hash
 * lama tetap diverifikasi dengan parameter lamanya. `ARGON2_PARAMS` hanya
 * dipakai saat MENCETAK hash baru.
 */

interface OpsiArgon2 {
  message: Buffer;
  nonce: Buffer;
  tagLength: number;
  memory: number;
  passes: number;
  parallelism: number;
}

/**
 * Shim tipe untuk `crypto.argon2`.
 *
 * API-nya ADA dan berjalan di Node 24.18.0 — diukur, bukan diasumsikan — tapi
 * `@types/node` yang terpasang belum mengenalnya. Deklarasi sempit ini adalah
 * satu-satunya tempat yang tahu itu, dan bentuknya ditulis persis seperti yang
 * dipanggil di bawah; `as any` yang tersebar akan mematikan pemeriksaan tipe
 * pada argumen yang justru menentukan kekuatan hash-nya.
 *
 * Baris ini dihapus begitu `@types/node` menyusul.
 */
type FungsiArgon2 = (
  algoritma: 'argon2id',
  opsi: OpsiArgon2,
  cb: (err: Error | null, tag: ArrayBuffer) => void
) => void;

const argon2 = (nodeCrypto as unknown as { argon2?: FungsiArgon2 }).argon2;

if (typeof argon2 !== 'function') {
  // Gagal saat MODUL DIMUAT, bukan saat kasir pertama mengetik PIN. Runtime
  // tanpa `crypto.argon2` tidak dapat memenuhi `spec-f:146` sama sekali, dan
  // satu-satunya jalan keluar yang tersisa saat itu adalah menurunkan
  // algoritma diam-diam.
  throw new Error(
    'Runtime ini tidak menyediakan crypto.argon2 (butuh Node 24+). ' +
      'PIN tidak dapat di-hash sesuai spec-f:146.'
  );
}

function argon2Async(opsi: OpsiArgon2): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2!('argon2id', opsi, (err, tag) => {
      if (err) reject(err);
      else resolve(Buffer.from(tag));
    });
  });
}

export function buatPinHasher(): PinHasher {
  return {
    async hash(pin: string): Promise<string> {
      const salt = randomBytes(ARGON2_PARAMS.saltLength);
      const tag = await argon2Async({
        message: Buffer.from(pin, 'utf8'),
        nonce: salt,
        tagLength: ARGON2_PARAMS.tagLength,
        memory: ARGON2_PARAMS.memory,
        passes: ARGON2_PARAMS.passes,
        parallelism: ARGON2_PARAMS.parallelism,
      });
      return formatPhc({
        memory: ARGON2_PARAMS.memory,
        passes: ARGON2_PARAMS.passes,
        parallelism: ARGON2_PARAMS.parallelism,
        salt: toBase64NoPad(new Uint8Array(salt)),
        tag: toBase64NoPad(new Uint8Array(tag)),
      });
    },

    async verifikasi(pin: string, phc: unknown): Promise<boolean> {
      // Hash rusak MENOLAK, tidak melempar. Ia dapat sampai ke sini lewat
      // replikasi yang setengah jalan atau baris yang disunting tangan;
      // melempar berarti login jatuh dengan 500 dan kasir tidak dapat
      // berjualan, sementara menolak berarti ia melihat "PIN salah" dan
      // memanggil manajer.
      let terurai;
      try {
        terurai = parsePhc(phc);
      } catch {
        return false;
      }

      const salt = fromBase64NoPad(terurai.salt);
      const tagTersimpan = Buffer.from(fromBase64NoPad(terurai.tag));

      const tagDihitung = await argon2Async({
        message: Buffer.from(pin, 'utf8'),
        nonce: Buffer.from(salt),
        tagLength: tagTersimpan.length,
        memory: terurai.memory,
        passes: terurai.passes,
        parallelism: terurai.parallelism,
      });

      // `timingSafeEqual` melempar bila panjangnya berbeda. Di sini panjang
      // keduanya dipaksa sama lewat `tagLength` di atas, jadi cabang itu
      // tidak dapat terjadi -- tapi diperiksa tetap, karena hash yang
      // panjangnya nol lolos dari parsePhc.
      if (tagDihitung.length !== tagTersimpan.length) return false;
      return timingSafeEqual(tagDihitung, tagTersimpan);
    },
  };
}
