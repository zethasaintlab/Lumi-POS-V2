import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';

/**
 * FR-E1 / E.4 — pembacaan stok di perangkat.
 *
 * ## Stok adalah `SUM(delta)`, dan tidak ada kolom `quantity`
 *
 * Invariant Modul E nomor 1. Alasannya tiga, dan ketiganya menuntut bentuk
 * yang sama (`spec-e:29`): dua device offline yang menjual produk sama
 * menghasilkan konflik last-write-wins yang menghilangkan penjualan secara
 * diam-diam; "kenapa stok kopi tinggal 3 padahal kemarin 40" hanya dapat
 * dijawab bila setiap perubahan punya record; dan metrik actual-vs-theoretical
 * butuh dua aliran pada ledger yang sama.
 *
 * ## Kenapa ada snapshot
 *
 * `[FAKTA — diukur 27 Jul 2026]` agregasi langsung melewati 200 ms pada
 * ≈39.000–66.000 movement di tablet kasir — dicapai kafe besar dalam kurang
 * dari 30 hari. Snapshot + delta: 116,3 ms → 1,1 ms, 107× lebih cepat
 * (`prototypes/01-sqlite-sizing/FINDINGS.md` §5).
 *
 * Bentuk pembacaannya (`spec-e:62`):
 *
 *     snapshot.balance + COALESCE(SUM(delta) WHERE hlc > checkpoint_hlc, 0)
 *
 * ⛔ Menjumlahkan SELURUH movement di atas snapshot menghitung dua kali setiap
 * pergerakan yang sudah masuk ke dalamnya — dan itu tidak menghasilkan error,
 * hanya angka yang salah. Karena itu ada uji drift yang menuntut snapshot dan
 * agregasi langsung selalu identik (`spec-e:331`).
 */

export interface KonfigStok {
  tenantId: string;
  outletId: string;
}

/**
 * Nilai `INTEGER` dari database, dalam ketiga bentuk yang muncul.
 *
 * `@powersync/web` mengembalikan kolom INTEGER besar sebagai `bigint`,
 * `node:sqlite` sebagai `number`. Guard yang hanya memeriksa `number` tidak
 * pernah mengambil cabangnya, dan itu hijau di seluruh test sambil salah di
 * aplikasi — pelajaran yang sudah dibayar sekali saat menutup I10.
 */
function keNomor(nilai: unknown): number {
  if (typeof nilai === 'number') return nilai;
  if (typeof nilai === 'bigint') return Number(nilai);
  if (typeof nilai === 'string') return Number(nilai);
  return 0;
}

/**
 * Stok satu variation, lewat snapshot bila ada.
 *
 * ⛔ Disaring per OUTLET, bukan hanya per variation. Perangkat yang pernah
 * berpindah outlet masih menyimpan movement lama, dan menjumlahkannya membuat
 * stok cabang lain bocor ke angka cabang ini.
 */
export async function bacaStok(
  db: DbLokal,
  konfig: KonfigStok,
  variationId: string
): Promise<number> {
  const peta = await bacaStokBanyak(db, konfig, [variationId]);
  return peta.get(variationId) ?? 0;
}

/**
 * Stok banyak variation sekaligus — untuk grid kasir.
 *
 * Satu query untuk snapshot dan satu untuk delta, bukan dua query per produk:
 * grid K-03 menampilkan puluhan kartu sekaligus, dan pembacaan per kartu
 * menjadikan pembukaan layar itu N+1.
 */
export async function bacaStokBanyak(
  db: DbLokal,
  konfig: KonfigStok,
  variationIds: readonly string[]
): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  if (variationIds.length === 0) return hasil;
  for (const id of variationIds) hasil.set(id, 0);

  const tanda = variationIds.map(() => '?').join(',');

  const snapshots = await db.getAll<{ variation_id: string; balance: unknown; checkpoint_hlc: unknown }>(
    `SELECT variation_id, balance, checkpoint_hlc FROM stock_snapshot
      WHERE tenant_id = ? AND outlet_id = ? AND variation_id IN (${tanda})`,
    [konfig.tenantId, konfig.outletId, ...variationIds]
  );
  const checkpoint = new Map<string, number>();
  for (const s of snapshots) {
    hasil.set(s.variation_id, keNomor(s.balance));
    checkpoint.set(s.variation_id, keNomor(s.checkpoint_hlc));
  }

  const gerakan = await db.getAll<{ variation_id: string; delta: unknown; hlc: unknown }>(
    `SELECT variation_id, delta, hlc FROM stock_movement
      WHERE tenant_id = ? AND outlet_id = ? AND variation_id IN (${tanda})`,
    [konfig.tenantId, konfig.outletId, ...variationIds]
  );
  for (const g of gerakan) {
    // ⛔ Hanya delta SETELAH checkpoint. Variation tanpa snapshot punya
    // checkpoint −∞ secara efektif, jadi seluruh movementnya dihitung.
    const batas = checkpoint.get(g.variation_id);
    if (batas !== undefined && keNomor(g.hlc) <= batas) continue;
    hasil.set(g.variation_id, (hasil.get(g.variation_id) ?? 0) + keNomor(g.delta));
  }

  return hasil;
}

