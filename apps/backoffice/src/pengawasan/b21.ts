import { VOID_REASON_CODES, REFUND_REASON_CODES } from '../../../../packages/domain/src/cancellation.ts';

/**
 * B-21 — aturan tampilan Riwayat Void & Refund (FR-G5 X1).
 *
 * ## ⛔ Layar ini menamai orang
 *
 * Ia satu-satunya layar back-office yang menempatkan nama pegawai di sebelah
 * angka yang dapat dibaca sebagai tuduhan. Sejak keputusan 1 Agustus 2026
 * menghapus PIN manajer dari void, ia juga satu-satunya kontrol terhadap
 * penyalahgunaannya — jadi ia harus ada, dan justru karena itu kata-katanya
 * harus tetap deskriptif.
 *
 * Aturannya dipisahkan dari komponen supaya dapat diuji sebagai aturan, bukan
 * diperiksa dengan membaca JSX.
 *
 * ## ⛔ Angka tidak dihitung ulang di sini
 *
 * `rasio` datang dari server sebagai string satu angka desimal, dan ia
 * satu-satunya angka yang mengurutkan tabel. Menghitung ulang atau membulatkan
 * lagi di klien dapat menghasilkan urutan yang berbeda dari yang server kirim
 * — laporan yang barisnya berpindah antar-muat tidak dapat dipercaya oleh
 * orang yang memakainya untuk menilai orang lain.
 *
 * Uang juga tetap string dari ujung ke ujung; `rupiah()` di `katalog/produk.ts`
 * yang mengubahnya, lewat `BigInt`, bukan `Number`.
 *
 * ## Batas yang dinyatakan: zona waktu
 *
 * Endpoint X1 tidak mengembalikan zona outlet, jadi jam ditampilkan di zona
 * PERANGKAT pembaca. Untuk merchant yang outletnya melintasi WIB dan WITA,
 * pembatalan pukul 00:30 di Makassar tampil sebagai 23:30 hari sebelumnya bagi
 * pembaca di Jakarta. Layar menyebutkannya; `waktuTampil` menerima zona
 * sebagai parameter supaya batas itu terlihat di tanda tangan fungsi — dan
 * supaya ia dapat diuji sama sekali.
 *
 * Yang TIDAK terpengaruh: penyaring rentang memakai `business_date` yang
 * dihitung server dari zona outlet masing-masing. Yang bergeser hanya jam yang
 * ditampilkan, bukan hari mana peristiwa itu masuk.
 */

/**
 * Judul layar. Deskriptif — "exception" adalah kosakata IA, bukan tuduhan.
 *
 * ⛔ Ia berbunyi "Laporan Exception", bukan "Riwayat Void & Refund", sejak
 * ketujuh laporan lain punya layar (23 Agustus 2026). `IA:200` menamai B-21
 * **"Laporan Exception (8 laporan)"**, dan judul yang menyebut satu di
 * antaranya membuat tujuh sisanya terbaca seperti tempelan. Judul per laporan
 * hidup di `b21-daftar.ts`.
 */
export const JUDUL_LAYAR = 'Laporan Exception';

/**
 * ⛔ Label untuk SETIAP kode di daftar tertutup domain.
 *
 * Daftarnya hidup di `packages/domain/src/cancellation.ts` dan ditegakkan
 * server. Ini salinan kedua — dan salinan kedua bergeser. Ada test yang
 * membaca daftar domain dan menuntut setiap kodenya punya label di sini, jadi
 * kode alasan yang ditambahkan kelak gagal di test alih-alih tampil sebagai
 * slug mentah di laporan yang dibaca owner.
 */
export const LABEL_ALASAN: Record<string, string> = {
  // Void (`VOID_REASON_CODES`)
  salah_input: 'Salah input',
  pelanggan_batal: 'Pelanggan batal',
  item_habis: 'Item habis',
  uji_coba: 'Uji coba',
  // Refund (`REFUND_REASON_CODES`)
  barang_rusak: 'Barang rusak',
  pesanan_salah: 'Pesanan salah',
  pelanggan_tidak_puas: 'Pelanggan tidak puas',
  kelebihan_bayar: 'Kelebihan bayar',
  // Dipakai keduanya
  lainnya: 'Lainnya',
};

/** Sanity check saat modul dimuat — daftar domain memang yang dilabeli. */
export const KODE_ALASAN: readonly string[] = [...VOID_REASON_CODES, ...REFUND_REASON_CODES];

/**
 * ⛔ Kode tak dikenal tampil apa adanya, tidak pernah kosong.
 *
 * Baris lama dapat memuat kode yang sudah dihapus dari daftar. Sel kosong di
 * kolom Alasan terbaca seperti pembatalan yang alasannya tidak diisi — persis
 * keadaan yang laporan ini cari.
 */
export function labelAlasan(kode: string | null | undefined): string {
  if (kode === null || kode === undefined || kode === '') return 'Tanpa alasan';
  return LABEL_ALASAN[kode] ?? kode;
}

export interface HitunganAlasan {
  reasonCode: string;
  jumlah: number;
}

