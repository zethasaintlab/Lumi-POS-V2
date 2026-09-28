import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { ringkasanAntrean } from '../../../../packages/sync-client/src/status.ts';
import { jumlahCetakTertunda } from '../cetak/antrean.ts';

/**
 * P7(a) — panel "Pemberitahuan perangkat" (`docs/superpowers/specs/
 * 2026-09-28-kasir-design.md` § 3). Murni: tidak menyentuh DOM, hanya
 * membaca data yang SUDAH ada di perangkat.
 *
 * `jenis` bukan daftar tertutup tersembunyi — ia SATU-SATUNYA empat sumber
 * yang lonceng dapat baca hari ini, masing-masing dari tabel lokal yang
 * sudah ditulis modul lain: `outbox_local` (gagal-kirim, `status.ts`),
 * `print_job` (gagal-cetak, `cetak/antrean.ts`), `draf_qris_lokal`
 * (qris-menunggu, `kasir/qris-dinamis.ts`), dan umur `outbox_local`
 * (kredensial-offline, OQ-08).
 */
export interface Pemberitahuan {
  jenis: 'gagal-kirim' | 'gagal-cetak' | 'qris-menunggu' | 'kredensial-offline';
  jumlah: number;
  kalimat: string;
  /** Rute yang ditawarkan sebagai jalan keluar, atau `null` bila tidak ada. */
  tujuan: string | null;
}

/**
 * Batas kredensial offline — OQ-08, diputuskan 7 Agustus 2026 (kompromi
 * `research/12` § OQ-08). Salinan LOKAL, sejajar `UMUR_KREDENSIAL_HARI` di
 * `apps/server/src/modules/identity/handlers/tokens.ts` — bukan diimpor,
 * karena kode klien tidak boleh bergantung pada modul server.
 */
const BATAS_KREDENSIAL_HARI = 30;
const MS_PER_HARI = 86_400_000;

/**
 * [EKSPLORASI] Sumber umur kredensial offline.
 *
 * Repo ini belum menyimpan waktu PENERBITAN kredensial di perangkat (lihat
 * `sync/token.ts`) — itu baru ada bersama Modul F sungguhan. Proksi yang
 * dipakai di sini adalah `ringkasanAntrean(db).terakhirTerkirimPada`, jalur
 * NAIK terakhir yang BERHASIL: perangkat yang berhasil mengirim ke server
 * pasti sedang (atau baru saja) terhubung, jadi umurnya adalah batas ATAS
 * yang aman untuk "sudah berapa lama sejak terakhir diketahui online".
 *
 * [ASUMSI] Ini bukan umur kredensial SUNGGUHAN (server dapat mencabut
 * kredensial tanpa perangkat pernah tahu sampai penjualan berikutnya ditolak
 * 401), dan perangkat yang belum PERNAH berhasil mengirim (`null`) tidak
 * pernah memicu pemberitahuan ini — keduanya batas yang dinyatakan, bukan
 * disembunyikan. Menutupnya menuntut Modul F menyimpan tanggal penerbitan di
 * `device_config`, di luar lingkup Task 3.
 */
function umurKredensialHari(terakhirTerkirimPada: string | null, sekarang: Date): number | null {
  if (terakhirTerkirimPada === null) return null;
  const lalu = Date.parse(terakhirTerkirimPada);
  if (Number.isNaN(lalu)) return null;
  return (sekarang.getTime() - lalu) / MS_PER_HARI;
}

export async function bacaPemberitahuan(db: DbLokal, sekarang: Date): Promise<Pemberitahuan[]> {
  const hasil: Pemberitahuan[] = [];

  const ringkasan = await ringkasanAntrean(db);
  if (ringkasan.gagal > 0) {
    hasil.push({
      jenis: 'gagal-kirim',
      jumlah: ringkasan.gagal,
      kalimat: `${ringkasan.gagal} penjualan gagal terkirim ke server.`,
      tujuan: '/sync',
    });
  }

  const cetakTertunda = await jumlahCetakTertunda(db);
  if (cetakTertunda > 0) {
    hasil.push({
      jenis: 'gagal-cetak',
      jumlah: cetakTertunda,
      kalimat: `${cetakTertunda} struk gagal dicetak, menunggu dicoba ulang.`,
      tujuan: '/perangkat',
    });
  }

  // ⛔ `count(*)`, bukan pembacaan baris — panelnya hanya perlu tahu ADA
  // tidaknya draf, bukan isinya (isinya milik alur K-06, bukan lonceng).
  const [barisQris] = await db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM draf_qris_lokal`
  );
  const jumlahQris = Number(barisQris?.n ?? 0);
  if (jumlahQris > 0) {
    hasil.push({
      jenis: 'qris-menunggu',
      jumlah: jumlahQris,
      kalimat: 'QRIS menunggu konfirmasi pembayaran dari gateway.',
      // Tidak ada rute K-06 (`IA:§7`) — pembayaran adalah MODE, bukan URL.
      tujuan: null,
    });
  }

  const umurHari = umurKredensialHari(ringkasan.terakhirTerkirimPada, sekarang);
  if (umurHari !== null && umurHari >= BATAS_KREDENSIAL_HARI) {
    const bulat = Math.floor(umurHari);
    hasil.push({
      jenis: 'kredensial-offline',
      jumlah: bulat,
      kalimat:
        `Perangkat ini sudah ${bulat} hari sejak terakhir berhasil terhubung ke server. ` +
        'Shift baru tidak dapat dibuka sampai terhubung (OQ-08).',
      tujuan: null,
    });
  }

  return hasil;
}
