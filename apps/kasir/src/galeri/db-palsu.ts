import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { antreanUntuk, itemUntuk, orderUntuk, type NamaSkenario } from './skenario.ts';

/**
 * `DbLokal` palsu untuk galeri — mendispatch per NAMA TABEL, bukan per query.
 *
 * ## ⛔ Kenapa per tabel dan bukan per query
 *
 * Layar kasir menjalankan SQL sungguhan. Fake yang mencocokkan query persis
 * akan patah setiap kali satu spasi di query berubah, dan galeri yang patah
 * tidak akan dipakai siapa pun. Yang dibutuhkan galeri hanya BENTUK barisnya
 * benar per tabel; nilainya datang dari skenario.
 *
 * ## ⛔ Batas yang dinyatakan
 *
 * Fake ini TIDAK menegakkan `NOT NULL`, `CHECK`, `ORDER BY`, maupun bentuk SQL
 * apa pun — pelajaran yang sudah dua kali dibayar di repo ini (`ON CONFLICT(id)`
 * dan `audit_event.tenant_id = NULL` keduanya hijau di fake dan gagal keras di
 * `wa-sqlite`). Ia ada untuk KERJA VISUAL, dan tidak boleh dipakai sebagai
 * pengganti test. Test yang butuh kebenaran SQL memakai SQLite sungguhan.
 */

function tabelDari(sql: string): string {
  // `\bFROM` dengan batas kata di depan: tanpanya potongan `from` di dalam nama
  // kolom (`effective_from`) tertangkap sebagai kata kunci, dan tabel yang
  // salah dikembalikan. Pelajaran yang sama sudah membuat satu penjaga
  // sync-rules buta selama berminggu-minggu.
  const m = /\bFROM\s+"?(\w+)"?/i.exec(sql);
  return m ? m[1]!.toLowerCase() : '';
}

const TAK_PERNAH_SELESAI = new Promise<never>(() => {});

/**
 * Jawaban untuk query agregat, dihitung dari baris yang sama.
 *
 * Cakupannya SEMPIT dan disengaja begitu: hanya bentuk agregat yang layar
 * galeri benar-benar jalankan. Fake yang mencoba menafsirkan SQL apa pun akan
 * menjadi mesin SQL kedua di repo ini, dan yang menyimpang darinya menghasilkan
 * galeri yang menampilkan angka yang aplikasi tidak pernah hasilkan.
 */
function agregat(tabel: string, sql: string, baris: readonly unknown[]): Record<string, unknown> {
  if (tabel !== 'outbox_local') return { n: baris.length };

  const rows = baris as { status: string; created_at: string }[];
  const hitung = (uji: (s: string) => boolean) => rows.filter((r) => uji(r.status)).length;
  const menunggu = hitung((s) => s === 'pending' || s === 'sending');
  const gagal = hitung((s) => s === 'failed');

  // `SELECT count(*) AS n …` punya satu kolom; ringkasan punya empat. Yang
  // membedakannya bentuk SQL-nya, bukan tebakan.
  if (/count\s*\(\s*\*\s*\)/i.test(sql)) {
    return { n: /'failed'/.test(sql) ? gagal : menunggu };
  }

  const tertua = rows
    .filter((r) => r.status !== 'sent')
    .map((r) => r.created_at)
    .sort()[0];
  return { menunggu, gagal, tertua: tertua ?? null, terakhir: null };
}

