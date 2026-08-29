import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { keranjangKosong, type Keranjang, type BarisKeranjang } from './keranjang.ts';

/**
 * KEP-21 — keranjang K-03 yang BERTAHAN melewati muat ulang.
 *
 * ## Masalahnya, dinyatakan apa adanya
 *
 * Sampai sekarang keranjang hanya hidup di memori modul (`simpanan.ts`). Tab
 * yang ter-refresh, tablet yang mati baterai, atau browser yang membuang tab
 * di belakang membuat kasir memasukkan ulang seluruh pesanan **di depan
 * pelanggan yang sedang menunggu**. Itu bukan kehilangan uang — penjualan
 * baru ada setelah `simpanPenjualan` menulisnya — tetapi ia adalah kegagalan
 * yang paling terlihat pelanggan.
 *
 * ## ⛔ Ini BUKAN `order` berstatus `open`
 *
 * `ERD` menyiapkan `order.status = 'open'` + `owned_by_device_id` untuk ini,
 * dan jalan itu **tidak** diambil: menulis baris `order` berarti
 * mengirimkannya ke server, dan order `open` yang tidak pernah dibayar muncul
 * di laporan sambil menuntut jalan penutupan yang belum ada. Ia juga tidak
 * dibutuhkan v1 — berbagi order antar device saat offline adalah non-goal
 * yang DINYATAKAN (`PRD` § 4). Yang dipecahkan di sini hanya "keranjang
 * perangkat INI hilang saat dimuat ulang".
 *
 * ## ⛔ Aturan yang paling penting: pembersihan ada DI DALAM transaksi penjualan
 *
 * Keranjang tersimpan yang dibersihkan SETELAH transaksi penjualan ter-commit
 * meninggalkan jendela tempat perangkat dapat mati di antaranya — dan boot
 * berikutnya memulihkan keranjang untuk penjualan yang **sudah tersimpan dan
 * sudah dibayar**. Kasir yang tidak menyadarinya menagih pelanggan berikutnya
 * dua kali, dan tidak ada satu pun error di mana pun.
 *
 * Karena itu `bersihkanKeranjangDi(tx)` menerima transaksi dan dipanggil dari
 * dalam `simpanPenjualan`. Pembersihan di layar (`setelKeranjang`) tetap ada,
 * tetapi ia urusan tampilan; yang durable dibersihkan bersama penjualannya.
 */

/** Satu perangkat punya satu keranjang berjalan. Lihat DDL untuk alasannya. */
const KUNCI = 'kini';

/** Bentuk baris yang tersimpan. `isi` adalah JSON `Keranjang`. */
interface BarisSimpanan {
  shift_id: string;
  isi: string;
}

/**
 * Menyimpan keranjang untuk shift ini. UPSERT ke satu baris.
 *
 * ⛔ Keranjang KOSONG menghapus barisnya, tidak menyimpan `{baris:[]}`. Baris
 * kosong yang tertinggal tidak berbahaya hari ini, tetapi ia membuat
 * "keranjang yang bertahan" dan "tidak ada keranjang" terlihat sama di
 * database — dan yang membaca berikutnya harus tahu bahwa keduanya berbeda
 * tanpa ada apa pun yang menyatakannya.
 */
export async function simpanKeranjang(
  db: DbLokal,
  shiftId: string,
  keranjang: Keranjang,
  sekarang: () => Date
): Promise<void> {
  if (keranjang.baris.length === 0) {
    await bersihkanKeranjangDi(db);
    return;
  }
  // ⛔ `INSERT ... ON CONFLICT DO UPDATE`, dan bentuk ini SUDAH terbukti
  // diterima `wa-sqlite` — `ON CONFLICT(id)` yang ditolaknya (8 Agustus 2026)
  // adalah bentuk tanpa aksi. Tetap: bentuk SQL baru wajib dijalankan di
  // browser sebelum dipercaya.
  await db.execute(
    `INSERT INTO keranjang_lokal (id, shift_id, isi, diperbarui_pada)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       shift_id = excluded.shift_id,
       isi = excluded.isi,
       diperbarui_pada = excluded.diperbarui_pada`,
    [KUNCI, shiftId, serialkan(keranjang), sekarang().toISOString()]
  );
}

