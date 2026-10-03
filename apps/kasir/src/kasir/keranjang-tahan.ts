import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import type { Sesi } from '../identitas/login.ts';
import { bacaKatalog } from '../katalog/baca.ts';
import { subtotalKeranjang, type BarisKeranjang, type Keranjang } from './keranjang.ts';
import {
  adaKeranjangBerjalan,
  bersihkanKeranjangDi,
  serialkan,
  simpanKeranjang,
  uraikan,
} from './keranjang-simpan.ts';
import { bacaShiftTerbuka, tulisJejakBatal } from './keranjang-batal.ts';

/**
 * Pesanan tahan — keranjang yang disimpan untuk dilanjutkan (spec § 4 baris 8,
 * "Pesanan tahan — batas yang dinyatakan").
 *
 * ## Batas yang dinyatakan
 *
 * Murni lokal, satu perangkat, terikat shift. BUKAN `order` berstatus `open`
 * dan BUKAN berbagi order antar perangkat (alasan di kepala
 * `keranjang-simpan.ts`). Tidak ada yang naik ke server kecuali peristiwa
 * `cart_cleared` saat tahanan DIBUANG (keputusan otonom spec § 12).
 *
 * ## ⛔ Tiga operasi, tiga transaksi — tidak satu pun dapat meninggalkan
 * pesanan di dua tempat atau di nol tempat
 *
 * - Tahan: INSERT tahanan + hapus `keranjang_lokal` bersama. Terpisah berarti
 *   boot berikutnya memulihkan keranjang yang SUDAH tahan: pesanan yang sama
 *   dijual dua kali.
 * - Lanjutkan: baca + hapus tahanan + tulis `keranjang_lokal` bersama.
 *   Terpisah berarti mati di antaranya menghilangkan pesanan pelanggan.
 * - Buang: jejak `cart_cleared` + hapus tahanan bersama (G-BATAL-AUDIT).
 *
 * Serializernya SATU (`serialkan`/`uraikan` milik `keranjang-simpan.ts`):
 * salinan kedua menyimpang tepat di bigint diskon, kanal, dan `dataPesanan`.
 */

/** `[ASUMSI]` spec § 12 butir 7 — ubah konstanta ini bila merchant meminta lain. */
export const MAKS_TAHANAN = 20;

