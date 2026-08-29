/**
 * Aturan pemilihan modifier. FR-A3, `spec-a:113`.
 *
 * ## ⛔ Kenapa di domain, padahal hanya layar kasir yang memakainya
 *
 * `spec-a:117` menulis tabelnya sebagai "perilaku di layar kasir", dan itu
 * benar — tapi aturannya sendiri bukan tata letak. `max_selections = 3` yang
 * dilanggar menghasilkan `order_line_modifier` yang tidak dapat dibuat barista
 * dan tidak dapat dijelaskan laporan mana pun. Menaruhnya di dalam komponen
 * React berarti ia hanya dapat diuji lewat DOM, dan yang hanya dapat diuji
 * lewat DOM biasanya tidak diuji sama sekali.
 *
 * Server BELUM menegakkannya — `POST /orders` menerima modifier apa adanya.
 * Itu batas yang dinyatakan, bukan kelalaian: menegakkannya di server menuntut
 * server membaca `modifier_list` pada setiap penjualan, dan aturannya dapat
 * berubah setelah order antre offline berjam-jam. Berkas ini duduk di tempat
 * yang benar bila keputusan itu berubah.
 *
 * ## ⛔ Kuantitas berskala 1000, meski modifier selalu bilangan bulat
 *
 * Konvensi yang punya pengecualian adalah konvensi yang akan disalin salah.
 * `order_line_modifier.quantity` sudah `INTEGER ×1000` di skema.
 */

/** Satu unit modifier. */
export const QTY_MODIFIER = 1000;

export interface AturanModifier {
  tipe: 'single' | 'multi';
  wajib: boolean;
  minPilih: number;
  /** `null` = tanpa batas. */
  maxPilih: number | null;
  bolehGanda: boolean;
}

/** `modifierId` → kuantitas ×1000. Kunci yang tidak ada = tidak dipilih. */
export type PilihanModifier = Readonly<Record<string, number>>;

/**
 * Jumlah unit yang dipilih — bukan jumlah baris.
 *
 * ⛔ `Extra Shot ×2` dihitung DUA. `spec-a:120` menulis batasnya sebagai
 * "pilihan ke-4 dinonaktifkan", dan dengan `allow_duplicate` sebuah duplikat
 * tetap sebuah pilihan: pelanggan membayarnya dan barista membuatnya.
 * Menghitung baris saja membuat `max_selections = 3` meloloskan enam shot
 * lewat tiga baris ber-qty 2. `[ASUMSI]` — `spec-a` tidak menyatakan
 * interaksi `max_selections` dengan `allow_duplicate`.
 */
export function jumlahUnit(pilihan: PilihanModifier): number {
  let total = 0;
  for (const qty of Object.values(pilihan)) total += qty;
  return total / QTY_MODIFIER;
}

/**
 * Apakah satu unit lagi dari `modifierId` boleh ditambahkan.
 *
 * `single` selalu boleh — memilih yang lain MENGGANTI, bukan menambah.
 */
export function bolehTambah(
  aturan: AturanModifier,
  pilihan: PilihanModifier,
  modifierId: string
): boolean {
  if (aturan.tipe === 'single') return true;
  const sudahAda = (pilihan[modifierId] ?? 0) > 0;
  if (sudahAda && !aturan.bolehGanda) return false;
  if (aturan.maxPilih === null) return true;
  return jumlahUnit(pilihan) < aturan.maxPilih;
}

/**
 * Satu unit lagi. Mengembalikan pilihan BARU; tidak pernah bermutasi.
 *
 * ⛔ Menolak diam-diam bila batasnya sudah tercapai — pemanggil memakai
 * `bolehTambah` untuk menonaktifkan tombolnya lebih dulu (`spec-a:126`:
 * "menonaktifkan pilihan berikutnya dengan pesan, bukan menerima lalu
 * menolak"). Penolakan di sini adalah jaring, bukan antarmukanya.
 */
export function tambahPilihan(
  aturan: AturanModifier,
  pilihan: PilihanModifier,
  modifierId: string
): PilihanModifier {
  if (aturan.tipe === 'single') {
    // Radio: satu-satunya yang terpilih, kuantitas selalu satu.
    return { [modifierId]: QTY_MODIFIER };
  }
  if (!bolehTambah(aturan, pilihan, modifierId)) return pilihan;
  return { ...pilihan, [modifierId]: (pilihan[modifierId] ?? 0) + QTY_MODIFIER };
}

/** Satu unit kurang; nol MENGHAPUS kuncinya, bukan menyimpan `0`. */
export function kurangPilihan(pilihan: PilihanModifier, modifierId: string): PilihanModifier {
  const kini = pilihan[modifierId] ?? 0;
  const sisa = kini - QTY_MODIFIER;
  const baru: Record<string, number> = { ...pilihan };
  // Kunci ber-nilai nol akan terkirim sebagai `order_line_modifier` ber-qty 0
  // — baris yang mengaku ada tapi tidak menambah apa pun ke pesanan.
  if (sisa <= 0) delete baru[modifierId];
  else baru[modifierId] = sisa;
  return baru;
}

/** Toggle untuk `multi` tanpa duplikat, dan pemilihan untuk `single`. */
export function togglePilihan(
  aturan: AturanModifier,
  pilihan: PilihanModifier,
  modifierId: string
): PilihanModifier {
  if (aturan.tipe === 'single') return tambahPilihan(aturan, pilihan, modifierId);
  if ((pilihan[modifierId] ?? 0) > 0) return kurangPilihan(pilihan, modifierId);
  return tambahPilihan(aturan, pilihan, modifierId);
}

/** `single` yang tidak wajib: opsi "Tanpa pilihan" (`spec-a:119`). */
export function kosongkanPilihan(): PilihanModifier {
  return {};
}

/**
 * Berapa unit lagi yang KURANG. `0` berarti sudah cukup.
 *
 * `is_required` diperlakukan sebagai `min_selections = 1` bila `min_selections`
 * tidak menyebut angka yang lebih besar — keduanya menjawab pertanyaan yang
 * sama, dan dua sumber untuk satu pertanyaan menghasilkan dialog yang menolak
 * karena alasan yang tidak ditampilkannya.
 */
export function kurangnya(aturan: AturanModifier, pilihan: PilihanModifier): number {
  const minimum = Math.max(aturan.minPilih, aturan.wajib ? 1 : 0);
  const kurang = minimum - jumlahUnit(pilihan);
  return kurang > 0 ? kurang : 0;
}

/**
 * Pesan yang menyebut ANGKANYA, atau `null` bila pilihan sudah sah.
 *
 * ⛔ `spec-a:122` menuntut "hitungan terlihat". Kasir yang membaca "pilih dulu
 * Topping" tidak tahu apakah ia kurang satu atau kurang tiga, dan menekan
 * tombol yang nonaktif sampai menyerah.
 */
export function pesanKurang(nama: string, aturan: AturanModifier, pilihan: PilihanModifier): string | null {
  const kurang = kurangnya(aturan, pilihan);
  if (kurang === 0) return null;
  const minimum = Math.max(aturan.minPilih, aturan.wajib ? 1 : 0);
  return `${nama}: pilih ${kurang} lagi (minimal ${minimum}).`;
}
