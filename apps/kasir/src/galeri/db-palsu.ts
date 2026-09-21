import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import {
  antreanUntuk,
  gambarUntuk,
  itemUntuk,
  keranjangDuaPuluh,
  orderUntuk,
  type NamaSkenario,
} from './skenario.ts';

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
 * Apakah perangkat galeri sudah terdaftar pada skenario ini.
 *
 * ⛔ `kosong` berarti perangkat BARU, bukan sekadar katalog kosong. Merchant
 * yang baru memasang aplikasi belum punya `device_config`, dan justru keadaan
 * itulah yang `status.ts:81` catat sebagai paling berbahaya: antrean kosong
 * karena tidak pernah ada yang MASUK, bukan karena semuanya terkirim.
 *
 * ⛔ Ia diekspor supaya `Galeri.tsx` dan `buatDbPalsu` membacanya dari SATU
 * tempat. Dua tempat yang memutuskan "perangkat ini terdaftar atau belum"
 * menghasilkan topbar dan layar yang saling membantah di galeri — persis cacat
 * yang galeri ini dipakai untuk menemukannya.
 */
export function perangkatTerdaftarUntuk(skenario: NamaSkenario): boolean {
  return skenario !== 'kosong';
}

/**
 * ⛔ Alamat yang dijamin DITOLAK, bukan `localhost:3000`.
 *
 * K-14 memeriksa keterjangkauan server lewat `pantauJangkauan`, dan port 3000
 * adalah server pengembangan yang HIDUP di mesin pengembang dan MATI di runner
 * CI. Galeri yang menjawab "terjangkau" di satu tempat dan "tidak" di tempat
 * lain membuat penjaganya memberi dua jawaban untuk kode yang sama.
 *
 * Port 65535 di loopback: di luar rentang ephemeral Linux (32768–60999), jadi
 * tidak ada yang mengikatnya, dan koneksinya DITOLAK seketika alih-alih
 * menggantung sampai batas waktu probe. Galeri karena itu selalu berdiri pada
 * keadaan yang sama: perangkat terdaftar, server tidak terjangkau.
 *
 * ⛔ Bukan port 9 (`discard`). Ia ada di daftar port terlarang Chromium, jadi
 * peramban menolaknya sebelum menembak dan mencatat `ERR_UNSAFE_PORT` — galat
 * konsol yang menyebut keputusan PERAMBAN, bukan keadaan jaringan, di galeri
 * yang penjaganya menolak setiap galat konsol.
 */
const BASE_URL_TAK_TERJANGKAU = 'http://127.0.0.1:65535';

/**
 * Alasan kegagalan per baris outbox, berulang siklik.
 *
 * ⛔ Tanpa `last_error`, kolom "Alasan" di K-14 jatuh ke kalimat fallback
 * `pesanGagal` untuk SETIAP baris — tiga dari lima kolom tabel menjadi hampa,
 * dan galeri menampilkan tabel yang tidak dapat dipakai menilai apa pun.
 */
const ALASAN_GAGAL = [
  'HTTP 409 IDEMPOTENCY_MISMATCH',
  'HTTP 401 DEVICE_REVOKED',
  'TypeError: Failed to fetch',
];

/** `menitLalu` menit sebelum sekarang, sebagai ISO. */
function umurAntrean(menitLalu: number): string {
  return new Date(Date.now() - menitLalu * 60_000).toISOString();
}

/* Empat kategori, urutan tetap — warna slot diturunkan dari POSISI di daftar
   ini, jadi urutan yang berubah antar skenario akan mengubah warna "Kopi"
   di antara dua tangkapan layar yang seharusnya sebanding. */
