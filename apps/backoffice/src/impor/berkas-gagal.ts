/**
 * FR-A8, AC keempat: *"File berisi baris gagal dapat diunduh, diperbaiki, dan
 * diunggah ulang"* (`spec-a:288`).
 *
 * Murni: tanpa DOM, tanpa `Blob`, tanpa `<a download>`. Yang di sini hanya
 * string masuk → string keluar, jadi perjalanan pulang-pergi (unduh →
 * perbaiki → unggah ulang) dapat diuji di `node --test` terhadap parser yang
 * sungguhan.
 *
 * ## ⛔ Kenapa ini ada di KLIEN
 *
 * Server tidak pernah melihat isi baris yang gagal. Yang dikembalikannya
 * hanyalah `{ baris, alasan }` — nomor baris dan sebabnya. Isi barisnya ada
 * di berkas yang dipegang merchant, dan hanya di sana.
 *
 * Menyusunnya ulang di server dari hasil parse mustahil: baris yang GAGAL
 * diparse justru yang tidak punya hasil parse. Dan kalaupun bisa, ia akan
 * menghapus kolom yang tidak dikenali parser — kolom yang mungkin justru
 * sedang dipakai merchant untuk catatannya sendiri.
 */

export interface MasalahBaris {
  /** Nomor baris di BERKAS, 1-basis, header dihitung sebagai baris 1. */
  baris: number;
  alasan: string;
}

/** Nama kolom yang ditambahkan; sengaja di luar sinonim yang dikenal parser. */
const KOLOM_ALASAN = 'alasan';

/**
 * Membungkus satu sel CSV bila ia memuat koma, kutip, atau baris baru.
 *
 * Alasan datang dari server dan memuat nilai yang ditolak apa adanya —
 * `Harga tidak valid: "abc"` sudah cukup untuk merusak berkasnya tanpa ini.
 */
function sel(nilai: string): string {
  if (!/[",\n]/.test(nilai)) return nilai;
  return `"${nilai.replace(/"/g, '""')}"`;
}

/**
 * Berkas CSV berisi HANYA baris yang bermasalah, plus kolom `alasan`.
 *
 * Mengembalikan `null` bila tidak ada yang gagal — berkas berisi header saja
 * terunduh sebagai berkas kosong yang membingungkan, dan tidak ada yang perlu
 * diperbaiki.
 *
 * ⛔ Kolom `alasan` aman untuk unggah ulang: `petakanKolom` di
 * `packages/domain/src/impor-katalog.ts` mencari kolom berdasarkan NAMA dan
 * mengabaikan yang tidak dikenal. Itu dibuktikan lewat test perjalanan
 * pulang-pergi terhadap parser sungguhan, bukan disimpulkan dari membaca
 * kodenya.
 */
export function bangunBerkasGagal(csvAsli: string, masalah: readonly MasalahBaris[]): string | null {
  if (masalah.length === 0) return null;

  // BOM dari ekspor Excel di Windows dan CRLF dinormalkan — sama persis
  // dengan yang `pratinjauImpor` lakukan. Berkas hasil yang membawa CR
  // kembali akan diparse ulang dengan benar, tapi ia juga akan dibuka
  // merchant di editor teks, dan campuran akhir-baris di sana adalah gangguan
  // yang tidak perlu dibuat sendiri.
  const bersih = csvAsli.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const semua = bersih.split('\n');
  if (semua.length === 0) return null;

  const keluar: string[] = [`${semua[0]},${KOLOM_ALASAN}`];

  for (const m of masalah) {
    // ⛔ Nomor baris DILEWATI bila di luar jangkauan, tidak melempar. Ia
    // datang dari server, sementara berkasnya dipegang klien — merchant yang
    // memilih berkas lain sebelum mengunduh menghasilkan ketidaksesuaian yang
    // tidak boleh menjatuhkan seluruh layar.
    //
    // Baris 1 adalah header dan bukan data; ia juga dilewati.
    const i = m.baris - 1;
    if (i < 1 || i >= semua.length) continue;
    // Isi baris APA ADANYA. Tidak diparse, tidak disusun ulang.
    keluar.push(`${semua[i]},${sel(m.alasan)}`);
  }

  return keluar.join('\n');
}

/**
 * Nama berkas unduhan, diturunkan dari nama berkas asalnya.
 *
 * Merchant yang mengimpor beberapa berkas (katalog Moka, lalu daftar harga
 * terpisah) menerima beberapa berkas perbaikan; nama yang seragam membuat
 * keduanya bertumpuk di folder Unduhan tanpa dapat dibedakan.
 */
export function namaBerkasGagal(namaAsli: string): string {
  const dasar = namaAsli.replace(/\.[^.]+$/, '').trim();
  if (dasar.length === 0) return 'baris-gagal.csv';
  return `${dasar}-gagal.csv`;
}
