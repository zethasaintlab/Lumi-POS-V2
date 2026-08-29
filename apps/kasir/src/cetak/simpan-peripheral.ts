import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import { simpanPilihanProfil } from './pilihan.ts';

/**
 * K-15 — menyimpan pilihan profil printer perangkat ini.
 *
 * ## ⛔ SATU transaksi lokal: pilihan + outbox
 *
 * Menulis `device_config` lalu mengantre di luar transaksi meninggalkan
 * jendela tempat perangkat dapat mati di antaranya — dan boot berikutnya
 * memakai profil baru sementara server tidak pernah mendengarnya. Merchant
 * yang memeriksa audit trail tidak menemukan perubahan yang jelas-jelas
 * berlaku di perangkatnya. Alasan yang sama persis dengan `simpanHlc` dan
 * pembersihan keranjang.
 *
 * ## ⛔ `peripheralId` DIBEKUKAN per perangkat, bukan digenerate ulang
 *
 * Setiap penyimpanan dengan id BARU menghasilkan baris `peripheral` baru di
 * server, dan merchant yang mengubah profilnya lima kali punya lima printer
 * terdaftar di satu perangkat. Id-nya lahir sekali (pertama kali disimpan) dan
 * disimpan bersama pilihannya; server memperbarui baris yang sama.
 *
 * ## ⛔ Aktor dibekukan saat item DIBUAT
 *
 * `outbox_local.actor_id`, aturan yang sama dengan seluruh jalur perangkat:
 * antrean yang terkuras setelah pergantian shift akan menisbatkan perubahan
 * kepada kasir yang salah.
 */

export interface PenyimpananPeripheral {
  /** `device_config.peripheral_id`, atau `null` bila belum pernah disimpan. */
  peripheralIdTersimpan: string | null;
  profilId: string;
  deviceId: string;
  outletId: string;
  actorId: string;
  /** Seam test. Bawaannya `crypto.randomUUID`. */
  idBaru?: () => string;
  /** Seam test. Bawaannya jam dinding. */
  sekarang?: () => string;
}

export interface HasilSimpanPeripheral {
  peripheralId: string;
  baru: boolean;
}

export async function simpanPeripheralPrinter(
  db: DbLokal,
  {
    peripheralIdTersimpan,
    profilId,
    deviceId,
    outletId,
    actorId,
    idBaru = () => crypto.randomUUID(),
    sekarang = () => new Date().toISOString(),
  }: PenyimpananPeripheral
): Promise<HasilSimpanPeripheral> {
  if (profilId.trim() === '') {
    throw new Error('profilId wajib diisi — pilihan kosong tidak dapat disimpan.');
  }
  const baru = peripheralIdTersimpan === null || peripheralIdTersimpan === '';
  const peripheralId = baru ? idBaru() : (peripheralIdTersimpan as string);

  await db.transaction(async (tx) => {
    await simpanPilihanProfil(tx, profilId, peripheralId);
    await enqueue(tx, {
      id: idBaru(),
      entityType: 'peripheral',
      entityId: peripheralId,
      operation: 'create',
      // ⛔ Kunci idempotensi diturunkan dari peripheral DAN profil yang
      // dipilih, bukan acak. Retry mengirim muatan yang sama; perubahan
      // BERIKUTNYA ke profil lain adalah operasi berbeda dan harus punya
      // kuncinya sendiri, kalau tidak server menjawabnya dari cache dan
      // pilihan kedua tidak pernah berlaku.
      idempotencyKey: `peripheral:${peripheralId}:${profilId}`,
      createdAt: sekarang(),
      actorId,
      payload: {
        id: peripheralId,
        deviceId,
        outletId,
        // ⛔ Selalu `printer`. K-15 mengonfigurasi printer; laci dibuka lewat
        // perintah printer (`drawerCommand`), dan scanner adalah HID yang
        // tidak perlu didaftarkan. Jenis lain menunggu layarnya sendiri.
        type: 'printer',
        // ⛔ `usb` adalah [ASUMSI] yang dinyatakan. K-15 belum menanyakan
        // jenis koneksi karena tidak satu pun adapter yang menyentuh perangkat
        // keras ada (utang F4), jadi jawabannya belum dapat diverifikasi
        // apa pun. Menanyakannya sekarang berarti merchant mengetik jawaban
        // yang tidak dibaca kode mana pun.
        connection: 'usb',
        printerProfileId: profilId,
      },
    });
  });

  return { peripheralId, baru };
}
