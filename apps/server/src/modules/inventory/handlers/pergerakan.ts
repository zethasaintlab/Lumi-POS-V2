import { randomUUID } from 'node:crypto';
import type { PoolClient } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';

/**
 * Permukaan publik modul `inventory` — irisan minimal Modul E.
 *
 * Lahir dengan satu fungsi. Keputusan user 1 Agustus 2026 menetapkan void
 * **wajib** mengembalikan stok otomatis, dan invariant #1 menuntutnya ditulis
 * dalam transaksi yang SAMA dengan void — bukan sebagai event asinkron.
 * Invariant #4 melarang modul `ordering` menyentuh `stock_movement` langsung.
 *
 * Perhitungan stok (`SUM(stock_movement.delta)` — `CLAUDE.md` menegaskan
 * **tidak ada kolom `quantity`**), stocktake, deteksi oversell, dan sold-out
 * tetap Modul E penuh.
 */

export type StockMovementType =
  | 'sale'
  | 'void'
  | 'refund'
  | 'receipt'
  | 'adjustment'
  | 'stocktake'
  | 'transfer_in'
  | 'transfer_out';

export interface StockMovementInput {
  id: string;
  tenantId: string;
  outletId: string;
  deviceId: string | null;
  variationId: string;
  type: StockMovementType;
  /**
   * Kuantitas ×1000, **bertanda** (`CLAUDE.md` § Konvensi data).
   *
   * Void dan refund MENGEMBALIKAN stok, jadi positif. Penjualan negatif.
   * `bigint`, bukan `number`: kuantitas ikut aturan yang sama dengan uang.
   */
  delta: bigint;
  orderId: string | null;
  /**
   * Opname yang menghasilkan movement ini.
   *
   * ⛔ Kolomnya ada di skema sejak migrasi 0010 dan tidak pernah diisi. Tanpa
   * ia, movement hasil opname tidak dapat ditelusuri kembali ke hitungan fisik
   * mana pun — dan opname yang tidak dapat ditelusuri tidak dapat diaudit.
   */
  stocktakeId?: string | null;
  reasonCode: string | null;
  note?: string | null;
  unitCost?: bigint | null;
  createdBy: string;
  hlc: bigint;
  occurredAt?: string | null;
}

/**
 * Menulis pergerakan stok, seluruhnya atau tidak sama sekali.
 *
 * ## `variation_id` TIDAK punya FK
 *
 * Lihat `db/migrations/0010_inventory.sql`: `variation_id` adalah `text NOT
 * NULL` tanpa referensi. Bukan sekadar FK yang tidak tunduk RLS (temuan F1) —
 * di sini tidak ada apa pun di database yang menolak id karangan, apalagi id
 * milik tenant lain. Kelas yang sama dengan `price_history.changed_by` dan
 * `tax_rate.applies_to_ids`, dan sama berbahayanya karena tidak ada yang
 * TERLIHAT menjaganya.
 *
 * Validasinya karena itu memeriksa SELURUH daftar dalam satu SELECT yang
 * tunduk RLS, dan menolak seluruhnya bila ada satu yang tidak sah. Menerima
 * sebagian akan mencatat pergerakan stok yang separuh menunjuk data tenant
 * lain — terlihat berhasil, dan itu bentuk kegagalan yang lebih buruk
 * daripada ditolak.
 */
export async function recordStockMovements(
  client: PoolClient,
  movements: ReadonlyArray<StockMovementInput>
): Promise<void> {
  if (movements.length === 0) {
    return;
  }

  const variationIds = [...new Set(movements.map((m) => m.variationId))];
  const { rows: visible } = await client.query<{ id: string }>(
    'SELECT id FROM item_variation WHERE id = ANY($1::text[])',
    [variationIds]
  );
  const terlihat = new Set(visible.map((r) => r.id));
  const hilang = variationIds.filter((id) => !terlihat.has(id));
  if (hilang.length > 0) {
    throw new HttpError(404, 'VARIATION_NOT_FOUND', `Variation tidak ditemukan: ${hilang.join(', ')}.`);
  }

  for (const m of movements) {
    if (typeof m.delta !== 'bigint') {
      throw new TypeError(`delta harus bigint, bukan ${typeof m.delta}. Kuantitas x1000, bertanda.`);
    }
    await client.query(
      `INSERT INTO stock_movement (
         id, tenant_id, outlet_id, device_id, variation_id, type, delta,
         order_id, stocktake_id, reason_code, note, unit_cost, created_by,
         occurred_at, hlc
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, COALESCE($14::timestamptz, now()), $15
       )`,
      [
        m.id, m.tenantId, m.outletId, m.deviceId, m.variationId, m.type, m.delta.toString(),
        m.orderId, m.stocktakeId ?? null, m.reasonCode, m.note ?? null,
        m.unitCost === undefined || m.unitCost === null ? null : m.unitCost.toString(),
        m.createdBy, m.occurredAt ?? null, m.hlc.toString(),
      ]
    );
  }
}