/**
 * ⛔ `JSON.stringify` MELEMPAR pada `bigint`, dan keranjang berdiskon punya
 * dua: `diskon.minta.nilai` dan `diskon.nominalDisetujui`.
 *
 * `TypeError: Do not know how to serialize a BigInt` di jalur ini berarti
 * keranjang BERDISKON adalah satu-satunya yang tidak dapat disimpan — persis
 * keranjang yang paling mahal untuk dimasukkan ulang, karena ia menuntut PIN
 * manajer lagi. Kegagalannya juga akan muncul di dalam transaksi penjualan.
 *
 * Keduanya karena itu ditulis sebagai STRING dan dibaca kembali menjadi
 * `bigint`. Konvensi yang sama dengan setiap uang yang melewati JSON di repo
 * ini (muatan outbox, `after` di `audit_event`).
 */
function serialkan(k: Keranjang): string {
  return JSON.stringify(k, (_kunci, nilai: unknown) =>
    typeof nilai === 'bigint' ? nilai.toString() : nilai
  );
}

/**
 * Menghapus keranjang tersimpan.
 *
 * Menerima `DbLokal` (transaksi memakai antarmuka yang sama) supaya `simpanPenjualan` dapat memanggilnya DI
 * DALAM transaksi penjualan — lihat catatan kepala.
 */
export async function bersihkanKeranjangDi(db: DbLokal): Promise<void> {
  await db.execute('DELETE FROM keranjang_lokal WHERE id = ?', [KUNCI]);
}

export type HasilPulih =
  | { status: 'kosong' }
  | { status: 'dipulihkan'; keranjang: Keranjang }
  | { status: 'shift_berbeda' };

/**
 * Memulihkan keranjang untuk shift ini, bila ada.
 *
 * ⛔ Keranjang milik shift LAIN tidak pernah dipulihkan, dan barisnya dibuang.
 * Kasir berikutnya yang membuka shift baru dan menemukan pesanan pelanggan
 * kemarin di layarnya akan menjualnya kepada orang yang salah — dan ia tidak
 * punya cara mengetahui bahwa baris itu bukan miliknya.
 *
 * ⛔ Isi yang tidak dapat diurai DIBUANG, bukan dilempar. Keranjang adalah
 * kenyamanan; satu baris yang rusak tidak boleh membuat aplikasi kasir gagal
 * boot dan menghentikan penjualan. Bentuk lama yang tidak dikenal versi baru
 * masuk kategori yang sama.
 */
export async function pulihkanKeranjang(db: DbLokal, shiftId: string): Promise<HasilPulih> {
  const baris = (
    await db.getAll<BarisSimpanan>('SELECT shift_id, isi FROM keranjang_lokal WHERE id = ?', [KUNCI])
  )[0];
  if (!baris) return { status: 'kosong' };

  if (baris.shift_id !== shiftId) {
    await bersihkanKeranjangDi(db);
    return { status: 'shift_berbeda' };
  }

  const keranjang = uraikan(baris.isi);
  if (keranjang === null) {
    await bersihkanKeranjangDi(db);
    return { status: 'kosong' };
  }
  return { status: 'dipulihkan', keranjang };
}

/**
 * ⛔ Diurai dengan PEMERIKSAAN BENTUK, bukan `JSON.parse` lalu dipercaya.
 *
 * Barisnya ditulis versi aplikasi yang mungkin berbeda dari yang membacanya —
 * perangkat merchant memuat ulang setelah update. Baris yang bentuknya
 * berubah lalu dipercaya menghasilkan `undefined.quantityMilli` di tengah
 * perhitungan subtotal, dan layar kasir yang mati saat boot adalah kegagalan
 * yang jauh lebih besar daripada keranjang yang hilang.
 *
 * ⛔ Diskon TIDAK ikut dipulihkan bila bentuknya tidak persis benar — dan
 * `nominalDisetujui` khususnya: persetujuan manajer berlaku untuk ANGKA yang
 * ia lihat, dan persetujuan yang dipulihkan setengah adalah potongan tanpa
 * penyetuju.
 */
