import type { PeripheralPort } from './port.ts';

/**
 * Adapter printer yang berlaku di perangkat ini.
 *
 * ## ⛔ Ia mengembalikan `null` HARI INI, dan itu keadaan yang dinyatakan
 *
 * Tidak ada satu pun adapter yang benar-benar menyentuh perangkat keras.
 * `ARCH:235` mencatat kenapa: WebUSB gagal di Windows, jadi jalur universalnya
 * Rust (Tauri) atau printer network — dan keduanya menuntut shell Tauri yang
 * belum ada. Ini utang F4 yang tercatat, bukan yang disembunyikan.
 *
 * ## ⛔ Kenapa BUKAN `noopPeripheral()`
 *
 * `noopPeripheral` selalu "berhasil". Dipakai di sini, setiap penjualan dan
 * setiap cetak ulang akan melaporkan **"struk tercetak"** kepada kasir
 * sementara tidak ada satu byte pun yang meninggalkan perangkat — dan kasir
 * yang percaya itu tidak akan mencari strukanya. `cetakStruk` menjawab
 * `tanpa_printer` untuk port `null`, dan itu kalimat yang JUJUR: "belum ada
 * printer terpasang di perangkat ini."
 *
 * K-15 (uji cetak) tetap memakai `noopPeripheral` dengan sengaja: yang
 * dibuktikannya adalah dokumen dan byte-nya terbentuk, bukan bahwa perangkat
 * menjawab — dan layarnya menyatakan itu.
 *
 * ## Satu tempat, bukan satu per layar
 *
 * Setiap layar yang memutuskan sendiri "port mana yang dipakai" akan menyimpang
 * pada hari adapter sungguhan lahir: satu layar mendapatkannya, yang lain
 * tertinggal memakai `null` dan diam-diam berhenti mencetak. Ketika adapter itu
 * ada, yang berubah adalah SATU baris di berkas ini.
 */
export function peripheralAktif(): PeripheralPort | null {
  return null;
}