/**
 * FR-E6 — deteksi oversell pasca-sinkronisasi.
 *
 * ## Yang TIDAK dilakukan fungsi ini
 *
 * Ia tidak menolak apa pun, dan itu bukan kelalaian. `spec-e:166`: dua device
 * offline yang menjual item terakhir akan sama-sama BERHASIL — konsekuensi
 * teorema CAP, bukan bug. Pencegahan adalah non-goal PERMANEN, dinyatakan di
 * PRD, di materi penjualan, dan di dokumentasi merchant.
 *
 * Yang dapat dan harus dilakukan: membuat konsekuensinya TERLIHAT dan
 * tertangani sebagai proses bisnis.
 *
 * ## Satu event per masalah, bukan per penjualan
 *
 * `spec-e:197` menuntut "tepat satu OversellEvent" untuk dua device yang
 * menjual item terakhir. Penjualan ketiga MEMPERBESAR event yang sama —
 * oversell yang memburuk adalah masalah yang sama yang membesar, dan manajer
 * memeriksanya sekali.
 *
 * ⛔ Kecuali event sebelumnya sudah DISELESAIKAN. Menempelkan kejadian baru
 * ke event yang sudah ditandai selesai menyembunyikannya di balik sesuatu
 * yang sudah dicoret manajer dari daftar "perlu diperiksa".
 *
 * ## Penyelesaiannya milik manusia
 *
 * `spec-e:189`: manajer memeriksa dan memilih — stok memang salah, barang
 * memang lebih banyak, atau satu transaksi salah. Sistem TIDAK
 * menyelesaikannya otomatis, dan fungsi ini karena itu tidak pernah menulis
 * `resolved_by`.
 */
