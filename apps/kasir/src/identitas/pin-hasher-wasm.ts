import { argon2id, argon2Verify } from 'hash-wasm';
import {
  ARGON2_PARAMS,
  parsePhc,
  type PinHasher,
} from '../../../../packages/domain/src/pin.ts';

/**
 * Implementasi KLIEN dari port `PinHasher` (FR-F2, FR-F3).
 *
 * ## Kenapa WASM, dan bukan perintah Rust lewat Tauri
 *
 * Keputusan user 11 Agustus 2026. Argon2 tidak ada di WebCrypto dan
 * `node:crypto` tidak ada di webview, jadi salah satu dari keduanya harus
 * dipilih. WASM menang karena dua hal yang keduanya soal pengujian:
 *
 *   - **Jalur kodenya tunggal.** Biner yang sama berjalan di `node --test`,
 *     di harness browser, dan di webview Tauri. Perintah Tauri akan membuat
 *     login satu-satunya alur yang tidak dapat diuji di mana pun kecuali
 *     aplikasi rilis — dan login adalah pintu masuk ke seluruh aplikasi.
 *   - **Tidak ada cabang lingkungan.** `if (isTauri)` di jalur otentikasi
 *     berarti dua perilaku yang harus dijaga sama tanpa ada yang
 *     membandingkannya.
 *
 * `hash-wasm@4.12.0` menyisipkan WASM-nya sebagai base64 di dalam bundel —
 * tidak ada aset terpisah yang harus dilayani, jadi ia bekerja di Vite dan di
 * Tauri tanpa konfigurasi tambahan.
 *
 * ## ⛔ Yang membuat modul ini benar bukan Argon2-nya, melainkan kesepakatan
 * formatnya dengan server
 *
 * Hash dicetak `node:crypto` di server dan diverifikasi di sini oleh pustaka
 * yang sama sekali berbeda. Kalau salah satu menafsirkan salt, panjang tag,
 * atau base64 dengan cara lain, gejalanya adalah "PIN salah" pada PIN yang
 * benar — dan itu baru muncul setelah hash benar-benar direplikasi ke
 * perangkat, jauh dari tempat sebabnya. Karena itu yang diuji di
 * `tests/kasir/pin-hasher-wasm.test.js` adalah lintas implementasi, bukan
 * Argon2.
 *
 * Modul ini TIDAK menyimpan apa pun. PIN masuk sebagai argumen dan keluar
 * sebagai boolean; hash datang dari database lokal yang diisi replikasi.
 */
export function buatPinHasherWasm(): PinHasher {
  return {
    async hash(pin: string): Promise<string> {
      const salt = new Uint8Array(ARGON2_PARAMS.saltLength);
      crypto.getRandomValues(salt);
      // `outputType: 'encoded'` menghasilkan PHC persis seperti yang dicetak
      // sisi server -- diperiksa test, bukan diasumsikan dari dokumentasi.
      return argon2id({
        password: pin,
        salt,
        parallelism: ARGON2_PARAMS.parallelism,
        memorySize: ARGON2_PARAMS.memory,
        iterations: ARGON2_PARAMS.passes,
        hashLength: ARGON2_PARAMS.tagLength,
        outputType: 'encoded',
      });
    },

    async verifikasi(pin: string, phc: unknown): Promise<boolean> {
      // Bentuknya diurai lebih dulu dengan parser KAMI, bukan langsung
      // diserahkan ke `argon2Verify`. Dua alasan:
      //
      //   1. `argon2Verify` melempar pada string yang tidak dikenalinya, dan
      //      hash rusak harus DITOLAK -- bukan menjatuhkan layar login. Hash
      //      rusak dapat sampai ke perangkat lewat replikasi setengah jalan.
      //   2. Ia menerima argon2i dan argon2d juga. Kami hanya menerima
      //      argon2id (`spec-f:146`), dan `parsePhc` yang menegakkannya.
      //
      // Parameter tidak dipaksakan ke ARGON2_PARAMS: `argon2Verify` membacanya
      // dari string, dan itu yang membuat menaikkan parameter kelak tidak
      // mengunci pengguna yang sudah ada.
      let hash: string;
      try {
        hash = typeof phc === 'string' ? (parsePhc(phc), phc) : '';
      } catch {
        return false;
      }
      if (hash === '') return false;

      try {
        return await argon2Verify({ password: pin, hash });
      } catch {
        return false;
      }
    },
  };
}
