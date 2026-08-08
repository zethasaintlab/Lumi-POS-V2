// Satu penjualan = 10 baris di 9 tabel.
//
// Bentuk dan isinya SAMA dengan `prototypes/03-sqlite-opfs/src/worker.js`,
// supaya angka latensi di sini dapat dibandingkan langsung dengan §5b FINDINGS
// prototipe 03. Yang berbeda hanya cara mengirimnya: di sana satu string
// `BEGIN;…;COMMIT;`, di sini ~10 panggilan `tx.execute` di dalam satu
// `writeTransaction` — karena itulah bentuk yang dipaksa API PowerSync, dan
// mengukur bentuk yang tidak akan dipakai tidak mengukur apa pun.

const W = '2026-08-07T10:00:00Z';

/**
 * @param n nomor urut penjualan
 * @param rusakDiAkhir bila true, pernyataan TERAKHIR (outbox) melanggar
 *   NOT NULL. Ini yang menguji rollback: sembilan baris sebelumnya sudah
 *   ditulis saat ia gagal.
 */
export function pernyataanPenjualan(n, { rusakDiAkhir = false } = {}) {
  const id = `ord-${n}`;
  const c = `chk-${n}`;
  const s = [];

  s.push([
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,
      sequence,status,channel,subtotal,order_discount,service_charge_amount,tax_amount,
      rounding_adjustment,total,amount_due,has_calculation_variance,created_by,occurred_at,
      recorded_at,hlc) VALUES (?,'ten-1','out-1','dev-1','shf-1',?,'2026-08-07',?,'closed',
      'takeaway',40000,0,0,4400,0,44400,44400,0,'usr-1',?,?,?)`,
    [id, `K1-20260807-${String(n).padStart(4, '0')}`, n, W, W, n],
  ]);

  s.push([
    `INSERT INTO "check" (id,order_id,label,subtotal,total) VALUES (?,?,NULL,40000,44400)`,
    [c, id],
  ]);

  for (let i = 0; i < 2; i += 1) {
    const l = `${id}-l${i}`;
    s.push([
      `INSERT INTO order_line (id,order_id,check_id,variation_id,item_name,variation_name,
        unit_price,quantity,modifier_snapshot,discount_amount,tax_rate_id,tax_rate,tax_amount,
        is_tax_inclusive,cost_at_sale,line_total)
       VALUES (?,?,?,?,'Kopi Susu','Regular',20000,1000,'[]',0,'tax-1',1100,2200,0,8000,20000)`,
      [l, id, c, `var-${i}`],
    ]);
    if (i === 0) {
      s.push([
        `INSERT INTO order_line_modifier (id,order_line_id,modifier_id,name,price,quantity)
         VALUES (?,?,'mod-1','Extra shot',5000,1000)`,
        [`${l}-m0`, l],
      ]);
    }
    s.push([
      `INSERT INTO stock_movement (id,tenant_id,outlet_id,device_id,variation_id,type,delta,
        order_id,reason_code,created_by,occurred_at,recorded_at,hlc)
       VALUES (?,'ten-1','out-1','dev-1',?,'sale',-1000,?,NULL,'usr-1',?,?,?)`,
      [`${l}-s`, `var-${i}`, id, W, W, n],
    ]);
  }

  s.push([
    `INSERT INTO payment (id,order_id,check_id,method,amount,tendered_amount,change_amount,
      status,confirmed_manually,tendered_at) VALUES (?,?,?,'cash',44400,50000,5600,'confirmed',0,?)`,
    [`${id}-p`, id, c, W],
  ]);

  s.push([
    `INSERT INTO audit_event (id,tenant_id,outlet_id,device_id,actor_user_id,approver_user_id,
      event_type,entity_type,entity_id,reason_code,occurred_at,recorded_at,hlc)
     VALUES (?,'ten-1','out-1','dev-1','usr-1',NULL,'order.created','order',?,NULL,?,?,?)`,
    [`${id}-a`, id, W, W, n],
  ]);

  // Pernyataan terakhir. `idempotency_key` NOT NULL — mengirim NULL membuatnya
  // gagal SETELAH sembilan baris sebelumnya masuk.
  s.push([
    `INSERT INTO outbox_local (id,entity_type,entity_id,operation,payload,idempotency_key,
      status,attempts,created_at) VALUES (?,'order',?,'create','{}',?,'pending',0,?)`,
    [`${id}-o`, id, rusakDiAkhir ? null : `key-${n}`, W],
  ]);

  return s;
}

// Kedelapan tabel yang disentuh satu penjualan, beserta cara menemukan
// barisnya kembali dari id order. Dipakai untuk menghitung sisa baris setelah
// rollback — nol adalah satu-satunya jawaban yang benar.
//
// (Sepuluh baris, DELAPAN tabel. FINDINGS prototipe 03 §5b menulis "9 tabel";
// itu keliru, dan dikoreksi di sana.)
export const TABEL_PENJUALAN = [
  ['order', 'id = ?'],
  ['check', 'order_id = ?'],
  ['order_line', 'order_id = ?'],
  ['order_line_modifier', "order_line_id LIKE ? || '-%'"],
  ['stock_movement', 'order_id = ?'],
  ['payment', 'order_id = ?'],
  ['audit_event', 'entity_id = ?'],
  ['outbox_local', 'entity_id = ?'],
];
