import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { HasilCetak } from './port.ts';
import { bacaProfilPrinter } from './profil.ts';
import { bacaPilihanProfil } from './pilihan.ts';
import { profilBerlaku } from './berlaku.ts';
import { bangunUlangStruk } from './ulang.ts';
import { cetakDanCatat } from './antrean.ts';
import { peripheralAktif } from './aktif.ts';

/* FR-B11 — cetak ulang struk (`spec-b:145`), SATU jalur untuk K-07 dan K-09.

   Dipindahkan dari `DetailTransaksi.tsx` saat K-07 mendapat tombol cetak
   ulangnya (rebuild UI Fase 3.3). Dua salinan akan menyimpang tepat di tempat
   yang paling mahal: profil yang dipilih, dan kalimat yang kasir baca saat
   printer gagal.

   ⛔ Dokumennya DIBANGUN ULANG dari database, dan itu satu-satunya cara yang
   mungkin: `print_job` menyimpan byte cetakan pertama, tapi transaksi yang
   dicetak di perangkat LAIN — atau sebelum antrean cetak ada — tidak punya
   baris di sana sama sekali. `bangunUlangStruk` menandai hasilnya sebagai
   cetak ulang, dan ia tidak menyentuh satu pun tabel katalog.

   ⛔ Hasilnya tetap dicatat ke `print_job` lewat `cetakDanCatat`: cetak ulang
   yang GAGAL adalah kegagalan yang sama dengan cetakan pertama, dan ia berhak
   masuk antrean yang sama. Ia tidak pernah melempar (invariant #3). */
export async function cetakUlangOrder(
  db: DbLokal,
  orderId: string,
  outletId: string
): Promise<HasilCetak | null> {
  // ⛔ Nama outlet dibaca dari tabel `outlet`, bukan dari `konfig` —
  // `device_config` menyimpan id-nya, bukan namanya, dan struk yang menyebut
  // UUID di baris pertama adalah struk yang salah cetak.
  const [outlet] = await db.getAll<{ name: string }>('SELECT name FROM outlet WHERE id = ?', [outletId]);
  const dok = await bangunUlangStruk(db, orderId, { namaMerchant: outlet?.name ?? '' });
  if (!dok) return null;
  // ⛔ BUKAN `p[0]`. Query profil tidak punya `ORDER BY`, jadi "yang pertama"
  // tidak dijamin apa pun — dan cetak ulang yang memakai profil acak
  // menghasilkan struk kedua yang lebarnya berbeda dari yang pertama, tepat
  // yang `spec-b:145` larang.
  const [daftar, dipilih] = await Promise.all([bacaProfilPrinter(db), bacaPilihanProfil(db)]);
  return cetakDanCatat(db, peripheralAktif(), dok, profilBerlaku(daftar, dipilih).profil, {
    id: crypto.randomUUID(),
    orderId,
    waktu: new Date().toISOString(),
  });
}

/**
 * Kalimat untuk hasil cetak — cetakan pertama (K-07) dan cetak ulang.
 *
 * ⛔ Teks, bukan hanya warna (aturan design system #5), dan `tanpa_printer`
 * BUKAN kegagalan: merchant tanpa printer adalah kasus sah. Kegagalan cetakan
 * pertama menyebut bahwa transaksinya TETAP tersimpan — kasir yang hanya
 * membaca "gagal" akan menagih pelanggan dua kali.
 *
 * `null` = transaksinya tidak dapat dibangun ulang menjadi struk.
 */
export function kalimatCetak(hasil: HasilCetak | null, ulang: boolean): string {
  if (hasil === null) return 'Transaksi ini tidak dapat dibangun ulang menjadi struk.';
  if (hasil.status === 'tercetak') return ulang ? 'Struk dicetak ulang.' : 'Struk dicetak.';
  if (hasil.status === 'tanpa_printer') return 'Belum ada printer terpasang di perangkat ini.';
  return ulang
    ? `Gagal mencetak: ${hasil.pesan} Struk masuk antrean cetak dan dapat dicoba lagi dari Perangkat.`
    : `Struk gagal dicetak: ${hasil.pesan} Transaksi tetap tersimpan; struk masuk antrean cetak dan dapat dicoba lagi dari Perangkat.`;
}
