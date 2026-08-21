/**
 * Paket dan kuotanya. Murni: data, tanpa I/O.
 *
 * ## ⛔ Seluruh angka di berkas ini `[ASUMSI]`
 *
 * Delapan spec modul memuat 414 acceptance criteria dan **tidak satu pun**
 * menyangkut paket, kuota, atau lisensi. 77 FR di PRD berhenti di FR-H8.
 * Yang ada hanya:
 *
 * - `research/09` § 6 — dimensi kuota, titik penegakan, perilaku saat
 *   terlampaui. Tanpa angka.
 * - `research/11` § 3 — `[FAKTA]` lever tier di pasar Indonesia adalah kuota;
 *   Kasir Pintar 1.000 vs 10.000 produk, maks 5 staf.
 * - `spec-a:370` — "tier Gratis 200, Standar 5.000" ditulis sebagai
 *   **pertanyaan terbuka**, bukan keputusan.
 *
 * Angkanya dikumpulkan DI SINI, di satu tempat, justru supaya menggantinya
 * kelak adalah satu edit — bukan perburuan lintas berkas setelah harga
 * ditetapkan.
 *
 * ## Yang BUKAN asumsi
 *
 * Dua hal di bawah diturunkan dari aturan, bukan ditebak:
 *
 * 1. **`null` berarti tanpa batas.** Bukan angka besar. Angka besar adalah
 *    batas yang berpura-pura tidak ada, dan ia akan mengejutkan seseorang
 *    sekali, di tempat yang tidak ada yang mengawasi.
 * 2. **Volume transaksi tidak ada di sini, dan tidak akan pernah ada.**
 *    `research/09` § 6: membatasi transaksi = menghentikan penjualan. Volume
 *    dipakai untuk metering dan penagihan, tidak pernah untuk penolakan.
 */

import { DIMENSI_KUOTA, type DimensiKuota } from './kuota.ts';

export type NamaPaket = 'free' | 'standard' | 'pro' | 'enterprise';

export interface KuotaPaket {
  /** `null` = tanpa batas. */
  maxOutlets: number | null;
  maxDevices: number | null;
  maxUsers: number | null;
  maxProducts: number | null;
}

/**
 * Keempat nama harus sepadan dengan CHECK constraint di `0002_tenancy.sql`:
 * `CHECK (plan IN ('free','standard','pro','enterprise'))`. Paket yang
 * diterima database tapi tidak punya baris di sini akan lolos sampai
 * penegakan pertama, lalu gagal di sana — jauh dari tempat kesalahannya.
 */
export const KUOTA_PAKET: Readonly<Record<NamaPaket, KuotaPaket>> = {
  // Satu outlet, tapi DUA perangkat: kafe takeaway dengan dua terminal adalah
  // kasus normal. Tier gratis yang hanya memuat satu perangkat memaksa
  // upgrade di hari pertama, dan itu bukan tier gratis melainkan trial yang
  // tidak diberi nama.
  free: { maxOutlets: 1, maxDevices: 2, maxUsers: 3, maxProducts: 200 },
  // ⛔ `maxOutlets: null` di kedua tier berbayar, dan itu KEP-38, bukan
  // kelonggaran. Unit harga adalah **per outlet per bulan** — membatasi
  // outlet sekaligus menagih per-outlet berarti menolak hal yang sama yang
  // ditagih. Tier gratis tetap berbatas; kalau tidak, pendaftaran mandiri
  // memberi outlet tanpa batas seharga Rp0.
  standard: { maxOutlets: null, maxDevices: 10, maxUsers: 15, maxProducts: 5_000 },
  pro: { maxOutlets: null, maxDevices: 50, maxUsers: 60, maxProducts: 20_000 },
  enterprise: { maxOutlets: null, maxDevices: null, maxUsers: null, maxProducts: null },
};

