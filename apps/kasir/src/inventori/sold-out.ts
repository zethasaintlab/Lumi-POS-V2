import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import { simpanHlc } from '../lokal/hlc.ts';

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
 * ## Naik lewat outbox, sejak `POST /inventory/sold-out` ada
 *
 * `spec-e:211` menyebut penandaan masuk antrean sinkronisasi. Sampai endpoint
 * itu dibangun, penandaan LOKAL saja — meng-enqueue item yang tidak punya rute
 * akan membakar hitungan percobaannya sampai `failed` permanen, antrean merah
 * tanpa ada yang salah. Endpoint itu kini ada, dan batas itu hilang bersamanya.
 *
 * Akibat dari ketiadaannya, dan alasan ia akhirnya dibangun: barista menandai
 * kopi habis di terminal 1, dan kasir di terminal 2 tetap menerima pesanannya.
 * Jalur turunnya sudah ada sejak F2 (`sold_out_flag` adalah raw table yang
 * direplikasi); yang hilang hanya jalur naiknya.
 *
 * ## ⛔ SATU transaksi: penanda + HLC + outbox
 *
 * Bentuk yang sama dengan penjualan dan buka shift, dan alasannya sama.
 * Penanda yang ter-commit tanpa item outbox-nya tidak akan pernah naik, dan
 * tidak ada apa pun yang akan memperbaikinya sendiri. HLC yang tidak
 * tersimpan lebih halus: boot berikutnya memuat nilai lama, dan tick
 * berikutnya dapat menghasilkan HLC yang SUDAH DIPAKAI penanda yang ada —
 * pelanggaran I10 yang tidak menghasilkan error, hanya membuat "mana yang
 * lebih baru" tidak terjawab di tempat yang justru memutuskannya.
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
  const id = idBaru();
  const idOutbox = idBaru();
  const occurredAt = waktu().toISOString();
  const hlcValue = hlc();

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO sold_out_flag
         (id, tenant_id, outlet_id, variation_id, is_sold_out, set_by, set_at, hlc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        konfig.tenantId,
        konfig.outletId,
        variationId,
        habis ? 1 : 0,
        userId,
        occurredAt,
        // ⛔ `Number`, bukan string: kolom lokalnya `INTEGER`, dan bentuk yang
        // sama sudah dipakai `cash_movement.hlc`. Keadaan HLC yang disimpan
        // di `device_config` tetap TEXT — lihat `simpanHlc`.
        Number(hlcValue),
      ]
    );

    await simpanHlc(tx, hlcValue);

    await enqueue(tx, {
      id: idOutbox,
      entityType: 'sold_out',
      // ⛔ id BARIS penandaan, bukan variation. Satu produk ditandai
      // berkali-kali; memakai variation membuat penandaan kemarin yang gagal
      // terkirim menampilkan status merah pada penandaan hari ini
      // (`statusRecordBanyak` memakai aturan terburuk-menang per entitas).
      entityId: id,
      operation: 'create',
      // Bentuknya PERSIS `required` di `POST /inventory/sold-out`. Payload
      // yang tidak cocok baru ketahuan saat relay mengirimnya — dan item itu
      // membakar hitungan percobaannya sampai `failed` permanen.
      payload: {
        id,
        outletId: konfig.outletId,
        variationId,
        isSoldOut: habis,
        hlc: hlcValue.toString(),
        occurredAt,
      },
      // Idempotency-Key = id penanda. Retry membawa kunci yang sama, dan
      // server menjawab respons aslinya alih-alih menulis penanda kedua.
      idempotencyKey: id,
      createdAt: occurredAt,
      // Aktor DIBEKUKAN sekarang, bukan dibaca saat pengiriman. Antrean dapat
      // terkuras setelah pergantian shift.
      actorId: userId,
    });
  });
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
