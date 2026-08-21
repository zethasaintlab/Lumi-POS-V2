import { useEffect, useRef } from 'react';
import {
  keadaanAwal,
  ketuk,
  type KeadaanPemindai,
} from '../../../../packages/domain/src/pemindai.ts';

/**
 * K-17 — listener barcode **global**.
 *
 * `IA:67` menuliskannya sebagai sifat, bukan saran: *"Listener barcode
 * global."* Alasannya di `research/07` §4: *"barcode bisa dipindai kapan
 * saja; layar kasir harus punya listener global, bukan mengandalkan field
 * yang sedang fokus."*
 *
 * Kasir memindai sambil melihat pelanggan, bukan sambil melihat kotak
 * pencarian. Scanner yang hanya bekerja saat sebuah field fokus adalah
 * scanner yang gagal pada ketukan pertama setiap pesanan.
 *
 * ## ⛔ Yang TIDAK ditangkap
 *
 * Ketukan saat kursor berada di `<input>`, `<textarea>`, atau elemen
 * `contenteditable` dilewatkan apa adanya. Dua alasan, keduanya keras:
 *
 *   - kasir yang sedang mengetik nominal tunai di K-06 akan melihat angkanya
 *     hilang ke buffer scanner;
 *   - PIN di K-01 dan K-11 diketik cepat dan diakhiri Enter — bentuk yang
 *     PERSIS sama dengan scan. Menangkapnya berarti PIN mendarat sebagai
 *     pencarian barcode.
 *
 * Konsekuensinya dinyatakan: memindai saat kotak pencarian fokus akan
 * mengetik barcodenya ke kotak itu, bukan menambahkan produk. Itu perilaku
 * yang benar — kasir melihat apa yang terjadi.
 *
 * ## ⛔ Kenapa `keydown`, bukan `keypress`
 *
 * `keypress` sudah usang dan tidak memancarkan `Enter` di sebagian browser.
 * `keydown` memancarkan semua tombol, termasuk yang harus diabaikan — dan
 * pengabaiannya milik `packages/domain/src/pemindai.ts`, yang dapat diuji
 * tanpa DOM.
 */

function diKolomTeks(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface OpsiPemindai {
  /** Dipanggil saat sebuah scan dikenali. */
  onScan: (kode: string) => void;
  /** Mematikan listener — dipakai saat dialog modal terbuka. */
  aktif?: boolean;
  /** Di-inject supaya harness dapat mengendalikan waktunya. */
  sekarang?: () => number;
}

export function usePemindaiGlobal({ onScan, aktif = true, sekarang }: OpsiPemindai): void {
  /* ⛔ Keadaan di `useRef`, BUKAN `useState`. Setiap ketukan barcode akan
     memicu render ulang seluruh grid katalog — tiga belas render untuk satu
     scan, di perangkat yang paling lambat di seluruh sistem. Yang dilihat
     kasir hanyalah hasilnya. */
  const keadaan = useRef<KeadaanPemindai>(keadaanAwal());
  /* Callback di ref supaya listener tidak dipasang ulang setiap render —
     `onScan` biasanya closure baru pada tiap render pemanggil. */
  const panggil = useRef(onScan);
  panggil.current = onScan;
  const jam = useRef(sekarang);
  jam.current = sekarang;

  useEffect(() => {
    if (!aktif) {
      // Buffer dikosongkan saat listener mati. Sisa ketukan dari sebelum
      // dialog terbuka akan menempel di depan scan berikutnya.
      keadaan.current = keadaanAwal();
      return;
    }

    const tangani = (e: KeyboardEvent) => {
      if (diKolomTeks(e.target)) return;
      // Modifier menandakan pintasan (Ctrl+R, Cmd+K), bukan barcode.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const hasil = ketuk(
        keadaan.current,
        e.key,
        (jam.current ?? (() => Date.now()))()
      );
      keadaan.current = hasil.keadaan;
      if (hasil.jenis === 'terpindai') {
        // ⛔ `preventDefault` HANYA setelah scan dikenali. Memanggilnya pada
        // setiap ketukan akan mematikan pintasan browser dan navigasi
        // keyboard di seluruh layar kasir.
        e.preventDefault();
        panggil.current(hasil.kode);
      }
    };

    window.addEventListener('keydown', tangani);
    return () => window.removeEventListener('keydown', tangani);
  }, [aktif]);
}
