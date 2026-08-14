import type { PrinterProfile, ReceiptDocument } from './escpos.ts';
import { renderEscPos } from './escpos.ts';

/**
 * `PeripheralPort` — `ARCH:200`.
 *
 * `printReceipt` · `openCashDrawer` · `onBarcodeScanned` · `listDevices` ·
 * `testDevice`. Implementasinya: Tauri/Rust, Network, WebUSB, **Noop**.
 *
 * ## ⛔ Invariant #3 hidup di pemanggil, bukan di sini
 *
 * "Simpan sebelum cetak, SELALU. Cetak dan buka laci adalah efek samping yang
 * BOLEH gagal. Struk bisa dicetak ulang; penjualan yang hilang tidak bisa
 * dipulihkan."
 *
 * Port ini karena itu boleh melempar apa saja — jaringan putus, printer mati,
 * kertas habis. Yang menjamin penjualan selamat adalah `cetakStruk` di bawah,
 * yang tidak pernah meneruskan lemparan, dan urutan di `simpanPenjualan`:
 * transaksi di-commit LEBIH DULU, cetak sesudahnya.
 */

export interface PerangkatCetak {
  id: string;
  nama: string;
  koneksi: 'usb' | 'bluetooth' | 'network';
  alamat: string;
}

export interface PeripheralPort {
  /** Boleh melempar. Pemanggil yang menjinakkannya. */
  printReceipt(bytes: Uint8Array, perangkatId?: string): Promise<void>;
  openCashDrawer(bytes: Uint8Array, perangkatId?: string): Promise<void>;
  listDevices(): Promise<PerangkatCetak[]>;
  /** Uji cetak K-15 — mengembalikan `true` bila perangkat menjawab. */
  testDevice(perangkatId: string): Promise<boolean>;
  onBarcodeScanned(dengar: (kode: string) => void): () => void;
}

/**
 * Adapter untuk perangkat yang TIDAK punya periferal.
 *
 * ⛔ Bukan penanda "belum diimplementasikan". Merchant yang menjual lewat QRIS
 * tanpa printer adalah kasus nyata, dan aplikasi harus berjalan penuh di sana.
 * Noop menjadikan ketiadaan printer sebagai konfigurasi yang sah, bukan
 * kesalahan yang harus ditangani setiap pemanggil.
 */
export function noopPeripheral(): PeripheralPort {
  return {
    async printReceipt() {},
    async openCashDrawer() {},
    async listDevices() {
      return [];
    },
    async testDevice() {
      return false;
    },
    onBarcodeScanned() {
      return () => {};
    },
  };
}

export type HasilCetak =
  | { status: 'tercetak' }
  /** Tidak ada printer terpasang — keadaan SAH, bukan kegagalan. */
  | { status: 'tanpa_printer' }
  | { status: 'gagal'; pesan: string };

/**
 * Mencetak, dan TIDAK PERNAH melempar.
 *
 * ⛔ Ini titik tempat invariant #3 ditegakkan. Lemparan yang lolos dari sini
 * akan naik ke pemanggil, dan pemanggil terdekatnya adalah alur penjualan —
 * penjualan yang uangnya sudah masuk laci lalu gagal karena kertas habis
 * adalah persis kegagalan yang invariant itu larang.
 *
 * Kegagalannya DIKEMBALIKAN, bukan didiamkan: layar harus dapat mengatakan
 * "struk gagal dicetak, transaksi tersimpan" — bukan diam, dan bukan menuduh
 * penjualannya gagal.
 */
export async function cetakStruk(
  port: PeripheralPort | null | undefined,
  dok: ReceiptDocument,
  profil: PrinterProfile | null | undefined,
  perangkatId?: string
): Promise<HasilCetak> {
  if (!port || !profil) return { status: 'tanpa_printer' };
  try {
    const bytes = renderEscPos(dok, profil);
    await port.printReceipt(bytes, perangkatId);
    return { status: 'tercetak' };
  } catch (e) {
    return { status: 'gagal', pesan: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Membuka laci, dengan aturan yang sama.
 *
 * Laci yang tidak terbuka adalah gangguan; penjualan yang hilang tidak dapat
 * dipulihkan. Invariant #3 menyebut keduanya dalam satu kalimat.
 */
export async function bukaLaci(
  port: PeripheralPort | null | undefined,
  profil: PrinterProfile | null | undefined,
  perangkatId?: string
): Promise<HasilCetak> {
  if (!port || !profil) return { status: 'tanpa_printer' };
  try {
    const bytes = renderEscPos({ baris: [], bukaLaci: true }, profil);
    await port.openCashDrawer(bytes, perangkatId);
    return { status: 'tercetak' };
  } catch (e) {
    return { status: 'gagal', pesan: e instanceof Error ? e.message : String(e) };
  }
}