function uraikan(teks: string): Keranjang | null {
  let mentah: unknown;
  try {
    mentah = JSON.parse(teks);
  } catch {
    return null;
  }
  if (typeof mentah !== 'object' || mentah === null) return null;
  const o = mentah as Record<string, unknown>;
  if (!Array.isArray(o.baris)) return null;

  const baris: BarisKeranjang[] = [];
  for (const b of o.baris) {
    if (typeof b !== 'object' || b === null) return null;
    const r = b as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      typeof r.variationId !== 'string' ||
      typeof r.itemName !== 'string' ||
      typeof r.variationName !== 'string' ||
      typeof r.unitPrice !== 'number' ||
      typeof r.quantityMilli !== 'number' ||
      !Array.isArray(r.modifier)
    ) {
      return null;
    }
    for (const m of r.modifier) {
      if (typeof m !== 'object' || m === null) return null;
      const mm = m as Record<string, unknown>;
      if (
        typeof mm.id !== 'string' ||
        typeof mm.nama !== 'string' ||
        typeof mm.harga !== 'number' ||
        typeof mm.qtyMilli !== 'number'
      ) {
        return null;
      }
    }
    baris.push(b as BarisKeranjang);
  }

  const kosong = keranjangKosong();
  return { ...kosong, baris, diskon: diskonSah(o.diskon) };
}

function diskonSah(nilai: unknown): Keranjang['diskon'] {
  if (nilai === null || nilai === undefined) return null;
  if (typeof nilai !== 'object') return null;
  const d = nilai as Record<string, unknown>;

  const minta = d.minta;
  if (typeof minta !== 'object' || minta === null) return null;
  const m = minta as Record<string, unknown>;
  if (m.tipe !== 'persen' && m.tipe !== 'nominal') return null;
  const nilaiDiskon = keBigint(m.nilai);
  if (nilaiDiskon === null) return null;

  if (typeof d.alasanKode !== 'string') return null;
  if (d.alasanCatatan !== null && typeof d.alasanCatatan !== 'string') return null;

  // ⛔ Penyetuju: KEDUANYA ada atau KEDUANYA tidak. `approverId` tanpa
  // `nominalDisetujui` tidak menutup apa pun (`CLAUDE.md` § diskon) — yang
  // manajer setujui adalah ANGKANYA, dan tanpa angkanya tidak ada apa pun
  // untuk dibandingkan saat keranjang tumbuh. Diskon yang dipulihkan
  // setengah adalah potongan tanpa penyetuju.
  const approverId = d.approverId;
  if (approverId !== null && typeof approverId !== 'string') return null;
  const nominal = d.nominalDisetujui === null ? null : keBigint(d.nominalDisetujui);
  if (d.nominalDisetujui !== null && nominal === null) return null;
  if ((approverId === null) !== (nominal === null)) return null;

  return {
    minta: { tipe: m.tipe, nilai: nilaiDiskon },
    alasanKode: d.alasanKode,
    alasanCatatan: (d.alasanCatatan ?? null) as string | null,
    approverId,
    nominalDisetujui: nominal,
  };
}

/**
 * ⛔ Menerima STRING dan `bigint`, tidak pernah `number`.
 *
 * `serialkan` menulisnya sebagai string; menerima `number` juga akan
 * meloloskan baris yang ditulis versi lain lewat aritmetika float ke jalur
 * uang, dan itu tepat larangan yang tidak boleh punya pengecualian.
 */
function keBigint(nilai: unknown): bigint | null {
  if (typeof nilai === 'bigint') return nilai;
  if (typeof nilai === 'string' && /^-?\d+$/.test(nilai)) return BigInt(nilai);
  return null;
}