export function buatDbPalsu(skenario: NamaSkenario): DbLokal {
  const antre = antreanUntuk(skenario);
  const item = itemUntuk(skenario);
  const order = orderUntuk(skenario);

  /* ⛔ Stok datang dari `stock_movement`, bukan dari kolom `quantity` — itu
     konvensi data repo ini, dan galeri yang memakai kolom karangan akan
     menampilkan angka yang aplikasi sungguhan tidak pernah hasilkan.
     Sebagian varian sengaja MENIPIS dan satu MINUS: keduanya punya tampilan
     tersendiri di kartu produk, dan keduanya tidak pernah terlihat pada data
     yang seluruhnya sehat. */
  const gerakStok = item.map((b, i) => ({
    variation_id: b.variation_id,
    delta: i % 11 === 3 ? -2_000 : i % 5 === 0 ? 3_000 : 48_000,
    hlc: 1,
  }));

  const perTabel: Record<string, unknown[]> = {
    item,
    price_history: [],
    modifier_list: [],
    modifier: [],
    stock_movement: gerakStok,
    stock_snapshot: [],
    sold_out_flag: [],
    order,
    order_line: [],
    /* Campuran metode, bukan tunai seluruhnya: `spec-d:201` memisahkan uang
       laci dari uang bank, dan K-12 yang hanya pernah dilihat dengan tunai
       tidak pernah merender rincian per metode sama sekali. */
    payment: order
      .filter((o) => o.status !== 'voided')
      .map((o, i) => ({
        order_id: o.id,
        method: i % 3 === 1 ? 'qris_static' : 'cash',
        amount: o.total,
        status: 'confirmed',
      })),
    refund: [],
    cash_drawer_shift: [
      {
        id: 'shift-galeri',
        tenant_id: 'ten-galeri',
        outlet_id: 'outlet-1',
        device_id: 'dev-galeri',
        business_date: '2026-09-01',
        status: 'open',
        opening_float: 300_000,
        opened_by: 'user-galeri',
        opened_at: '2026-09-01T01:00:00.000Z',
        counted_amount: null,
        expected_amount: null,
        difference: null,
        count_attempts: 0,
        closed_by: null,
        approved_by: null,
        closed_at: null,
        variance_reason_code: null,
      },
    ],
    cash_movement: order.map((o, i) => ({
      id: `cm-${i}`,
      shift_id: 'shift-galeri',
      type: 'sale',
      delta: o.total,
      occurred_at: o.occurred_at,
    })),
    printer_profile: [
      {
        id: 'pp-58',
        name: 'Epson TM-m30 (58 mm)',
        paper_width_mm: 58,
        chars_per_line: 32,
        codepage: 'cp437',
        has_cutter: 1,
        init_command: null,
        cut_command: null,
        drawer_command: null,
        image_support: 0,
      },
    ],
    outlet: [
      {
        id: 'outlet-1',
        name: 'ORIGEN Menteng',
        timezone: 'Asia/Jakarta',
        business_day_ends_at: '04:00',
        rounding_increment: 0,
        rounding_mode: 'nearest',
        service_charge_rate: 0,
        vertical_profile_id: 'vp-1',
        discount_threshold_percent: 2000,
        discount_threshold_amount: 50000,
        cash_variance_threshold: 20000,
        no_sale_threshold: 3,
        archived_at: null,
      },
    ],
    vertical_profile: [
      {
        id: 'vp-1',
        name: 'fnb',
        allow_negative_stock: 1,
        is_tenant_default: 1,
        default_channel: 'takeaway',
        requires_barcode_flow: 0,
        default_tax_type: 'ppn',
      },
    ],
    device_config: [
      {
        id: 1,
        device_id: 'dev-galeri',
        device_code: 'K1',
        tenant_id: 'ten-galeri',
        outlet_id: 'outlet-1',
        base_url: 'http://localhost:3000',
        token_secret: 'galeri',
        printer_profile_id: null,
        peripheral_id: null,
        hlc_teks: '0',
        receipt_sequence: 1,
      },
    ],
    sesi_lokal: [
      {
        id: 1,
        user_id: 'user-galeri',
        nama: 'Kasir Galeri',
        // ⛔ JSON, bukan `'cashier'`. `bacaSesi` mem-`JSON.parse` kolom ini,
        // dan lemparannya ditelan `.catch()` di `useSesi` — sesi selamanya
        // `null`, dan K-12 berhenti di "Tidak ada shift yang dapat ditutup"
        // untuk shift yang ada. Tanpa satu pun error di layar.
        peran: '["cashier"]',
        masuk_pada: new Date().toISOString(),
        wajib_ganti_pin: 0,
      },
    ],
    // Antrean: hitungannya yang dibaca indikator sinkronisasi.
    outbox_local: [
      ...Array.from({ length: antre.menunggu }, (_, i) => ({
        id: `q${i}`,
        entity_type: 'order',
        entity_id: `o${i}`,
        status: 'pending',
        percobaan: 0,
        created_at: new Date().toISOString(),
      })),
      ...Array.from({ length: antre.gagal }, (_, i) => ({
        id: `f${i}`,
        entity_type: 'order',
        entity_id: `of${i}`,
        status: 'failed',
        percobaan: 20,
        created_at: new Date().toISOString(),
      })),
    ],
    keranjang_lokal: [],
    print_job: [],
    fitur_lokal: [],
    telemetry_local: [],
  };

  const db: DbLokal = {
    async getAll<T>(sql: string): Promise<T[]> {
      // ⛔ "Memuat" adalah promise yang TIDAK PERNAH selesai, bukan jeda 2 detik.
      // Jeda hanya menunda pertanyaannya; yang ingin dilihat adalah apa yang
      // kasir tatap SELAMA menunggu, dan itu harus dapat diperiksa tanpa
      // berpacu dengan timer.
      if (skenario === 'memuat') return TAK_PERNAH_SELESAI;
      if (skenario === 'error') {
        throw new Error('database lokal tidak dapat dibaca (galeri: skenario error)');
      }
      const tabel = tabelDari(sql);
      const baris = perTabel[tabel] ?? [];

      /* ⛔ Query AGREGAT tidak dapat dijawab dengan mengembalikan barisnya.
         `ringkasanAntrean` memakai `sum(CASE …)`, dan fake yang mengembalikan
         baris mentah menyerahkan `menunggu: undefined` — yang `?? 0` ubah
         menjadi NOL. Akibatnya indikator sinkronisasi menampilkan
         "Tersinkron" pada skenario yang seluruh isinya antrean tertahan:
         galeri yang berbohong tepat pada nilai jual produknya.

         Ditemukan dengan membacanya, bukan dengan melihat layarnya — dan
         itu justru alasan pengecualian ini ditulis eksplisit alih-alih
         dibiarkan sebagai perilaku diam. */
      if (/\b(count|sum|min|max)\s*\(/i.test(sql)) {
        return [agregat(tabel, sql, baris)] as T[];
      }
      return baris as T[];
    },
    async execute() {
      if (skenario === 'error') throw new Error('galeri: skenario error');
    },
    async transaction<T>(fn: (tx: DbLokal) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };
  return db;
}