/**
 * Paket yang diberikan pendaftaran mandiri.
 *
 * ⛔ Ini konstanta, bukan parameter. `POST /tenants` tidak terautentikasi —
 * paket yang dapat dipilih pemanggil berarti siapa pun dapat memberi dirinya
 * kuota tanpa batas lewat satu field JSON. Perpindahan paket adalah operasi
 * billing, dan billing tidak dibangun di sini.
 */
export const PAKET_PENDAFTARAN: NamaPaket = 'free';

// ---------------------------------------------------------------------------
// Perpindahan paket
// ---------------------------------------------------------------------------

/**
 * Pemakaian tenant pada keempat dimensi kuota.
 *
 * ⛔ Keempatnya WAJIB, tidak ada `?? 0`. Pemanggil yang lupa satu dimensi akan
 * lolos diam-diam kalau nilai hilang dianggap nol — dan dimensi yang lupa
 * dihitung adalah persis dimensi yang tidak dijaga. Angkanya dihitung modul
 * pemilik tabelnya masing-masing (invariant #4), sama seperti `periksaKuota`.
 */
export type PemakaianTenant = Readonly<Record<DimensiKuota, number>>;

export interface PelanggaranKuota {
  dimensi: DimensiKuota;
  terpakai: number;
  batas: number;
}

export type HasilPerpindahan =
  | { ok: true }
  | {
      ok: false;
      kode: 'PLAN_DOWNGRADE_BLOCKED';
      pelanggaran: PelanggaranKuota[];
      pesan: string;
    };

/**
 * Bolehkah tenant dengan pemakaian ini berpindah ke paket tujuan.
 *
 * ## ⛔ Lubang yang `periksaKuota` tidak jaga
 *
 * `periksaKuota` berjalan saat MEMBUAT sesuatu. Tidak ada apa pun yang
 * memeriksa kuota saat batasnya SENDIRI yang berubah — dan perpindahan paket
 * adalah satu-satunya operasi yang mengubah batas.
 *
 * Tanpa fungsi ini, tenant dengan 8 outlet dapat turun ke `free` (1 outlet)
 * dan sistem masuk keadaan yang **tidak dapat dicapai lewat jalur mana pun**:
 * 8 outlet hidup di bawah kuota 1, tanpa satu pun error, dan setiap layar
 * "pemakaian vs kuota" menampilkan 8/1. Tidak ada operasi yang memperbaikinya
 * sendiri, karena `periksaKuota` meloloskan operasi yang tidak menambah apa
 * pun — dengan sengaja, supaya penurunan paket tidak mengunci katalog.
 *
 * Kedua sifat itu benar sendiri-sendiri dan berbahaya bersama. Yang menutupnya
 * adalah menolak transisinya, bukan melonggarkan salah satunya.
 *
 * ## Kenapa SELURUH pelanggaran dikembalikan
 *
 * Merchant yang memperbaiki satu dimensi lalu ditolak lagi karena dimensi
 * kedua — dan lagi karena ketiga — akan menyerah. Penolakan yang menyebut satu
 * sebab pada satu waktu adalah penolakan yang menyembunyikan pekerjaan.
 *
 * Murni: tanpa I/O, tanpa waktu, tanpa database.
 */