export async function detectOversell(
  client: PoolClient,
  {
    tenantId,
    outletId,
    variationIds,
  }: {
    tenantId: string;
    outletId: string;
    /**
     * Variation yang baru saja terjual. Perangkat dan order yang TERLIBAT
     * tidak ikut diserahkan: keduanya dibaca dari `stock_movement`, yang
     * sudah ditulis di transaksi yang sama sebelum fungsi ini dipanggil.
     * Menyerahkannya berarti hanya penjualan TERAKHIR yang tercatat di
     * konteks — dan oversell selalu melibatkan lebih dari satu.
     */
    variationIds: readonly string[];
  }
): Promise<void> {
  if (variationIds.length === 0) return;

  const unik = [...new Set(variationIds)];
  // Seluruh pergerakan produk-produk ini, terurut kausal. Dibutuhkan utuh —
  // bukan sekadar `SUM(delta)` — karena konteks event menyebut penjualan MANA
  // yang memperebutkan stok yang sama, dan itu hanya terbaca dari urutannya.
  const { rows: semua } = await client.query<{
    variation_id: string;
    delta: string;
    type: string;
    device_id: string | null;
    order_id: string | null;
  }>(
    `SELECT variation_id, delta::text AS delta, type, device_id, order_id
       FROM stock_movement
      WHERE tenant_id = $1 AND outlet_id = $2 AND variation_id = ANY($3::text[])
      ORDER BY hlc, id`,
    [tenantId, outletId, unik]
  );

  const perVariation = new Map<string, typeof semua>();
  for (const m of semua) {
    const daftar = perVariation.get(m.variation_id) ?? [];
    daftar.push(m);
    perVariation.set(m.variation_id, daftar);
  }

  for (const [variationId, gerakan] of perVariation) {
    let saldo = 0n;
    for (const m of gerakan) saldo += BigInt(m.delta);

    // Stok yang masih nol atau positif bukan oversell. Nol berarti habis
    // pas — tidak ada yang terjual melebihi yang ada.
    if (saldo >= 0n) continue;
    const kelebihan = -saldo;

    // ⛔ Penjualan MANA yang memperebutkan stok yang sama.
    //
    // Versi pertama hanya mencatat perangkat yang sedang menulis, dan itu
    // salah dengan cara yang merugikan: event lahir pada penjualan KEDUA,
    // jadi perangkat pertama — yang juga mengambil dari stok yang sama —
    // tidak pernah muncul. Manajer melihat satu perangkat disebut untuk
    // masalah yang melibatkan dua.
    //
    // Yang implicated: setiap penjualan sejak saldo terakhir kali masih
    // POSITIF. Di situlah stok terakhir tersedia, dan setiap penjualan
    // sesudahnya memperebutkannya.
    let berjalan = 0n;
    let mulai = 0;
    for (let i = 0; i < gerakan.length; i += 1) {
      berjalan += BigInt(gerakan[i].delta);
      if (berjalan > 0n) mulai = i + 1;
    }

    const terlibat = gerakan.slice(mulai).filter((m) => m.type === 'sale');
    const perangkatTerlibat = [...new Set(terlibat.map((m) => m.device_id).filter(Boolean))] as string[];
    const orderTerlibat = [...new Set(terlibat.map((m) => m.order_id).filter(Boolean))] as string[];

    // Event yang BELUM diselesaikan untuk produk ini di outlet ini.
    const { rows: adaRows } = await client.query<{
      id: string;
      devices_involved: string[] | null;
      orders_involved: string[] | null;
    }>(
      `SELECT id, devices_involved, orders_involved
         FROM oversell_event
        WHERE tenant_id = $1 AND outlet_id = $2 AND variation_id = $3
          AND resolved_at IS NULL
        ORDER BY detected_at DESC
        LIMIT 1`,
      [tenantId, outletId, variationId]
    );

    const ada = adaRows[0];
    if (!ada) {
      await client.query(
        `INSERT INTO oversell_event
           (id, tenant_id, outlet_id, variation_id, devices_involved, orders_involved, quantity_over)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
        [
          randomUUID(),
          tenantId,
          outletId,
          variationId,
          JSON.stringify(perangkatTerlibat),
          JSON.stringify(orderTerlibat),
          kelebihan.toString(),
        ]
      );
      continue;
    }

    // ⛔ Konteksnya DITAMBAH, bukan ditimpa. `spec-e:194` menuntut konteks
    // lengkap — manajer yang harus memutuskan tidak dapat menyelidiki event
    // yang hanya menyebut perangkat terakhir.
    const perangkat = new Set([...(ada.devices_involved ?? []), ...perangkatTerlibat]);
    const order = new Set([...(ada.orders_involved ?? []), ...orderTerlibat]);

    await client.query(
      `UPDATE oversell_event
          SET devices_involved = $1::jsonb, orders_involved = $2::jsonb, quantity_over = $3
        WHERE id = $4`,
      [
        JSON.stringify([...perangkat]),
        JSON.stringify([...order]),
        kelebihan.toString(),
        ada.id,
      ]
    );
  }
}

/**
 * Membalik seluruh movement `sale` milik satu order.
 *
 * ## ⛔ Kenapa membaca movement, bukan menghitung ulang dari `order_line`
 *
 * Yang harus dikembalikan adalah **apa yang benar-benar diambil**, bukan apa
 * yang seharusnya diambil. `track_stock` sebuah variation dapat berubah
 * setelah penjualan terjadi: menghitung ulang dari `order_line` akan
 * mengembalikan barang yang tidak pernah dikurangi (kalau dinyalakan
 * belakangan), atau melewatkan barang yang sudah dikurangi (kalau dimatikan).
 *
 * Ledger adalah kebenarannya. Membalik isinya tidak dapat salah dengan cara
 * itu.
 *
 * ## ⛔ Fungsinya ada di SINI, bukan di `ordering`
 *
 * `stock_movement` milik modul ini (invariant #4). `cancel.ts` sudah membaca
 * tabel itu langsung dan menjadi salah satu dari tujuh pelanggaran batas modul
 * yang tercatat di `PENYELIDIKAN-b02-b04.md` §4 — jalur baru tidak menambah
 * yang kedelapan.
 */
export async function reverseSaleMovements(
  client: PoolClient,
  params: {
    tenantId: string;
    orderId: string;
    type: StockMovementType;
    reasonCode: string | null;
    note: string | null;
    createdBy: string;
    hlc: bigint;
    occurredAt?: string | null;
  }
): Promise<{ ditulis: number; totalDikembalikan: bigint }> {
  const { rows } = await client.query<{
    outlet_id: string;
    device_id: string | null;
    variation_id: string;
    total: string;
  }>(
    // Dijumlahkan per variation: satu order dapat punya beberapa baris untuk
    // variation yang sama (modifier memisahkan baris, stoknya satu).
    `SELECT outlet_id, MIN(device_id) AS device_id, variation_id, SUM(delta)::text AS total
       FROM stock_movement
      WHERE order_id = $1 AND type = 'sale'
      GROUP BY outlet_id, variation_id`,
    [params.orderId]
  );
  if (rows.length === 0) return { ditulis: 0, totalDikembalikan: 0n };

  let total = 0n;
  const movements: StockMovementInput[] = [];
  for (const r of rows) {
    // Dibalik tandanya. `sale` selalu negatif, jadi ini selalu positif.
    const dikembalikan = -BigInt(r.total);
    if (dikembalikan === 0n) continue;
    total += dikembalikan;
    movements.push({
      id: randomUUID(),
      tenantId: params.tenantId,
      outletId: r.outlet_id,
      deviceId: r.device_id,
      variationId: r.variation_id,
      type: params.type,
      delta: dikembalikan,
      orderId: params.orderId,
      reasonCode: params.reasonCode,
      note: params.note,
      createdBy: params.createdBy,
      hlc: params.hlc,
      occurredAt: params.occurredAt ?? null,
    });
  }
  if (movements.length === 0) return { ditulis: 0, totalDikembalikan: 0n };

  await recordStockMovements(client, movements);
  return { ditulis: movements.length, totalDikembalikan: total };
}
