import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import {
  lepasDiskonBilaKosong,
  subtotalKeranjang,
  type BarisKeranjang,
  type Keranjang,
} from './keranjang.ts';
import { bersihkanKeranjangDi, serialkan, simpanKeranjang, uraikan } from './keranjang-simpan.ts';
import { batalkanKeranjang } from './keranjang-batal.ts';
import type { ItemKatalog } from '../katalog/baca.ts';
import type { Sesi } from '../identitas/login.ts';

/**
 * Pesanan tahan (Task 12, spec § 4 "Pesanan tahan — batas yang dinyatakan").
 *
 * ## Batas yang dinyatakan
 *
 * - Murni LOKAL, satu perangkat, terikat `shift_id`. Bukan berbagi order antar
 *   perangkat (non-goal v1) dan bukan `order` berstatus `open` (alasan di kepala
 *   `keranjang-simpan.ts`). Tidak ada yang naik ke server KECUALI jejak
 *   membuangnya (`cart_cleared`, sama dengan Batalkan).
 * - Serializer SAMA dengan `keranjang_lokal` (`serialkan`/`uraikan`): bigint
 *   diskon + `nominalDisetujui`, kanal, dan data pesanan ikut utuh. Serializer
 *   kedua akan menyimpang di tepi yang paling mahal (diskon yang sudah disetujui).
 *
 * ## ⛔ Setiap perpindahan pesanan SATU transaksi
 *
 * - tahan   = INSERT tahanan + kosongkan keranjang berjalan;
 * - lanjutkan = baca + DELETE tahanan + tulis keranjang berjalan;
 * - buang   = jejak `cart_cleared` + outbox + DELETE tahanan.
 *
 * Perangkat yang mati di tengah tidak pernah meninggalkan pesanan di DUA
 * tempat sekaligus (pelanggan ditagih dua kali) atau di NOL tempat.
 */

/** Batas tahanan per shift `[ASUMSI]` (spec § 12 butir 7). Ubah konstanta ini saja. */
export const MAKS_TAHANAN = 20;

/**
 * ⛔ Draf QRIS dinamis yang menunggu konfirmasi gateway (`draf_qris_lokal`)
 * membekukan perpindahan pesanan: QR-nya mungkin SUDAH dibayar pelanggan, dan
 * keranjang/harga di baliknya tidak boleh berubah. Dibaca di dalam transaksi
 * yang menulis, bukan sebelumnya.
 */
const PESAN_DRAF_QRIS =
  'Ada pembayaran QRIS yang masih menunggu konfirmasi. Selesaikan atau batalkan pembayaran itu dulu.';

async function adaDrafQris(db: DbLokal, shiftId: string): Promise<boolean> {
  const baris = await db.getAll('SELECT 1 FROM draf_qris_lokal WHERE shift_id = ?', [shiftId]);
  return baris.length > 0;
}

export interface RingkasTahanan {
  id: string;
  jumlahItem: number;
  subtotal: bigint;
  dibuatPada: string;
}

/** Harga KINI dari katalog lokal yang sudah diresolusi (`katalog/baca.ts`). */
export interface HargaKini {
  variation: ReadonlyMap<string, number>;
  modifier: ReadonlyMap<string, number>;
}

export type HasilTahan = { ok: true; id: string } | { ok: false; pesan: string };