export function periksaPerpindahanPaket(
  pemakaian: PemakaianTenant,
  paketTujuan: string
): HasilPerpindahan {
  // Fail-closed, sama seperti `periksaKuota` untuk dimensi tak dikenal.
  // Meloloskan paket asing berarti mematikan satu-satunya penjaga yang berdiri
  // di sini, tanpa satu pun error.
  if (!Object.prototype.hasOwnProperty.call(KUOTA_PAKET, paketTujuan)) {
    throw new Error(`Paket tidak dikenal: ${paketTujuan}`);
  }
  const kuota = KUOTA_PAKET[paketTujuan as NamaPaket];

  const pelanggaran: PelanggaranKuota[] = [];
  for (const dimensi of DIMENSI_KUOTA) {
    const terpakai = pemakaian[dimensi];
    if (typeof terpakai !== 'number' || !Number.isFinite(terpakai)) {
      throw new Error(`Pemakaian dimensi ${dimensi} tidak diberikan.`);
    }

    const batas = BATAS_PER_DIMENSI[dimensi](kuota);
    // `null` = tanpa batas. Diperiksa sebelum aritmetika apa pun, alasan yang
    // sama dengan `periksaKuota`.
    if (batas === null) continue;

    // `>` bukan `>=`: batas adalah maksimum yang MUAT. `periksaKuota` memakai
    // `terpakai + tambahan <= batas`, dan dua tempat yang memperlakukan batas
    // secara berbeda akan menolak tenant yang sebenarnya muat.
    if (terpakai > batas) pelanggaran.push({ dimensi, terpakai, batas });
  }

  if (pelanggaran.length === 0) return { ok: true };

  // Pesan membawa ANGKANYA, pola `spec-e:152`.
  const rincian = pelanggaran
    .map((p) => `${LABEL_DIMENSI[p.dimensi]} ${p.terpakai} dari ${p.batas}`)
    .join(', ');
  return {
    ok: false,
    kode: 'PLAN_DOWNGRADE_BLOCKED',
    pelanggaran,
    pesan:
      `Paket ${paketTujuan} tidak memuat pemakaian saat ini: ${rincian}. ` +
      'Kurangi dulu sampai muat, lalu ulangi perpindahan.',
  };
}

/**
 * ⛔ Diturunkan dari `DIMENSI_KUOTA`, bukan daftar kedua.
 *
 * Dimensi kelima yang ditambahkan kelak akan gagal TYPECHECK di sini alih-alih
 * diam-diam tidak diperiksa — dan dimensi yang lupa diperiksa adalah persis
 * dimensi yang tidak dijaga.
 */
const BATAS_PER_DIMENSI: Readonly<
  Record<DimensiKuota, (k: KuotaPaket) => number | null>
> = {
  outlet: (k) => k.maxOutlets,
  device: (k) => k.maxDevices,
  pengguna: (k) => k.maxUsers,
  produk: (k) => k.maxProducts,
};

const LABEL_DIMENSI: Readonly<Record<DimensiKuota, string>> = {
  outlet: 'outlet',
  device: 'perangkat',
  pengguna: 'pengguna',
  produk: 'produk',
};

// ---------------------------------------------------------------------------
// Harga — KEP-38 / KEP-39
// ---------------------------------------------------------------------------

/**
 * Harga per **outlet per bulan**, rupiah utuh.
 *
 * ## ⛔ Per outlet, dan itu menentukan bentuk kuota
 *
 * KEP-38: *"Unit harga adalah per outlet per bulan, bukan per terminal atau
 * per user. Per-terminal menghukum merchant yang menambah kasir di jam sibuk —
 * persis perilaku yang seharusnya didorong."*
 *
 * Konsekuensi yang mudah terlewat: outlet karena itu **bukan dimensi kuota**
 * di tier berbayar. `KUOTA_PAKET.standard.maxOutlets` dan `.pro` bernilai
 * `null` justru karena harganya per outlet — membatasinya sekaligus menagih
 * per-outlet berarti menolak hal yang sama yang ditagih.
 *
 * ## ⛔ `bigint`, bukan `number`
 *
 * Aturan uang `CLAUDE.md` berlaku penuh di sini. Tagihan langganan adalah uang
 * sungguhan yang merchant bayar; ia tidak dikecualikan karena bukan penjualan.
 * Pada skala ini float akan "kebetulan benar", dan itu justru alasannya —
 * aturan yang punya satu pengecualian akan disalin ke kolom berikutnya.
 *
 * ## ⛔ Angkanya `[ASUMSI]`, dan sumbernya menyatakannya sendiri
 *
 * `research/11` KEP-39: *"angka harga adalah rekomendasi berdasarkan posisi
 * kompetitif, bukan hasil riset kemauan bayar"*. Rp349.000 ditempatkan
 * Rp50.000 di atas anchor Moka Basic; Rp699.000 di bawah batas atas Moka.
 * Belum divalidasi ke satu merchant pun.
 *
 * ⛔ **Kuota `device`, `pengguna`, dan `produk` di `KUOTA_PAKET` MASIH
 * berbeda dari tabel KEP-39** (KEP-39: gratis 1 device/2 pengguna; standar 3
 * device/10 pengguna; pro 6 device/pengguna tanpa batas). Yang disamakan
 * sekarang hanya outlet, karena hanya itu yang diputuskan — dan karena
 * `free.maxDevices >= 2` dipertahankan test dengan alasan produk yang berdiri
 * sendiri: kafe takeaway dengan dua terminal adalah kasus normal, dan tier
 * gratis satu-perangkat adalah trial yang tidak diberi nama. Selisih ini
 * dinyatakan, bukan kelalaian.
 */
