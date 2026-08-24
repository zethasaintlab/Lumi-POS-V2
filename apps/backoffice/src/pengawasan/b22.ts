import {
  KUNCI_PERISTIWA,
  kelompokPeristiwa,
  type KelompokPeristiwa,
} from '../../../../packages/domain/src/audit-peristiwa.ts';

/**
 * B-22 — aturan tampilan Audit & Aktivitas (`IA:201`). FR-F6, FR-F7.
 *
 * ## ⛔ Layar ini adalah audit trail, dan audit trail dibaca saat ada sengketa
 *
 * `spec-f:372` menetapkan retensinya **lima tahun**, lebih panjang daripada
 * retensi transaksi, dengan alasan yang dinyatakan: *"sengketa muncul
 * berbulan-bulan kemudian."* Yang membaca layar ini biasanya sedang mencari
 * jawaban atas tuduhan — dari investor kepada rekan pemiliknya, dari owner
 * kepada manajernya, atau dari merchant kepada kami.
 *
 * Konsekuensinya untuk kata-kata: sama dengan B-21, dan lebih ketat. Layar
 * yang menambahkan penilaiannya sendiri di atas jejak menjadi bagian dari
 * sengketa alih-alih menyelesaikannya.
 *
 * ## ⛔ Yang TIDAK terlihat harus disebutkan
 *
 * Dua hal, dan keduanya diam kalau tidak dinyatakan:
 *
 * 1. **Saringan yang sedang aktif.** Daftar yang tidak menyebut apa yang
 *    disaring terbaca seperti daftar lengkap.
 * 2. **Peristiwa yang belum dipancarkan sama sekali.** FR-F6 AC pertama
 *    menuntut setiap event pada daftar `spec-f:288` menghasilkan record;
 *    sebagian belum. Manajer yang tidak menemukan perubahan harga di sini
 *    akan menyimpulkan tidak ada yang mengubah harga — kesimpulan yang salah
 *    dengan akibat pada manusia.
 *
 * ## ⛔ Angka tidak dihitung ulang di sini
 *
 * Sama seperti `b21.ts`. Kursor paginasi khususnya adalah nilai BURAM: klien
 * hanya mengembalikan apa yang server berikan. Menyusunnya sendiri di klien
 * membuat dua tempat memutuskan urutan, dan yang menyimpang melewatkan baris
 * tanpa meninggalkan lubang yang terlihat.
 */

export const JUDUL_LAYAR = 'Audit & Aktivitas';

/**
 * ⛔ Label untuk SETIAP peristiwa di daftar tertutup domain.
 *
 * Pola yang sama dengan `LABEL_ALASAN` di `b21.ts`: daftarnya hidup di
 * `packages/domain/src/audit-peristiwa.ts`, ini salinan kedua, dan salinan
 * kedua bergeser. Ada test yang membaca daftar domain dan menuntut setiap
 * kuncinya punya label di sini — jadi peristiwa yang ditambahkan kelak gagal
 * di test alih-alih tampil sebagai slug mentah di layar yang dibaca saat
 * sengketa.
 *
 * Kalimatnya menyatakan APA YANG TERJADI, bukan kesimpulannya.
 */
export const LABEL_PERISTIWA: Record<string, string> = {
  // Sesi
  login: 'Masuk ke back-office',
  logout: 'Keluar dari back-office',
  pin_failed: 'PIN salah',
  pin_lockout: 'Akun terkunci sementara',
  // Shift
  shift_opened: 'Shift dibuka',
  shift_closed: 'Shift ditutup',
  // Transaksi
  'order.voided': 'Transaksi dibatalkan',
  'order.refunded': 'Transaksi direfund',
  'order.abandoned': 'Pesanan terbuka ditutup sistem',
  discount_applied: 'Diskon diberikan',
  calculation_variance: 'Selisih hitungan perangkat',
  // Kas
  cash_drawer_opened: 'Laci dibuka tanpa transaksi',
  cash_variance_approved: 'Selisih kas disetujui',
  // ⛔ Arahnya ada di LABEL-nya, bukan hanya di tanda `delta`. Kolom Peristiwa
  // adalah yang dibaca saat sengketa, dan "Kas dicatat" untuk kedua arah
  // membuat pembacanya harus membuka detail baris demi tahu uangnya masuk atau
  // keluar.
  cash_paid_in: 'Kas masuk dicatat',
  cash_paid_out: 'Kas keluar dicatat',
  // Katalog
  catalog_imported: 'Katalog diimpor',
  item_created: 'Produk dibuat',
  item_updated: 'Produk diubah',
  item_archived: 'Produk diarsipkan atau dipulihkan',
  price_changed: 'Harga diubah',
  // Stok
  stock_adjusted: 'Stok disesuaikan',
  stocktake_completed: 'Opname diselesaikan',
  sold_out_toggled: 'Penandaan habis diubah',
  // Konfigurasi
  tax_rate_changed: 'Tarif pajak diubah',
  threshold_changed: 'Ambang otorisasi diubah',
  vertical_profile_changed: 'Profil vertikal diubah',
  // Identitas
  user_created: 'Pengguna dibuat',
  user_role_changed: 'Peran pengguna diubah',
  user_deactivated: 'Pengguna dinonaktifkan',
  pin_changed: 'PIN diubah',
  // Perangkat
  device_provisioned: 'Perangkat didaftarkan',
  device_revoked: 'Perangkat dicabut',
  clock_drift_detected: 'Selisih jam perangkat',
  // Data
  data_exported: 'Data diekspor',
  // Tenant & langganan
  tenant_registered: 'Merchant didaftarkan',
  outlet_created: 'Outlet dibuat',
  subscription_invoice_created: 'Tagihan langganan dibuat',
  subscription_plan_upgraded: 'Paket langganan dinaikkan',
};