export async function tahanKeranjang(
  db: DbLokal,
  shiftId: string,
  k: Keranjang,
  sekarang: () => Date,
  idBaru: () => string
): Promise<HasilTahan> {
  if (k.baris.length === 0) {
    return { ok: false, pesan: 'Keranjang kosong. Tidak ada pesanan yang dapat ditahan.' };
  }
  const id = idBaru();
  const dibuat = sekarang().toISOString();
  return db.transaction(async (tx): Promise<HasilTahan> => {
    if (await adaDrafQris(tx, shiftId)) return { ok: false, pesan: PESAN_DRAF_QRIS };
    if ((await hitungTahanan(tx, shiftId)) >= MAKS_TAHANAN) {
      return {
        ok: false,
        pesan: `Sudah ada ${MAKS_TAHANAN} pesanan tahan di shift ini. Lanjutkan atau buang salah satunya dulu.`,
      };
    }
    await tx.execute(
      `INSERT INTO keranjang_tahan (id, shift_id, isi, jumlah_item, subtotal, dibuat_pada)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, shiftId, serialkan(k), k.baris.length, Number(subtotalKeranjang(k)), dibuat]
    );
    // ⛔ Dalam transaksi yang sama: tahanan tertulis tetapi keranjang berjalan
    // masih utuh = pesanan yang sama bisa dilanjutkan dan dijual dua kali.
    await bersihkanKeranjangDi(tx);
    return { ok: true, id };
  });
}

export async function daftarTahanan(db: DbLokal, shiftId: string): Promise<RingkasTahanan[]> {
  const baris = await db.getAll<{
    id: string;
    jumlah_item: number;
    subtotal: number | bigint | string;
    dibuat_pada: string;
  }>(
    `SELECT id, jumlah_item, subtotal, dibuat_pada FROM keranjang_tahan
      WHERE shift_id = ? ORDER BY dibuat_pada, id`,
    [shiftId]
  );
  return baris.map((b) => ({
    id: b.id,
    jumlahItem: Number(b.jumlah_item),
    subtotal: BigInt(b.subtotal),
    dibuatPada: b.dibuat_pada,
  }));
}

export async function jumlahTahanan(db: DbLokal, shiftId: string): Promise<number> {
  return hitungTahanan(db, shiftId);
}

async function hitungTahanan(db: DbLokal, shiftId: string): Promise<number> {
  const baris = await db.getAll<{ n: number }>(
    'SELECT COUNT(*) AS n FROM keranjang_tahan WHERE shift_id = ?',
    [shiftId]
  );
  return Number(baris[0]?.n ?? 0);
}

/** Membaca isi satu tahanan TANPA menghapusnya (untuk total jejak Buang). */
export async function bacaTahanan(
  db: DbLokal,
  id: string
): Promise<{ shiftId: string; keranjang: Keranjang | null; jumlahItem: number; subtotal: bigint } | null> {
  const baris = (
    await db.getAll<{ shift_id: string; isi: string; jumlah_item: number; subtotal: number | bigint | string }>(
      'SELECT shift_id, isi, jumlah_item, subtotal FROM keranjang_tahan WHERE id = ?',
      [id]
    )
  )[0];
  if (!baris) return null;
  return {
    shiftId: baris.shift_id,
    keranjang: uraikan(baris.isi),
    jumlahItem: Number(baris.jumlah_item),
    subtotal: BigInt(baris.subtotal),
  };
}

export interface HasilHargaUlang {
  keranjang: Keranjang;
  subtotalBerubah: boolean;
  /** "<item> <variation>" yang tidak ada lagi di katalog dan dibuang. */
  barisDibuang: string[];
}

/**
 * Menagih tahanan dengan harga KINI (spec § 4: "tahanan yang melewati
 * perubahan harga ditagih harga baru").
 *
 * Murni. Variation yang hilang/diarsip dibuang dan NAMANYA dilaporkan -- tidak
 * pernah dijual dengan harga lama dan tidak pernah hilang diam-diam.
 * Diskon dan `nominalDisetujui` TIDAK diubah: persetujuan manajer berlaku untuk
 * ANGKA yang ia lihat, dan `statusDiskon` menuntut persetujuan baru bila
 * potongan hasil harga baru tumbuh melewatinya.
 *
 * `[ASUMSI]` modifier yang tidak ada di peta harga mempertahankan harga
 * tersimpannya (hanya variation yang diarsip membuang baris, sesuai spec).
 */
export function hargaUlang(k: Keranjang, harga: HargaKini): HasilHargaUlang {
  const barisDibuang: string[] = [];
  const baris: BarisKeranjang[] = [];
  for (const b of k.baris) {
    const unit = harga.variation.get(b.variationId);
    if (unit === undefined) {
      barisDibuang.push(`${b.itemName} ${b.variationName}`);
      continue;
    }
    baris.push({
      ...b,
      unitPrice: unit,
      modifier: b.modifier.map((m) => ({ ...m, harga: harga.modifier.get(m.id) ?? m.harga })),
    });
  }
  const keranjang = lepasDiskonBilaKosong({ ...k, baris });
  return {
    keranjang,
    subtotalBerubah: subtotalKeranjang(k) !== subtotalKeranjang(keranjang),
    barisDibuang,
  };
}

/**
 * Peta harga kini dari katalog yang sudah dibaca layar (`bacaKatalog`, harga
 * sudah lewat tangga harga) + satu query modifier.
 */
export async function hargaKiniDariKatalog(
  db: DbLokal,
  katalog: readonly ItemKatalog[]
): Promise<HargaKini> {
  const variation = new Map<string, number>();
  for (const i of katalog) for (const v of i.variations) variation.set(v.id, v.harga);
  const modifier = new Map<string, number>();
  const baris = await db.getAll<{ id: string; price: number }>(
    'SELECT id, price FROM modifier WHERE archived_at IS NULL'
  );
  for (const m of baris) modifier.set(m.id, Number(m.price));
  return { variation, modifier };
}

/**
 * Mengambil tahanan menjadi keranjang berjalan. Mengembalikan `null` bila
 * tahanan sudah tidak ada (dilanjutkan di tab lain, atau isinya rusak).
 *
 * ⛔ Baca + hapus + tulis keranjang berjalan DALAM SATU transaksi: dua
 * lanjutkan beruntun tidak pernah menghasilkan dua keranjang, dan perangkat
 * yang mati sesudah menghapus tidak kehilangan pesanan (ia sudah durable di
 * `keranjang_lokal`, tidak menunggu efek layar).
 *
 * Menolak (galat, tahanan utuh) bila keranjang berjalan sudah berisi atau isi
 * tahanan tidak terbaca.
 */
export async function lanjutkanTahanan(
  db: DbLokal,
  id: string,
  harga: HargaKini,
  sekarang: () => Date = () => new Date()
): Promise<HasilHargaUlang | null> {
  return db.transaction(async (tx) => {
    const baris = (
      await tx.getAll<{ shift_id: string; isi: string }>(
        'SELECT shift_id, isi FROM keranjang_tahan WHERE id = ?',
        [id]
      )
    )[0];
    if (!baris) return null;
    // ⛔ Isi tak terbaca: GALAT, baris UTUH. Menghapusnya diam-diam membuat
    // pesanan hilang tanpa jejak; membuangnya resmi lewat Buang (dengan audit).
    const keranjang = uraikan(baris.isi);
    if (keranjang === null) {
      throw new Error('Pesanan tahan tidak dapat dibaca. Pesanan TIDAK dilanjutkan; buang lewat daftar Pesanan tahan.');
    }
    if (await adaDrafQris(tx, baris.shift_id)) throw new Error(PESAN_DRAF_QRIS);
    // ⛔ Dalam transaksi yang sama dengan penulisan: keranjang berjalan yang terisi
    // (tab lain, efek layar) tidak boleh tertimpa diam-diam.
    const berjalan = await tx.getAll('SELECT 1 FROM keranjang_lokal WHERE id = ?', ['kini']);
    if (berjalan.length > 0) {
      throw new Error('Keranjang berjalan belum kosong. Tahan pesanan ini dulu.');
    }
    await tx.execute('DELETE FROM keranjang_tahan WHERE id = ?', [id]);
    const hasil = hargaUlang(keranjang, harga);
    await simpanKeranjang(tx, baris.shift_id, hasil.keranjang, sekarang);
    return hasil;
  });
}

export interface JejakBuang {
  konfig: KonfigPerangkat;
  sesi: Sesi;
  /** `hitungKeranjang(...).totals.total` atas keranjang tahanan -- bukan aritmetika kedua. */
  total: bigint;
  waktu: () => Date;
  idBaru: () => string;
  hlc: () => bigint;
}

/**
 * Membuang tahanan DENGAN jejak: jalur `batalkanKeranjang` (Task 5B) yang
 * sama -- `audit_event` `cart_cleared` + outbox + penghapusan, SATU transaksi
 * (spec § 12 butir 7). Membuang tahanan sesudah barang di-scan adalah pola
 * kecurangan yang sama dengan Batalkan.
 *
 * Melempar bila tahanan tidak ada atau shift sudah tidak terbuka; tahanan
 * tetap UTUH dan tidak ada jejak yang tertulis.
 */
export async function buangTahanan(db: DbLokal, id: string, jejak: JejakBuang): Promise<void> {
  const tahanan = await bacaTahanan(db, id);
  if (tahanan === null) {
    throw new Error('Pesanan tahan tidak ditemukan. Mungkin sudah dilanjutkan atau dibuang.');
  }
  // ⛔ Tahanan tak terbaca/kosong TETAP dijejak: tidak ada penghapusan tanpa
  // audit. Ringkasannya dari kolom `jumlah_item`/`subtotal`; kuantitas per baris
  // tidak diketahui, jadi `quantity_milli` = 1000 × jumlah baris `[ASUMSI]`.
  const terbaca = tahanan.keranjang !== null && tahanan.keranjang.baris.length > 0;
  const keranjang = terbaca
    ? tahanan.keranjang!
    : { baris: Array.from({ length: Math.max(tahanan.jumlahItem, 1) }, () => ({ quantityMilli: 1000 })) };
  const total = terbaca ? jejak.total : tahanan.subtotal;
  const hasil = await batalkanKeranjang({
    db,
    konfig: jejak.konfig,
    sesi: jejak.sesi,
    shiftId: tahanan.shiftId,
    keranjang,
    total,
    waktu: jejak.waktu,
    idBaru: jejak.idBaru,
    hlc: jejak.hlc,
    hapus: async (tx) => {
      if (await adaDrafQris(tx, tahanan.shiftId)) throw new Error(PESAN_DRAF_QRIS);
      // Sudah dilanjutkan di antara pembacaan dan transaksi? Batalkan SEMUANYA,
      // jejak ikut -- jejak untuk tahanan yang sudah menjadi keranjang berjalan
      // adalah catatan palsu.
      const masihAda = await tx.getAll('SELECT 1 FROM keranjang_tahan WHERE id = ?', [id]);
      if (masihAda.length === 0) throw new Error('Pesanan tahan sudah tidak ada. Tidak dibuang.');
      await tx.execute('DELETE FROM keranjang_tahan WHERE id = ?', [id]);
    },
  });
  if (hasil.status === 'shift_tidak_terbuka') {
    throw new Error('Shift sudah tidak terbuka. Pesanan tahan TIDAK dibuang.');
  }
}