export const HARGA_PAKET: Readonly<Record<NamaPaket, bigint | null>> = {
  free: 0n,
  standard: 349_000n,
  pro: 699_000n,
  // ⛔ `null`, bukan angka. Harga angka untuk enterprise berarti seseorang
  // dapat membelinya sendiri di B-29 dengan harga yang tidak pernah
  // disepakati siapa pun. Enterprise adalah negosiasi.
  enterprise: null,
};

/**
 * Tagihan satu bulan untuk paket ini dengan sejumlah outlet.
 *
 * Murni: tanpa I/O, tanpa waktu. Yang MENGHITUNG jumlah outlet adalah modul
 * tenancy (invariant #4) — fungsi ini menerimanya sebagai angka, pola yang
 * sama dengan `periksaKuota`.
 */
export function hitungTagihanBulanan(paket: string, jumlahOutlet: number): bigint {
  if (!Object.prototype.hasOwnProperty.call(HARGA_PAKET, paket)) {
    throw new Error(`Paket tidak dikenal: ${paket}`);
  }
  const harga = HARGA_PAKET[paket as NamaPaket];
  if (harga === null) {
    throw new Error(
      `Paket ${paket} adalah negosiasi (custom), bukan self-serve — tagihannya tidak dapat dihitung.`
    );
  }

  // Tenant tanpa outlet tidak dapat berjualan sama sekali, jadi angka ini
  // selalu berarti pemanggil salah menghitung. Menagih Rp0 diam-diam untuk
  // paket berbayar adalah tagihan yang tidak akan pernah ditanyakan siapa pun.
  if (!Number.isInteger(jumlahOutlet) || jumlahOutlet < 1) {
    throw new Error(`Jumlah outlet harus bilangan bulat >= 1, diterima ${jumlahOutlet}.`);
  }

  return harga * BigInt(jumlahOutlet);
}

// ---------------------------------------------------------------------------
// Kenaikan paket — scope epik F5 pertama
// ---------------------------------------------------------------------------

/**
 * Urutan tingkat paket, dari terendah.
 *
 * ⛔ Daftar KEDUA di berkas ini, dan itu tidak dapat dihindari: urutan tidak
 * dapat diturunkan dari `KUOTA_PAKET` karena `null` berarti tanpa batas, dan
 * `standard.maxOutlets` sudah `null` sejak KEP-38 — membandingkan kuota akan
 * menyatakan `standard` setara `enterprise` pada dimensi itu.
 *
 * Yang menjaganya tetap sepakat adalah test, bukan ingatan: ada test yang
 * menuntut daftar ini memuat PERSIS kunci `KUOTA_PAKET`. Paket kelima yang
 * ditambahkan tanpa tingkat akan merah di sana, bukan diam-diam dianggap
 * tingkat `-1` dan lolos setiap perbandingan.
 */
export const URUTAN_PAKET: readonly NamaPaket[] = ['free', 'standard', 'pro', 'enterprise'];