/**
 * ⛔ Nama asing tampil APA ADANYA, tidak pernah kosong dan tidak pernah
 * disembunyikan.
 *
 * Baris lama dapat memuat nama yang sudah tidak dipancarkan siapa pun —
 * `audit_event` tidak pernah di-`UPDATE` (invariant #2). Sel kosong di kolom
 * Peristiwa membuat baris terbaca seperti jejak yang rusak, dan menyaringnya
 * keluar berarti layar audit yang menyembunyikan bagian dari audit.
 */
export function labelPeristiwa(nama: string | null | undefined): string {
  if (nama === null || nama === undefined || nama === '') return 'Peristiwa tanpa nama';
  return LABEL_PERISTIWA[nama] ?? nama;
}

export const LABEL_KELOMPOK: Readonly<Record<KelompokPeristiwa, string>> = {
  sesi: 'Sesi',
  shift: 'Shift',
  transaksi: 'Transaksi',
  kas: 'Kas',
  katalog: 'Katalog',
  stok: 'Stok',
  konfigurasi: 'Konfigurasi',
  identitas: 'Identitas',
  perangkat: 'Perangkat',
  data: 'Data',
  tenant: 'Merchant & langganan',
};

export function labelKelompok(kelompok: string | null | undefined): string {
  if (kelompok === null || kelompok === undefined || kelompok === '') return 'Lainnya';
  return LABEL_KELOMPOK[kelompok as KelompokPeristiwa] ?? kelompok;
}

export interface PilihanPeristiwa {
  nilai: string;
  label: string;
  kelompok: string;
}

/**
 * Pilihan saringan jenis peristiwa, dikelompokkan dan terurut.
 *
 * ⛔ Urutannya dimiliki DI SINI, bukan diwarisi dari urutan objek domain.
 * Daftar saringan yang urutannya berubah saat seseorang menambah baris di
 * tempat lain membuat orang yang memakai layar ini setiap minggu kehilangan
 * hafalannya.
 */
export function pilihanPeristiwa(): PilihanPeristiwa[] {
  return KUNCI_PERISTIWA.map((nilai) => ({
    nilai,
    label: labelPeristiwa(nilai),
    kelompok: labelKelompok(kelompokPeristiwa(nilai)),
  })).sort(
    (a, b) => a.kelompok.localeCompare(b.kelompok, 'id') || a.label.localeCompare(b.label, 'id')
  );
}

/**
 * Kalimat yang menyebut saringan yang sedang aktif.
 *
 * ⛔ `null` HANYA bila tidak ada satu pun saringan selain rentang. Layar yang
 * diam saat menyaring terbaca seperti layar yang menampilkan semuanya, dan
 * kesimpulan yang ditarik dari daftar audit menyangkut orang.
 */
export interface SaringanAktif {
  outlet: string | null;
  jenis: string | null;
  aktor: string | null;
  objek: string | null;
}

export function ringkasSaringan(s: SaringanAktif): string | null {
  const bagian: string[] = [];
  if (s.outlet !== null && s.outlet !== '') bagian.push(`outlet ${s.outlet}`);
  if (s.jenis !== null && s.jenis !== '') bagian.push(`jenis "${labelPeristiwa(s.jenis)}"`);
  if (s.aktor !== null && s.aktor !== '') bagian.push(`pelaku ${s.aktor}`);
  if (s.objek !== null && s.objek !== '') bagian.push(`objek ${s.objek}`);
  if (bagian.length === 0) return null;
  return `Daftar ini disaring: ${bagian.join(' · ')}. Peristiwa di luar saringan tidak ditampilkan.`;
}

/**
 * Kalimat tentang peristiwa yang belum dipancarkan sama sekali.
 *
 * ⛔ Daftarnya datang dari SERVER (diturunkan di domain), bukan disalin ke
 * sini. Salinan yang lupa dipangkas menyatakan lubang yang sudah tidak ada,
 * dan pernyataan itu justru membuat trail yang benar terlihat tidak dapat
 * dipercaya.
 */
