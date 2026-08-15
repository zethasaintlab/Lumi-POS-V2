/**
 * B-08 — pohon kategori. Murni: daftar masuk, pohon keluar.
 *
 * ## ⛔ Dua tingkat, dan itu batas server
 *
 * `POST/PATCH /categories` menolak tingkat KETIGA dengan `409`. Yang di sini
 * menolaknya lebih dulu dan MENJELASKAN: pemilih induk yang menawarkan
 * kategori bertingkat dua adalah pemilih yang setiap pilihannya gagal setelah
 * dikirim.
 *
 * ## ⛔ Urutan dimiliki JS, bukan diwarisi dari urutan datang
 *
 * `GET /categories` mengembalikan barisnya dalam urutan yang dijamin SQL — dan
 * jaminan yang hanya hidup di SQL tidak dapat diuji sama sekali (`CLAUDE.md`:
 * "fake juga tidak menegakkan ORDER BY"). Kalau urutannya penting bagi
 * pengguna, ia dimiliki di titik data disusun. Ini titik itu.
 */

export interface Kategori {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  colorHint?: string | null;
  archivedAt: string | null;
}

export interface SimpulKategori {
  kategori: Kategori;
  anak: Kategori[];
}

function bandingkan(a: Kategori, b: Kategori): number {
  // `sortOrder` lebih dulu, lalu nama. Tanpa pemecah seri kedua, dua kategori
  // ber-`sortOrder` sama berpindah urutan setiap kali daftar dimuat ulang —
  // dan merchant membaca itu sebagai layar yang tidak stabil.
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name, 'id');
}

export function susunPohon(semua: readonly Kategori[]): SimpulKategori[] {
  const adaId = new Set(semua.map((k) => k.id));

  // ⛔ Sebuah kategori dianggap AKAR bila induknya null, menunjuk dirinya
  // sendiri, atau tidak ada di daftar ini.
  //
  // Yang terakhir terjadi nyata: induknya terarsip dan daftar dimuat tanpa
  // yang terarsip. Menjatuhkan anaknya diam-diam membuat kategori hilang dari
  // layar sementara produk di dalamnya tetap menunjuknya — merchant mencarinya
  // dan tidak menemukannya di mana pun.
  //
  // Yang menunjuk dirinya sendiri seharusnya mustahil (server menolaknya),
  // tapi baris seperti itu dapat lahir dari data lama. Rekursi naif atasnya
  // berputar selamanya dan membekukan tab.
  const akar = semua.filter(
    (k) => k.parentId === null || k.parentId === k.id || !adaId.has(k.parentId)
  );

  return [...akar].sort(bandingkan).map((kategori) => ({
    kategori,
    anak: semua
      .filter((k) => k.parentId === kategori.id && k.id !== kategori.id)
      .sort(bandingkan),
  }));
}

/**
 * Kategori yang boleh dipilih sebagai induk untuk `untukId`.
 *
 * Tiga yang dikeluarkan, masing-masing karena server akan menolaknya:
 *
 * 1. **Dirinya sendiri** — kategori tidak dapat menjadi induk dirinya (`409`).
 * 2. **Yang sudah punya induk** — menaruh apa pun di bawahnya adalah tingkat
 *    ketiga.
 * 3. **Yang terarsip** — induk terarsip menyembunyikan anaknya dari daftar
 *    biasa.
 *
 * ⛔ Dan satu yang datang dari sisi sebaliknya: bila `untukId` sendiri PUNYA
 * ANAK, ia tidak dapat dipindahkan ke bawah induk mana pun — anak-anaknya akan
 * menjadi tingkat ketiga. Dalam hal itu daftar yang dikembalikan **kosong**,
 * dan layar menjelaskannya alih-alih menampilkan pemilih yang setiap
 * pilihannya gagal.
 *
 * `untukId` `null` berarti kategori BARU (belum punya id, belum punya anak).
 */
export function indukYangBoleh(
  semua: readonly Kategori[],
  untukId: string | null
): Kategori[] {
  if (untukId !== null) {
    const punyaAnak = semua.some((k) => k.parentId === untukId && k.id !== untukId);
    if (punyaAnak) return [];
  }

  return semua
    .filter(
      (k) =>
        k.id !== untukId &&
        k.parentId === null &&
        k.archivedAt === null
    )
    .sort(bandingkan);
}