export function tingkatPaket(paket: string): number {
  const i = URUTAN_PAKET.indexOf(paket as NamaPaket);
  if (i === -1) throw new Error(`Paket tidak dikenal: ${paket}`);
  return i;
}

export type HasilKenaikan =
  | { ok: true }
  | { ok: false; kode: 'PLAN_NOT_SELF_SERVE' | 'PLAN_NOT_BILLABLE' | 'PLAN_NOT_AN_UPGRADE'; pesan: string };

/**
 * Bolehkah tenant di `paketSaatIni` MEMBELI `paketTujuan` sendiri.
 *
 * ## ⛔ Kenapa hanya kenaikan, dan kenapa itu bukan kemalasan
 *
 * Keputusan user 21 Agustus 2026 membatasi epik F5 pertama pada **jalan
 * menaikkan paket**. Batasan itu punya konsekuensi yang membuat seluruh jalur
 * pembayaran aman, dan ia layak dinyatakan di sini karena ia yang menjawab
 * pertanyaan "apa yang terjadi kalau merchant sudah membayar tapi kuota
 * tujuan tidak memuat pemakaiannya":
 *
 * **Pertanyaan itu tidak dapat muncul.** Kuota naik monoton sepanjang
 * `URUTAN_PAKET` (dijaga test tersendiri), jadi pemakaian yang muat di paket
 * sekarang selalu muat di paket yang lebih tinggi. Tidak ada keadaan di mana
 * merchant membayar lalu kenaikannya ditolak — dan itulah alasan
 * `periksaPerpindahanPaket` TIDAK dipanggil di jalur ini. Ia dibangun untuk
 * penurunan paket, satu-satunya arah yang dapat melanggar kuota, dan
 * penurunan belum punya endpoint. Memanggilnya di sini akan menjadi cabang
 * yang tidak pernah menyala — kelas cacat yang sama dengan `arah = -1` di
 * tutup kas (`CLAUDE.md` § F3).
 *
 * ## Dua penolakan yang bukan soal tingkat
 *
 * Keduanya diturunkan dari `HARGA_PAKET`, bukan dari daftar nama yang ditulis
 * ulang di sini:
 *
 * - `null` (enterprise) — negosiasi. Harga angka untuknya berarti seseorang
 *   dapat membelinya sendiri dengan harga yang tidak pernah disepakati.
 * - `0n` (free) — tidak ada yang dapat ditagih. Turun ke gratis adalah
 *   pembatalan langganan, operasi yang berbeda dan belum dibangun.
 *
 * Murni: tanpa I/O, tanpa waktu.
 */
export function periksaKenaikanPaket(paketSaatIni: string, paketTujuan: string): HasilKenaikan {
  const sekarang = tingkatPaket(paketSaatIni);
  const tujuan = tingkatPaket(paketTujuan);

  const harga = HARGA_PAKET[paketTujuan as NamaPaket];
  if (harga === null) {
    return {
      ok: false,
      kode: 'PLAN_NOT_SELF_SERVE',
      pesan:
        `Paket ${paketTujuan} tidak dapat dibeli sendiri — harganya dinegosiasikan. ` +
        'Hubungi tim Lumi untuk mengaturnya.',
    };
  }
  if (harga === 0n) {
    return {
      ok: false,
      kode: 'PLAN_NOT_BILLABLE',
      pesan: `Paket ${paketTujuan} tidak berbayar, jadi tidak ada tagihan yang dapat dibuat untuknya.`,
    };
  }

  if (tujuan <= sekarang) {
    return {
      ok: false,
      kode: 'PLAN_NOT_AN_UPGRADE',
      pesan:
        `Paket saat ini ${paketSaatIni}; ${paketTujuan} bukan kenaikan. ` +
        'Menurunkan paket belum dapat dilakukan sendiri — hubungi tim Lumi.',
    };
  }

  return { ok: true };
}