/**
 * Agregasi LANGSUNG, mengabaikan snapshot sepenuhnya.
 *
 * Ada untuk satu alasan: uji drift `spec-e:331` menuntut snapshot dan
 * agregasi langsung menghasilkan angka identik. Cache yang menyimpang dari
 * sumbernya lebih buruk daripada tidak ada cache, dan satu-satunya cara
 * mengetahuinya adalah punya kedua jalur.
 */
export async function bacaStokLangsung(
  db: DbLokal,
  konfig: KonfigStok,
  variationId: string
): Promise<number> {
  const baris = await db.getAll<{ delta: unknown }>(
    `SELECT delta FROM stock_movement
      WHERE tenant_id = ? AND outlet_id = ? AND variation_id = ?`,
    [konfig.tenantId, konfig.outletId, variationId]
  );
  let total = 0;
  for (const b of baris) total += keNomor(b.delta);
  return total;
}

/**
 * Membangun ulang seluruh snapshot outlet ini.
 *
 * `spec-e:63`: dijalankan saat TUTUP SHIFT — jeda operasional alami, biaya
 * terukur 126 ms.
 *
 * ⛔ `checkpoint_hlc` WAJIB ikut naik ke hlc tertinggi yang masuk ke saldo.
 * Kalau tidak, delta yang sudah terhitung akan dijumlahkan lagi di atas saldo
 * yang sudah memuatnya — dan stok tumbuh setiap kali rebuild dijalankan.
 * Karena itu rebuild yang dijalankan dua kali diuji secara terpisah.
 */
export async function bangunUlangSnapshot(db: DbLokal, konfig: KonfigStok): Promise<void> {
  const baris = await db.getAll<{ variation_id: string; delta: unknown; hlc: unknown }>(
    `SELECT variation_id, delta, hlc FROM stock_movement
      WHERE tenant_id = ? AND outlet_id = ?`,
    [konfig.tenantId, konfig.outletId]
  );

  const saldo = new Map<string, number>();
  const tertinggi = new Map<string, number>();
  for (const b of baris) {
    saldo.set(b.variation_id, (saldo.get(b.variation_id) ?? 0) + keNomor(b.delta));
    const h = keNomor(b.hlc);
    if (h > (tertinggi.get(b.variation_id) ?? -Infinity)) tertinggi.set(b.variation_id, h);
  }

  // Tidak ada movement berarti tidak ada snapshot yang perlu dibangun. Keluar
  // SEBELUM membuka transaksi: `BEGIN IMMEDIATE` mengambil kunci global di
  // `wa-sqlite`, dan mengambilnya untuk menulis nol baris menahan penulisan
  // lain tanpa alasan.
  if (saldo.size === 0) return;

  await db.transaction(async (tx) => {
    for (const [variationId, balance] of saldo) {
      // ⛔ DELETE lalu INSERT, bukan `ON CONFLICT` — `ON CONFLICT(id)` pernah
      // diterima `node:sqlite` dan DITOLAK `wa-sqlite`, seluruh test hijau
      // sementara aplikasinya gagal (8 Agustus 2026). Bentuk yang sederhana
      // berlaku di keduanya.
      await tx.execute(
        `DELETE FROM stock_snapshot WHERE tenant_id = ? AND outlet_id = ? AND variation_id = ?`,
        [konfig.tenantId, konfig.outletId, variationId]
      );
      await tx.execute(
        `INSERT INTO stock_snapshot (tenant_id, outlet_id, variation_id, balance, checkpoint_hlc)
         VALUES (?, ?, ?, ?, ?)`,
        [konfig.tenantId, konfig.outletId, variationId, balance, tertinggi.get(variationId) ?? 0]
      );
    }
  });
}
