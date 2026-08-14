import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';

/**
 * FR-E5 — penandaan habis MANUAL.
 *
 * `spec-e:203`: "Barista tahu kopi habis sebelum sistem tahu. Alur ini lebih
 * andal daripada hitungan otomatis dan wajib ada."
 *
 * ## ⛔ Terpisah dari stok terhitung, dan tidak pernah saling menyimpulkan
 *
 * `spec-e:220`: produk dapat ditandai habis meskipun stok tercatat masih 10 —
 * bahan habis, mesin rusak, atau alasan lain yang tidak ada di ledger. Dan
 * sebaliknya: stok nol tidak menandai produk habis, karena stok nol dengan
 * `allow_negative_stock = true` masih boleh dijual.
 *
 * Menyimpulkan salah satu dari yang lain menghapus persis informasi yang
 * membuat alur ini lebih andal.
 *
 * ## Tabel LOG, penanda terbaru menang lewat HLC
 *
 * Tidak ada satu baris per produk. Dua perangkat yang menandai produk yang
 * sama saat offline sama-sama menulis, dan yang menang ditentukan HLC — bukan
 * baris yang kebetulan ditulis belakangan. Bentuknya sama dengan servernya.
 *
 * ## Belum naik ke server
 *
 * `spec-e:211` menyebut penandaan masuk antrean sinkronisasi. Endpoint-nya
 * belum ada, dan meng-enqueue item yang tidak punya rute akan membakar
 * hitungan percobaannya sampai `failed` permanen — antrean yang merah tanpa
 * ada yang salah. Karena itu penandaan saat ini LOKAL saja, dan itu utang yang
 * dicatat, bukan yang disembunyikan.
 */

export interface KonfigOutlet {
  tenantId: string;
  outletId: string;
}

function keNomor(nilai: unknown): number {
  if (typeof nilai === 'number') return nilai;
  if (typeof nilai === 'bigint') return Number(nilai);
  if (typeof nilai === 'string') return Number(nilai);
  return 0;
}

/**
 * Menandai (atau membatalkan penandaan) satu produk.
 *
 * Berlaku SEKETIKA di perangkat ini — `spec-e:226` menuntutnya "tanpa
 * menunggu jaringan".
 */
export async function tandaiHabis(
  db: DbLokal,
  konfig: KonfigOutlet,
  {
    variationId,
    habis,
    userId,
    waktu,
    idBaru,
    hlc,
  }: {
    variationId: string;
    habis: boolean;
    userId: string;
    waktu: () => Date;
    idBaru: () => string;
    hlc: () => bigint;
  }
): Promise<void> {
  await db.execute(
    `INSERT INTO sold_out_flag
       (id, tenant_id, outlet_id, variation_id, is_sold_out, set_by, set_at, hlc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      idBaru(),
      konfig.tenantId,
      konfig.outletId,
      variationId,
      habis ? 1 : 0,
      userId,
      waktu().toISOString(),
      Number(hlc()),
    ]
  );
}

/**
 * Variation mana yang sedang ditandai habis di outlet ini.
 *
 * ⛔ Yang dibaca adalah penanda TERBARU per produk, dan urutannya ditentukan
 * di JS — bukan lewat `ORDER BY` saja. Jaminan urutan yang hanya hidup di SQL
 * tidak dapat diuji sama sekali; fake `DbLokal` tidak menegakkannya.
 *
 * Baris ber-`is_sold_out = 0` adalah pembatalan penandaan, dan ia harus
 * menang bila lebih baru — kalau hanya baris bernilai 1 yang dibaca, produk
 * yang sudah tersedia lagi tetap terlihat habis selamanya.
 */
export async function bacaHabis(db: DbLokal, konfig: KonfigOutlet): Promise<Set<string>> {
  const baris = await db.getAll<{ variation_id: string; is_sold_out: unknown; hlc: unknown }>(
    `SELECT variation_id, is_sold_out, hlc FROM sold_out_flag
      WHERE tenant_id = ? AND outlet_id = ?`,
    [konfig.tenantId, konfig.outletId]
  );

  const terbaru = new Map<string, { hlc: number; habis: boolean }>();
  for (const b of baris) {
    const h = keNomor(b.hlc);
    const kini = terbaru.get(b.variation_id);
    if (!kini || h > kini.hlc) {
      terbaru.set(b.variation_id, { hlc: h, habis: keNomor(b.is_sold_out) === 1 });
    }
  }

  const hasil = new Set<string>();
  for (const [variationId, v] of terbaru) if (v.habis) hasil.add(variationId);
  return hasil;
}

/**
 * Penandaan yang perlu dikonfirmasi saat shift baru dibuka.
 *
 * `spec-e:222`: reset "dengan konfirmasi — mencegah produk tetap tertandai
 * habis berhari-hari karena lupa."
 *
 * ⛔ Fungsi ini TIDAK mereset apa pun. Ia hanya menjawab "apa saja yang masih
 * tertandai", supaya layar buka shift dapat menanyakannya. `spec-e:229`
 * menolak reset otomatis diam-diam: kopi yang memang masih habis akan
 * kembali terjual tanpa ada yang tahu, dan kasir menerima pesanan yang tidak
 * dapat dipenuhi.
 */
export async function perluKonfirmasiReset(
  db: DbLokal,
  konfig: KonfigOutlet
): Promise<string[]> {
  return [...(await bacaHabis(db, konfig))].sort();
}

/**
 * Membatalkan penandaan untuk daftar produk yang DIPILIH pengguna.
 *
 * Menerima daftar, bukan "semua": konfirmasi yang hanya menawarkan ya/tidak
 * memaksa kasir memilih antara mereset kopi yang memang masih habis atau
 * membiarkan roti yang sudah tersedia tetap tertandai.
 */
export async function resetHabis(
  db: DbLokal,
  konfig: KonfigOutlet,
  {
    variationIds,
    userId,
    waktu,
    idBaru,
    hlc,
  }: {
    variationIds: readonly string[];
    userId: string;
    waktu: () => Date;
    idBaru: () => string;
    hlc: () => bigint;
  }
): Promise<void> {
  for (const variationId of variationIds) {
    await tandaiHabis(db, konfig, {
      variationId,
      habis: false,
      userId,
      waktu,
      idBaru,
      hlc,
    });
  }
}