export function pesanBelumDipancarkan(nama: readonly string[]): string | null {
  if (nama.length === 0) return null;
  const daftar = nama.map((n) => labelPeristiwa(n)).join(' · ');
  return (
    `${nama.length} jenis peristiwa yang spesifikasi sebutkan belum dicatat sistem ini, jadi ` +
    `daftar di atas tidak memuatnya: ${daftar}. Tidak menemukan salah satunya di sini bukan ` +
    'bukti bahwa peristiwanya tidak terjadi.'
  );
}

/**
 * Identitas kedua sebagai kalimat.
 *
 * ⛔ Sel kosong BERMAKNA di kolom ini, dan maknanya bukan "datanya hilang":
 * void berjalan tanpa penyetuju sejak keputusan 1 Agustus 2026. Dibiarkan
 * hampa, ia terbaca sebagai jejak yang tidak lengkap — pada layar yang dibaca
 * justru untuk memutuskan apakah jejaknya lengkap.
 */
export function penyetujuTampil(nama: string | null | undefined): string {
  if (nama === null || nama === undefined || nama === '') return 'Tidak menuntut persetujuan';
  return nama;
}

/** Objek yang disentuh, dipendekkan — id penuh tetap dapat disalin dari judulnya. */
export function objekTampil(entityType: string | null, entityId: string | null): string {
  if (entityId === null || entityId === '') return '—';
  const potong = entityId.length > 8 ? `${entityId.slice(0, 8)}…` : entityId;
  return entityType === null || entityType === '' ? potong : `${entityType} ${potong}`;
}

export type KeadaanAudit =
  | { jenis: 'awal' }
  | { jenis: 'memuat' }
  | { jenis: 'siap'; hasil: HasilAudit }
  | { jenis: 'galat'; pesan: string };

export interface PeristiwaAuditBaris {
  id: string;
  occurredAt: string;
  recordedAt: string;
  eventType: string;
  kelompok: string | null;
  entityType: string | null;
  entityId: string | null;
  aktorId: string;
  aktorNama: string;
  penyetujuId: string | null;
  penyetujuNama: string | null;
  outletId: string | null;
  outletNama: string | null;
  deviceId: string | null;
  deviceKode: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
}

export interface HasilAudit {
  from: string;
  to: string;
  outletId: string | null;
  eventType: string | null;
  actorUserId: string | null;
  entityId: string | null;
  batas: number;
  kursorBerikut: string | null;
  belumDipancarkan: string[];
  peristiwa: PeristiwaAuditBaris[];
}

export interface PesanLayar {
  judul: string;
  badan: string;
}

/**
 * Pesan yang menggantikan tabel, atau `null` bila tabelnya yang dirender.
 *
 * Aturan yang sama dengan `pesanLaporan` di `b21-daftar.ts`: tiga keadaan yang
 * tampak sama di layar dan berarti hal yang sangat berbeda. Di sini
 * konsekuensinya lebih tajam — "tidak ada aktivitas" yang sebenarnya berarti
 * "gagal memuat" adalah pembebasan yang tidak pernah diucapkan siapa pun.
 */
export function pesanKeadaanAudit(
  keadaan: KeadaanAudit,
  namaOutlet: (id: string | null) => string
): PesanLayar | null {
  if (keadaan.jenis === 'memuat') {
    return { judul: 'Memuat…', badan: 'Server sedang mengumpulkan aktivitas pada rentang ini.' };
  }
  if (keadaan.jenis === 'awal') {
    return {
      judul: 'Pilih rentang tanggal',
      badan: 'Tentukan tanggal awal dan akhir, lalu tekan Tampilkan.',
    };
  }
  if (keadaan.jenis === 'galat') {
    return { judul: 'Audit trail tidak dapat dimuat', badan: keadaan.pesan };
  }

  const { hasil } = keadaan;
  if (hasil.peristiwa.length > 0) return null;

  const periode =
    hasil.from === hasil.to ? `pada ${hasil.from}` : `antara ${hasil.from} dan ${hasil.to}`;
  const saringan = ringkasSaringan({
    outlet: hasil.outletId === null ? null : namaOutlet(hasil.outletId),
    jenis: hasil.eventType,
    aktor: hasil.actorUserId,
    objek: hasil.entityId,
  });

  return {
    judul: 'Tidak ada aktivitas tercatat pada rentang ini',
    badan:
      `Tidak ada peristiwa yang tercatat ${periode} untuk ${namaOutlet(hasil.outletId)}. ` +
      (saringan === null ? '' : `${saringan} `) +
      'Perlu diingat: perangkat kasir yang belum tersinkronisasi juga menghasilkan daftar ' +
      'kosong, jadi periksa status sinkronisasi sebelum menyimpulkan tidak ada aktivitas.',
  };
}
