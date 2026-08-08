// spec-h:62-63 -- tangga backoff dan batas percobaan.
//
// Keduanya hidup HANYA di sini. Menyalinnya ke query SQL atau ke relay
// membuat dua sumber kebenaran yang harus dijaga tetap sepakat, dan
// ketidaksepakatannya tidak akan memunculkan error -- hanya antrean yang
// mengirim terlalu cepat atau terlalu lambat, keduanya sulit dilihat.

/** "2s, 4s, 8s, 16s, 32s, 60s, lalu tetap 60s" (spec-h:62). */
const TANGGA_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];

/** "Setelah 20 percobaan gagal, status menjadi `failed`" (spec-h:63). */
export const BATAS_PERCOBAAN_GAGAL = 20;

/**
 * Jeda sebelum percobaan berikutnya, diberi jumlah percobaan yang SUDAH
 * gagal. `attempts = 1` berarti satu percobaan gagal, jadi jedanya anak
 * tangga pertama.
 *
 * `attempts = 0` tidak seharusnya terjadi (item baru langsung jatuh tempo),
 * tapi ia tetap mengembalikan anak tangga pertama alih-alih nol — jeda nol
 * pada item yang entah bagaimana punya `last_attempt_at` akan membuatnya
 * berputar tanpa henti.
 */
export function jedaBackoffMs(attempts: number): number {
  const i = Math.max(0, Math.floor(attempts) - 1);
  return TANGGA_MS[Math.min(i, TANGGA_MS.length - 1)];
}

interface BarisJatuhTempo {
  attempts: number;
  last_attempt_at: string | null;
}

/**
 * Apakah item boleh dicoba lagi pada `sekarang` (epoch ms).
 *
 * Diturunkan dari `last_attempt_at` + tangga, bukan dari kolom
 * `next_attempt_at` yang disimpan: satu sumber kebenaran, dan tidak ada
 * kolom yang bisa hanyut dari `attempts`.
 */
export function sudahJatuhTempo(baris: BarisJatuhTempo, sekarang: number): boolean {
  if (!baris.last_attempt_at) return true;

  const terakhir = Date.parse(baris.last_attempt_at);
  if (Number.isNaN(terakhir)) return true;

  // Jam perangkat dapat MUNDUR -- koreksi NTP, atau pengguna mengubah
  // tanggal. Tanpa cabang ini, item yang `last_attempt_at`-nya di masa depan
  // terkunci sampai jam menyusul, dan antrean yang berhenti karena jam salah
  // adalah penjualan yang tidak pernah naik tanpa seorang pun
  // menghubungkannya dengan jam.
  if (terakhir > sekarang) return true;

  return sekarang - terakhir >= jedaBackoffMs(baris.attempts);
}

/**
 * Predikat SQL "sudah jatuh tempo", DIHASILKAN dari tangga di atas.
 *
 * Kenapa penyaringan ini harus di SQL dan bukan di JavaScript setelah
 * `LIMIT 50`: lima puluh item lama yang sedang backoff 60 detik akan mengisi
 * seluruh batch dan menyisakan nol, sementara penjualan yang baru saja
 * terjadi menunggu di belakangnya. Kasir tidak melihat apa pun — penjualannya
 * hanya tidak naik.
 *
 * Dihasilkan, bukan diketik ulang: satu-satunya definisi tangga tetap
 * `TANGGA_MS`, dan predikat ini tidak dapat hanyut darinya.
 *
 * Perbandingan memakai STRING ISO, bukan aritmetika tanggal SQLite. Itu aman
 * justru karena hanya relay yang menulis `last_attempt_at`, dan ia selalu
 * memakai `toISOString()` — format tetap, zona UTC, sehingga urutan
 * leksikografisnya sama dengan urutan waktunya.
 */
export function sqlJatuhTempo(alias: string, sekarang: number): { sql: string; params: string[] } {
  const params: string[] = [];
  const cabang: string[] = [`${alias}.last_attempt_at IS NULL`];

  TANGGA_MS.forEach((jeda, i) => {
    const attempts = i + 1;
    const terakhirDiUjung = i === TANGGA_MS.length - 1;
    params.push(new Date(sekarang - jeda).toISOString());
    cabang.push(
      `(${alias}.attempts ${terakhirDiUjung ? '>=' : '='} ${attempts} AND ${alias}.last_attempt_at <= ?)`
    );
  });

  // Jam mundur (koreksi NTP, pengguna mengubah tanggal). Tanpa cabang ini,
  // item yang `last_attempt_at`-nya di masa depan terkunci sampai jam
  // menyusul. Sejajar dengan `sudahJatuhTempo` di atas.
  params.push(new Date(sekarang).toISOString());
  cabang.push(`${alias}.last_attempt_at > ?`);

  return { sql: `(${cabang.join(' OR ')})`, params };
}
