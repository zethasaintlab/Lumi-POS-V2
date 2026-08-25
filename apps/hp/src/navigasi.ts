/**
 * Bilah nav bawah Owner mobile — `IA:§4.2`.
 *
 * ## ⛔ DUA item, dan penambahan ketiga adalah perubahan IA
 *
 * `IA:253`: *"Menambah item ketiga berarti IA-nya sudah bergeser dari 'satu
 * pertanyaan' menjadi 'aplikasi manajemen', dan itu bukan yang dibutuhkan
 * pukul 23:00."* Ada test yang menahannya.
 *
 * ## ⛔ Item keduanya BUKAN yang digambar wireframe, dan itu disengaja
 *
 * Wireframe `IA:§4.2` menulis `[Laporan] [Otorisasi]`. **Otorisasi adalah
 * M-04, dan M-04 tidak ada di v1** (`IA:251`: otorisasi jarak jauh membuka
 * vektor fraud baru, keputusannya ditunda). Menyalin wireframe apa adanya
 * menghasilkan tab yang menuju layar yang tidak ada — dan tab mati terbaca
 * sebagai aplikasi rusak, bukan sebagai fitur yang ditunda.
 *
 * Yang dipakai: `[Ringkasan] [Laporan]`. Jumlahnya tetap dua.
 *
 * ## ⛔ M-02 BUKAN tab
 *
 * `IA:247` menyebutnya *"drill-down dari peringatan di M-01"*. Tab ketiga
 * untuknya akan tampil juga saat tidak ada apa pun yang perlu diperiksa —
 * persis yang `spec-g:245` larang — dan bagian yang selalu tampil berhenti
 * dilihat orang justru saat ia berisi.
 */

export type Rute = 'M-01' | 'M-02' | 'M-03';

export interface ItemNav {
  /** Kode layar `IA:§4.2`, bukan slug karangan. */
  id: 'M-01' | 'M-03';
  label: string;
  rute: Rute;
}

export const ITEM_NAV: ItemNav[] = [
  { id: 'M-01', label: 'Ringkasan', rute: 'M-01' },
  { id: 'M-03', label: 'Laporan', rute: 'M-03' },
];

/**
 * ⛔ Batas keras, dinyatakan sebagai konstanta supaya item ketiga menabraknya
 * alih-alih lolos review.
 */
export const MAKS_ITEM_NAV = 2;

/**
 * Item nav mana yang tampak aktif.
 *
 * ⛔ M-02 menyalakan M-01, bukan tidak ada satu pun. Bilah nav tanpa item
 * aktif membuat orang menyimpulkan ia keluar dari aplikasi, dan yang ia cari
 * berikutnya adalah tombol kembali yang tidak ada di web.
 */
export function navAktif(rute: Rute): ItemNav['id'] {
  return rute === 'M-03' ? 'M-03' : 'M-01';
}
