/**
 * Buku kas — aturan murni di balik `cash_movement` (FR-D5, FR-D6,
 * `product/specs/spec-d-kas-shift.md`).
 *
 * ## Kenapa di packages/domain
 *
 * `spec-d:14` menjadikan satu penjumlahan sebagai SATU-SATUNYA definisi saldo
 * laci:
 *
 *     saldo laci = saldo_awal + SUM(cash_movement.delta)
 *
 * Server dan klien sama-sama menulis baris ini — klien saat menjual dan
 * merefund offline, server saat menerimanya. Kalau aturan arah dan
 * `counterpart_type` disalin ke dua tempat, keduanya akan bergeser
 * sendiri-sendiri, dan bentuk kegagalannya adalah yang paling sulit
 * diselesaikan siapa pun: saldo laci menurut perangkat berbeda dari saldo laci
 * menurut server untuk shift yang sama, tanpa cara memutuskan mana yang benar.
 *
 * Murni: tanpa I/O, tanpa waktu, tanpa database.
 *
 * ## Sejarah yang membuat berkas ini ada
 *
 * Sampai 14 Agustus 2026 saldo laci di klien dihitung dari tabel `payment`,
 * bukan dari sini. Refund tidak pernah menulis baris `payment` — arah
 * berlawanan dinyatakan lewat tabel `refund` — jadi refund tunai TIDAK PERNAH
 * mengurangi saldo seharusnya. Kasir yang merefund Rp 300.000 terlihat kurang
 * Rp 300.000 untuk laci yang isinya persis benar, dan karena itu di atas
 * ambang Rp 20.000, tutup kasnya menuntut otorisasi manajer untuk selisih yang
 * tidak pernah ada.
 */

/** `spec-d:189`. */
export const TIPE_MOVEMENT = [
  'opening_float',
  'sale',
  'refund',
  'paid_in',
  'paid_out',
  'bank_deposit',
  'adjustment',
] as const;

export type TipeMovement = (typeof TIPE_MOVEMENT)[number];

/** `spec-d:191`. */
export type CounterpartType =
  | 'sales_revenue'
  | 'refund'
  | 'owner_draw'
  | 'expense'
  | 'bank'
  | 'unidentified';

/**
 * Sisi lawan akuntansi per tipe movement (FR-D6).
 *
 * Field ini tidak dipakai v1 dan justru itu bahayanya: nilainya baru terbaca
 * saat merchant meminta jurnal akuntansi, dan saat itu data historis sudah
 * terlanjur ditulis. Mengisinya dengan benar sekarang jauh lebih murah
 * daripada menebaknya dari data lama nanti.
 *
 * `paid_in` sengaja `unidentified`, bukan `sales_revenue`: uang masuk yang
 * bukan penjualan bisa berupa modal tambahan, pengembalian dari supplier, atau
 * hal lain yang hanya orang yang memasukkannya tahu. `unidentified` di sini
 * berarti persis apa yang dikatakannya — belum diidentifikasi — dan itu jujur.
 */
const COUNTERPART: Readonly<Record<TipeMovement, CounterpartType>> = {
  opening_float: 'unidentified',
  sale: 'sales_revenue',
  refund: 'refund',
  paid_in: 'unidentified',
  paid_out: 'expense',
  bank_deposit: 'bank',
  adjustment: 'unidentified',
};

/**
 * Tipe movement yang mengurangi laci.
 *
 * `bank_deposit` termasuk: menyetor ke bank berarti uangnya keluar dari laci.
 */
const MENGURANGI: ReadonlySet<string> = new Set(['refund', 'paid_out', 'bank_deposit']);

/**
 * Satu-satunya tipe yang menerima tanda dari pemanggil.
 *
 * Koreksi bisa ke dua arah, jadi `adjustment` tidak dapat menyimpulkan
 * arahnya dari tipenya sendiri. Ia dipisahkan menjadi konstanta supaya
 * pengecualiannya terlihat di satu tempat, bukan tersebar sebagai `if` di
 * beberapa cabang.
 */
const DUA_ARAH: ReadonlySet<string> = new Set(['adjustment']);

function pastikanTipe(tipe: string): TipeMovement {
  if (!(TIPE_MOVEMENT as readonly string[]).includes(tipe)) {
    throw new Error(
      `Tipe cash_movement "${tipe}" tidak dikenal. Daftar tertutupnya: ${TIPE_MOVEMENT.join(', ')}.`
    );
  }
  return tipe as TipeMovement;
}

/**
 * Sisi lawan untuk `tipe`.
 *
 * ⛔ Tipe tak dikenal MELEMPAR, tidak jatuh ke `unidentified`. Nilai itu ada
 * di daftar yang sah, jadi memakainya sebagai fallback akan terlihat masuk
 * akal — dan akibatnya salah ketik tersimpan diam-diam sebagai kategori
 * akuntansi yang sah, di kolom yang seluruh gunanya adalah dipercaya nanti.
 */
export function counterpartUntuk(tipe: string): CounterpartType {
  return COUNTERPART[pastikanTipe(tipe)];
}

/**
 * `delta` bertanda untuk satu movement.
 *
 * ⛔ `besaran` selalu positif; tandanya ditentukan TIPE. Kalau pemanggil boleh
 * mengirim tanda sendiri, ada dua sumber kebenaran untuk arah uang dan
 * keduanya dapat bertentangan — `refund` dengan delta positif akan MENAMBAH
 * laci, dan tidak ada yang mengeluh.
 *
 * Pengecualiannya `adjustment`, dan hanya itu.
 */
export function deltaBertanda(tipe: string, besaran: number): number {
  const t = pastikanTipe(tipe);
  if (DUA_ARAH.has(t)) return besaran;
  if (besaran < 0) {
    throw new Error(
      `cash_movement "${t}" menerima besaran negatif (${besaran}); arah ditentukan tipenya, ` +
        'bukan tanda yang dikirim pemanggil.'
    );
  }
  return MENGURANGI.has(t) ? -besaran : besaran;
}

/**
 * `spec-d:14` — dan tidak lebih dari itu.
 *
 * ⛔ Tidak ada clamp, tidak ada pembulatan, tidak ada "saldo tidak boleh
 * negatif". Saldo negatif berarti uang keluar lebih banyak daripada yang
 * pernah masuk — keadaan yang salah di dunia nyata, dan justru yang paling
 * perlu terlihat owner. Menjepitnya ke nol menyembunyikannya.
 *
 * Ketiganya juga akan membuat hasilnya bergantung pada URUTAN, dan `spec-d:315`
 * menuntut sebaliknya untuk urutan operasi apa pun.
 */
export function saldoLaci(saldoAwal: number, deltas: readonly number[]): number {
  let total = saldoAwal;
  for (const d of deltas) total += d;
  return total;
}