const KATEGORI_PALSU = [
  { id: 'kat-kopi', name: 'Kopi', sort_order: 1, archived_at: null },
  { id: 'kat-nonkopi', name: 'Non-kopi', sort_order: 2, archived_at: null },
  { id: 'kat-makanan', name: 'Makanan', sort_order: 3, archived_at: null },
  { id: 'kat-pastry', name: 'Pastry', sort_order: 4, archived_at: null },
];

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
    category: KATEGORI_PALSU,
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
    /* ⛔ PPN 11% — jenis pajak yang paling banyak dipakai merchant Indonesia,
       dan sampai sekarang NOL di seluruh fixture repo ini
       (`docs/verifikasi/MONOKULTUR-FIXTURE.md`). Blok ringkasan K-03 merender
       satu baris per tarif; tanpa satu pun tarif di sini, barisnya tidak
       pernah dirender dan galeri tidak dapat menjawab apakah ia benar.

       `rate` berskala ×10000 seperti kolom lokalnya (11% → 1100), eksklusif,
       berlaku untuk seluruh item dan seluruh kanal. */
    tax_rate: [
      {
        id: 'tax-ppn',
        tenant_id: 'ten-galeri',
        outlet_id: null,
        name: 'PPN 11%',
        type: 'ppn',
        rate: 1100,
        is_inclusive: 0,
        jurisdiction: 'ID',
        channel: 'all',
        applies_to: 'all_items',
        applies_to_ids: null,
        effective_from: '2026-01-01T00:00:00.000Z',
        effective_to: null,
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
    device_config: perangkatTerdaftarUntuk(skenario) ? [
      {
        id: 1,
        device_id: 'dev-galeri',
        device_code: 'K1',
        tenant_id: 'ten-galeri',
        outlet_id: 'outlet-1',
        base_url: BASE_URL_TAK_TERJANGKAU,
        token_secret: 'galeri',
        printer_profile_id: null,
        peripheral_id: null,
        hlc_teks: '0',
        receipt_sequence: 1,
      },
    ] : [],
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
    /* Antrean: hitungannya yang dibaca indikator sinkronisasi, DAN barisnya
       yang K-14 tampilkan satu per satu.

       ⛔ `created_at` SENGAJA berbeda per baris. Sebelum 21 September 2026
       semuanya `new Date().toISOString()`, dan akibatnya kolom "Dibuat"
       berbunyi "baru saja" untuk lima belas baris sekaligus sementara baris
       "Tertua" di kartu berbunyi sama — dua angka yang seluruh gunanya adalah
       BERBEDA. Antrean yang tertahan berjam-jam adalah keadaan yang K-14 ada
       untuk menampilkannya, dan galeri tidak pernah menunjukkannya sekali pun.

       ⛔ Umurnya BERPUTAR (`i % n`), tidak tumbuh mengikuti jumlah baris, dan
       alasannya bukan kerapian. `offline` (3 gagal) dan `antrean-panjang` (50)
       dipakai BERPASANGAN oleh penjaga tata letak, dan pasangan pembanding
       harus berbeda SATU variabel saja. Saat umurnya tumbuh, baris tertua di
       `antrean-panjang` berusia 28 jam sementara di `offline` 4 jam — pita
       FR-H8 di atas layar memakai ambang umur (`spec-h:302`), kalimatnya jadi
       lebih panjang, ia membungkus menjadi dua baris, dan SELURUH K-14
       terdorong 18 px ke bawah. Penjaga membacanya sebagai blok aksi yang
       bergeser; yang bergeser sebenarnya banner milik shell. Dengan umur yang
       berputar, kedua fixture berbagi rentang umur yang sama persis dan hanya
       JUMLAH barisnya yang berbeda. */
    outbox_local: [
      ...Array.from({ length: antre.menunggu }, (_, i) => ({
        id: `q${i}`,
        entity_type: 'order',
        entity_id: `o${i}`,
        status: 'pending',
        percobaan: 0,
        last_error: null,
        created_at: umurAntrean((i % 12) * 7 + 3),
      })),
      ...Array.from({ length: antre.gagal }, (_, i) => ({
        id: `f${i}`,
        entity_type: 'order',
        entity_id: `of${i}`,
        status: 'failed',
        percobaan: 20,
        last_error: ALASAN_GAGAL[i % ALASAN_GAGAL.length],
        // Yang gagal selalu LEBIH TUA daripada yang mengantre: ia sudah
        // melewati seluruh tangga backoff sebelum menyerah.
        created_at: umurAntrean(180 + (i % 3) * 31),
      })),
    ],
    // ⛔ Keranjang berisi HANYA untuk skenario yang menanyakannya. Setiap
    // skenario lain menilai grid dan keadaan kosong; keranjang penuh yang
    // selalu ada akan menutupi keadaan kosong yang aturan DS #7 tuntut.
    keranjang_lokal:
      skenario === 'keranjang-penuh'
        ? [{ id: 'kini', shift_id: 'shift-galeri', isi: keranjangDuaPuluh(), diperbarui_pada: '2026-09-01T02:00:00.000Z' }]
        : [],
    print_job: [],
    fitur_lokal: [],
    telemetry_local: [],
    // Diisi di `getAll` — WebP-nya di-encode kanvas, dan itu async.
    item_image: [],
  };

  /* ⛔ Gambar dibuat SEKALI, dan promise-nya yang dibagikan — bukan hasilnya.
     `bacaGambarKatalog` dapat dipanggil ulang saat layar remount, dan
     meng-encode ulang 14 WebP setiap kali membuat galeri terasa lambat pada
     skenario yang justru ada untuk dinilai matanya. */
  let gambar: Promise<unknown[]> | null = null;

  const db: DbLokal = {
    async getAll<T>(sql: string): Promise<T[]> {
      // ⛔ "Memuat" adalah promise yang TIDAK PERNAH selesai, bukan jeda 2 detik.
      // Jeda hanya menunda pertanyaannya; yang ingin dilihat adalah apa yang
      // kasir tatap SELAMA menunggu, dan itu harus dapat diperiksa tanpa
      // berpacu dengan timer.
      if (skenario === 'memuat') return TAK_PERNAH_SELESAI;
      const tabel = tabelDari(sql);

      /* ⛔ `error` menolak setiap pembacaan KECUALI identitas perangkat.

         Pengecualiannya bukan kenyamanan, ia yang membuat skenario ini
         menggambarkan keadaan yang benar-benar terjadi. `device_config`
         dibaca sekali saat boot; query yang menolak di tengah sesi tidak
         MEMBATALKAN pendaftaran perangkat. Selama ia ikut menolak, galeri
         menampilkan perangkat yang tiba-tiba "belum terdaftar" — dan shell,
         yang identitasnya datang dari skenario, berkata sebaliknya di baris
         yang sama. Dua kalimat yang saling membantah, dibuat oleh fixture-nya
         sendiri.

         Ia juga satu-satunya jalan menuju keadaan yang paling mahal di layar
         ini: perangkat TERDAFTAR yang daftar antreannya tidak dapat dibaca.
         Di sanalah `ringkasan` jatuh ke 0/0 dan badge dapat berbunyi
         "Tersinkron" untuk antrean yang tidak diketahui siapa pun. */
      if (skenario === 'error' && tabel !== 'device_config') {
        throw new Error('database lokal tidak dapat dibaca (galeri: skenario error)');
      }
      if (tabel === 'item_image') {
        gambar ??= gambarUntuk(skenario, item);
        return (await gambar) as T[];
      }
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

      /* ⛔ SATU saringan, dan ia ada karena ketiadaannya membuat galeri
         MEMBANTAH DIRINYA SENDIRI.

         `daftarGagal` menjalankan dua query: `count(*) … WHERE status =
         'failed'` (yang `agregat` sudah jawab benar) dan pengambilan barisnya
         dengan `WHERE` yang sama. Fake yang mengabaikan `WHERE` menyerahkan
         SELURUH lima belas baris untuk yang kedua, jadi K-14 menampilkan kartu
         "Gagal terkirim 3" tepat di atas tabel berisi 15 baris — di layar yang
         seluruh tugasnya memisahkan kedua angka itu.

         Cakupannya sengaja satu bentuk saja, sejajar dengan `agregat`: fake
         yang mulai menafsirkan `WHERE` apa pun menjadi mesin SQL kedua. */
      if (tabel === 'outbox_local' && /status\s*=\s*'failed'/i.test(sql)) {
        return (baris as { status: string }[]).filter((r) => r.status === 'failed') as T[];
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