export interface RingkasTahanan {
  id: string;
  /** Jumlah kuantitas ×1000 (konvensi kuantitas); tampilkan lewat `tampilkanKuantitas`. */
  jumlahItem: number;
  subtotal: bigint;
  dibuatPada: string;
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
    return { ok: false, pesan: 'Keranjang kosong. Tidak ada yang bisa ditahan.' };
  }
  const id = idBaru();
  const jumlahItem = k.baris.reduce((j, b) => j + b.quantityMilli, 0);
  const subtotal = subtotalKeranjang(k);

  return db.transaction(async (tx): Promise<HasilTahan> => {
    if ((await jumlahTahanan(tx, shiftId)) >= MAKS_TAHANAN) {
      return {
        ok: false,
        pesan: `Sudah ada ${MAKS_TAHANAN} pesanan tahan. Lanjutkan atau buang salah satunya dulu.`,
      };
    }
    await tx.execute(
      `INSERT INTO keranjang_tahan (id, shift_id, isi, jumlah_item, subtotal, dibuat_pada)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, shiftId, serialkan(k), jumlahItem, Number(subtotal), sekarang().toISOString()]
    );
    // ⛔ Di transaksi yang sama: lihat kepala berkas.
    await bersihkanKeranjangDi(tx);
    return { ok: true, id };
  });
}

export async function jumlahTahanan(db: DbLokal, shiftId: string): Promise<number> {
  const baris = await db.getAll<{ n: number }>(
    'SELECT count(*) AS n FROM keranjang_tahan WHERE shift_id = ?',
    [shiftId]
  );
  return Number(baris[0]?.n ?? 0);
}

export async function daftarTahanan(db: DbLokal, shiftId: string): Promise<RingkasTahanan[]> {
  const baris = await db.getAll<{ id: string; jumlah_item: number; subtotal: number; dibuat_pada: string }>(
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

/** Keranjang sebuah tahanan apa adanya (tanpa harga ulang) — untuk menghitung total jejak buang. */
export async function bacaKeranjangTahanan(db: DbLokal, id: string): Promise<Keranjang | null> {
  const baris = await db.getAll<{ isi: string }>('SELECT isi FROM keranjang_tahan WHERE id = ?', [id]);
  return baris[0] ? uraikan(baris[0].isi) : null;
}

export interface HargaKini {
  variation: ReadonlyMap<string, number>;
  modifier: ReadonlyMap<string, number>;
}

export interface HasilHargaUlang {
  keranjang: Keranjang;
  subtotalBerubah: boolean;
  barisDibuang: string[];
}

/**
 * Harga katalog SEKARANG (FR-H6: diresolusi pada waktu dipakai, bukan waktu
 * tahan). Variation/modifier yang diarsip tidak ada di peta.
 */
export async function bacaHargaKini(
  db: DbLokal,
  { outletId, pada }: { outletId: string | null; pada: Date }
): Promise<HargaKini> {
  const katalog = await bacaKatalog(db, { outletId, pada });
  const variation = new Map<string, number>();
  for (const item of katalog) for (const v of item.variations) variation.set(v.id, v.harga);
  const modifier = new Map<string, number>();
  const m = await db.getAll<{ id: string; price: number }>(
    'SELECT id, price FROM modifier WHERE archived_at IS NULL'
  );
  for (const r of m) modifier.set(r.id, r.price);
  return { variation, modifier };
}

/**
 * Murni. Harga variation dan modifier diganti harga kini; baris yang variation
 * atau modifier-nya sudah tidak ada DIBUANG dan namanya dilaporkan — menjual
 * "Kopi + extra shot" tanpa extra shot, atau pada harga lama, adalah salah dua
 * cara menagih pelanggan yang bukan pesanannya.
 *
 * Diskon TIDAK disentuh: `nominalDisetujui` tetap angka yang manajer lihat,
 * dan `statusDiskon` yang menuntut persetujuan baru bila potongan tumbuh.
 */
export function hargaUlang(k: Keranjang, harga: HargaKini): HasilHargaUlang {
  const barisDibuang: string[] = [];
  const baris: BarisKeranjang[] = [];
  /* `subtotalBerubah` = HARGA baris yang tersisa berubah. Baris yang dibuang dilaporkan terpisah
     (`barisDibuang`): kabar "harga berubah" untuk item yang hanya diarsip menyesatkan. */
  let berubah = false;
  for (const b of k.baris) {
    const nama = b.variationCount > 1 ? `${b.itemName} (${b.variationName})` : b.itemName;
    const hargaVariation = harga.variation.get(b.variationId);
    if (hargaVariation === undefined) {
      barisDibuang.push(nama);
      continue;
    }
    const hilang = b.modifier.find((m) => !harga.modifier.has(m.id));
    if (hilang) {
      barisDibuang.push(`${nama} + ${hilang.nama}`);
      continue;
    }
    const modifier = b.modifier.map((m) => ({ ...m, harga: harga.modifier.get(m.id) as number }));
    if (hargaVariation !== b.unitPrice || modifier.some((m, i) => m.harga !== b.modifier[i]!.harga)) {
      berubah = true;
    }
    baris.push({ ...b, unitPrice: hargaVariation, modifier });
  }
  return { keranjang: { ...k, baris }, subtotalBerubah: berubah, barisDibuang };
}

/**
 * Melanjutkan tahanan: harga diresolusi ulang, tahanan dihapus, dan keranjang
 * hasilnya ditulis ke `keranjang_lokal` — satu transaksi.
 *
 * `null` bila tahanan sudah tidak ada (lanjutkan ganda).
 *
 * ⛔ MELEMPAR bila isinya tidak terurai, dan barisnya TIDAK dihapus: menghapus
 * di sini = pesanan hilang tanpa jejak `cart_cleared`. Jalan keluarnya Buang,
 * yang menulis jejak (nol baris) — konsisten, dan tidak menahan tutup kas.
 *
 * ⛔ MELEMPAR bila keranjang berjalan belum kosong: menimpanya diam-diam
 * menghapus pesanan pelanggan lain. Layar menawarkan "Tahan pesanan ini dulu".
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
    const keranjang = uraikan(baris.isi);
    if (keranjang === null) {
      throw new Error('Pesanan tahan ini tidak dapat dibaca. Buang saja; pembuangan tercatat di audit.');
    }
    if (await adaKeranjangBerjalan(tx)) {
      throw new Error('Keranjang berjalan belum kosong. Tahan atau selesaikan pesanan itu dulu.');
    }
    const hasil = hargaUlang(keranjang, harga);
    await tx.execute('DELETE FROM keranjang_tahan WHERE id = ?', [id]);
    await simpanKeranjang(tx, baris.shift_id, hasil.keranjang, sekarang);
    return hasil;
  });
}

/**
 * Membuang tahanan: peristiwa `cart_cleared` (SATU definisi jejak dengan
 * Batalkan, `tulisJejakBatal`) + hapus tahanan, satu transaksi. Keranjang
 * BERJALAN tidak disentuh.
 *
 * `total` = `hitungKeranjang` atas keranjang tahanan (angka layar, bukan
 * aritmetika kedua). Melempar bila tahanan tidak ada atau shift tidak terbuka:
 * membuang tanpa jejak adalah persis yang fitur ini cegah.
 */
export async function buangTahanan(
  db: DbLokal,
  id: string,
  jejak: {
    konfig: KonfigPerangkat;
    sesi: Sesi;
    total: bigint;
    waktu: () => Date;
    idBaru: () => string;
    hlc: () => bigint;
  }
): Promise<void> {
  await db.transaction(async (tx) => {
    const baris = (
      await tx.getAll<{ shift_id: string; isi: string }>(
        'SELECT shift_id, isi FROM keranjang_tahan WHERE id = ?',
        [id]
      )
    )[0];
    if (!baris) throw new Error('Pesanan tahan tidak ditemukan. Tidak ada yang dibuang.');
    const shift = await bacaShiftTerbuka(tx, baris.shift_id);
    if (!shift) throw new Error('Shift sudah tidak terbuka. Pesanan tahan TIDAK dibuang.');
    // Isi yang tak terurai tetap meninggalkan jejak (nol baris) — peristiwanya
    // tetap fakta, dan barisnya tidak boleh tersangkut selamanya.
    const keranjang = uraikan(baris.isi) ?? { baris: [] };
    await tulisJejakBatal(tx, { ...jejak, shiftId: baris.shift_id, shift, keranjang });
    await tx.execute('DELETE FROM keranjang_tahan WHERE id = ?', [id]);
  });
}