/** Ringkasan alasan seorang aktor sebagai satu baris tabel. */
export function ringkasAlasan(alasan: readonly HitunganAlasan[]): string {
  if (alasan.length === 0) return '—';
  return alasan.map((a) => `${labelAlasan(a.reasonCode)} ${a.jumlah}×`).join(' · ');
}

/**
 * Rasio dari server, hanya dipindahkan ke format Indonesia.
 *
 * ⛔ Titik jadi koma, tidak ada aritmetika sama sekali. Lihat catatan kepala.
 */
export function rasioTampil(rasio: string | null | undefined): string {
  if (rasio === null || rasio === undefined || rasio === '') return '—';
  return `${rasio.replace('.', ',')}×`;
}

/**
 * Kalimat pembanding untuk rasio.
 *
 * ⛔ Deskriptif, bukan penilaian. "2,4× rata-rata" menyatakan fakta; "tinggi"
 * atau "perlu diperiksa" adalah kesimpulan yang ditarik sistem atas nama
 * manusia — dan aturan design system #5 sudah menuntut status berupa teks,
 * jadi tidak ada jalan keluar lewat warna saja.
 *
 * Ambang 1,0 dibandingkan pada teks yang server kirim, bukan pada `parseFloat`
 * dari nilai yang mungkin cacat: `Number('')` adalah `0`, dan itu akan
 * melabeli baris kosong "di bawah rata-rata".
 */
export function bandingRata(rasio: string | null | undefined): string {
  if (rasio === null || rasio === undefined || rasio === '') return '—';
  const n = Number(rasio);
  if (!Number.isFinite(n)) return '—';
  if (n === 1) return 'sama dengan rata-rata';
  return n > 1 ? `${rasioTampil(rasio)} di atas rata-rata` : `${rasioTampil(rasio)} di bawah rata-rata`;
}

const BULAN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/**
 * `26 Jul 2026 14:32` — format `CLAUDE.md`, di zona yang DIBERIKAN.
 *
 * Disusun dari bagian-bagian `Intl` alih-alih `toLocaleString('id-ID')`:
 * keluaran locale berbeda antar runtime (Node vs browser vs versi ICU), dan
 * format tanggal yang berubah diam-diam di laporan yang dicetak adalah cacat
 * yang tidak seorang pun laporkan sebagai bug.
 */
export function waktuTampil(iso: string, zona: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  const bagian = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const ambil = (jenis: string) => bagian.find((p) => p.type === jenis)?.value ?? '';
  const bulan = BULAN[Number(ambil('month')) - 1] ?? ambil('month');
  // `hour12: false` dapat menghasilkan "24" untuk tengah malam di sebagian ICU.
  const jam = ambil('hour') === '24' ? '00' : ambil('hour');
  return `${ambil('day')} ${bulan} ${ambil('year')} ${jam}.${ambil('minute')}`.replace('.', ':');
}

/** Zona perangkat — nilai bawaan, dan layar menyebutkan bahwa ia dipakai. */
export function zonaPerangkat(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export interface Peristiwa {
  auditId: string;
  occurredAt: string;
  recordedAt: string;
  jenis: 'void' | 'refund';
  aktorId: string;
  aktorNama: string;
  penyetujuId: string | null;
  penyetujuNama: string | null;
  orderId: string;
  receiptNumber: string;
  nilai: string;
  reasonCode: string | null;
  reasonNote: string | null;
  outletId: string | null;
}

export interface RingkasanAktor {
  userId: string;
  name: string;
  jumlahVoid: number;
  nilaiVoid: string;
  jumlahRefund: number;
  nilaiRefund: string;
  jumlahTotal: number;
  rasio: string;
  alasan: HitunganAlasan[];
}

export interface HasilLaporan {
  from: string;
  to: string;
  outletId: string | null;
  perAktor: RingkasanAktor[];
  peristiwa: Peristiwa[];
}

export type Keadaan =
  | { jenis: 'awal' }
  | { jenis: 'memuat' }
  | { jenis: 'siap'; hasil: HasilLaporan }
  | { jenis: 'galat'; pesan: string };

export interface PesanLayar {
  judul: string;
  badan: string;
}

/**
 * ⛔ `pesanKeadaan` sudah TIDAK ada di sini.
 *
 * Ia dulu memutuskan keadaan layar untuk X1 sendirian. Sejak ketujuh laporan
 * lain punya layar, keputusannya sama persis untuk kedelapannya — dan tiga
 * keadaan yang tampak sama ("belum dimuat", "tidak ada apa-apa", "gagal
 * memuat") adalah tepat jenis keputusan yang tidak boleh punya delapan salinan.
 * Yang kedua adalah kabar baik; yang ketiga adalah laporan yang **tidak boleh**
 * dipercaya sebagai bukti tidak ada apa-apa, dan salinan yang lupa
 * membedakannya membuat kegagalan jaringan terbaca sebagai pembebasan.
 *
 * Penggantinya `pesanLaporan` di `b21-daftar.ts`, yang menerima definisi
 * laporannya. Kosakata per laporan ada di definisi itu; aturannya satu.
 */
