/**
 * FR-A8 — impor katalog (`spec-a:252`).
 *
 * `spec-a:254`: "Ini **fitur akuisisi**, bukan utilitas admin — migrasi
 * katalog adalah biaya switching terbesar bagi merchant yang pindah dari
 * kompetitor."
 *
 * ## Murni
 *
 * Tanpa I/O, tanpa jam. Pemanggil yang membaca berkas dan menulis ke
 * database; yang di sini hanya membaca teks CSV dan memutuskan baris mana yang
 * dapat diimpor.
 *
 * ## ⛔ Tidak ada impor parsial diam-diam (`spec-a:287`)
 *
 * Setiap baris data masuk TEPAT SATU kelompok: `valid`, `dilewati`, atau
 * `masalah`. `jumlahBaris` ada supaya pemanggil dapat memeriksanya, dan ada
 * test yang menjumlahkan ketiganya. Baris yang hilang dari ketiganya adalah
 * baris yang tidak diimpor dan tidak dilaporkan.
 */

/** Kolom yang dikenali, dengan sinonim dari ekspor kompetitor. */
const KOLOM: Record<string, readonly string[]> = {
  nama: ['nama', 'name', 'nama produk', 'product name', 'item name', 'produk'],
  kategori: ['kategori', 'category', 'kategori produk'],
  harga: ['harga', 'price', 'harga jual', 'selling price'],
};

export interface BarisImpor {
  nama: string;
  kategori: string | null;
  harga: number;
  /** `true` bila baris ini memperbarui produk yang sudah ada. */
  perbarui: boolean;
  /** Nomor baris di BERKAS, 1-based, header terhitung. */
  baris: number;
}

export interface MasalahImpor {
  /** Nomor baris di BERKAS, 1-based — bukan indeks larik data. */
  baris: number;
  alasan: string;
}

export interface HasilPratinjau {
  valid: BarisImpor[];
  dilewati: { baris: number; nama: string }[];
  masalah: MasalahImpor[];
  kategoriBaru: string[];
  /** Jumlah baris DATA yang dibaca (tanpa header, tanpa baris kosong). */
  jumlahBaris: number;
  /** Terisi bila berkasnya sendiri tidak dapat dibaca. */
  galatBerkas: string | null;
}

/**
 * Harga dari teks bergaya Indonesia.
 *
 * ⛔ Titik hanya diterima sebagai pemisah RIBUAN, dan pengelompokannya harus
 * TEPAT tiga digit. `"25.5"` yang dibaca sebagai `255` adalah kesalahan 10×
 * yang tidak menghasilkan error apa pun — merchant menemukannya saat pelanggan
 * membayar.
 *
 * Desimal ditolak seluruhnya: rupiah selalu bilangan bulat (`CLAUDE.md` §
 * Konvensi data), dan design system menetapkan tampilan tanpa desimal.
 *
 * `null` berarti tidak dapat dibaca — pemanggil yang memutuskan pesannya.
 */
export function parseHarga(mentah: string): number | null {
  const t = String(mentah ?? '')
    .trim()
    .replace(/^rp\.?\s*/i, '');
  if (t.length === 0) return null;

  // Bentuk paling sederhana: digit saja.
  if (/^\d+$/.test(t)) return Number(t);

  // Bergaya ribuan: 1-3 digit lalu kelompok tepat 3 digit.
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));

  // Sisanya — desimal, pengelompokan salah, huruf — ditolak.
  return null;
}

function pecahBarisCsv(baris: string): string[] {
  const hasil: string[] = [];
  let kini = '';
  let dalamKutip = false;
  for (let i = 0; i < baris.length; i += 1) {
    const c = baris[i];
    if (dalamKutip) {
      if (c === '"') {
        // `""` di dalam kutip berarti satu kutip harfiah.
        if (baris[i + 1] === '"') {
          kini += '"';
          i += 1;
        } else {
          dalamKutip = false;
        }
      } else {
        kini += c;
      }
      continue;
    }
    if (c === '"') {
      dalamKutip = true;
      continue;
    }
    if (c === ',') {
      hasil.push(kini);
      kini = '';
      continue;
    }
    kini += c;
  }
  hasil.push(kini);
  return hasil.map((s) => s.trim());
}

/** Indeks kolom per peran, atau `null` bila kolom wajibnya tidak ada. */
function petakanKolom(header: string[]): { nama: number; kategori: number; harga: number } | null {
  const cari = (peran: keyof typeof KOLOM) =>
    header.findIndex((h) => KOLOM[peran].includes(h.trim().toLowerCase()));
  const nama = cari('nama');
  const harga = cari('harga');
  if (nama < 0 || harga < 0) return null;
  return { nama, kategori: cari('kategori'), harga };
}

export function pratinjauImpor(
  teks: string,
  {
    kategoriAda = [],
    namaAda = [],
    bilaSudahAda = 'lewati',
  }: {
    kategoriAda?: readonly string[];
    namaAda?: readonly string[];
    /** Ditanyakan SEKALI di awal (`spec-a:280`), bukan per baris. */
    bilaSudahAda?: 'lewati' | 'perbarui';
  } = {}
): HasilPratinjau {
  const kosong: HasilPratinjau = {
    valid: [],
    dilewati: [],
    masalah: [],
    kategoriBaru: [],
    jumlahBaris: 0,
    galatBerkas: null,
  };

  // BOM dari ekspor Excel di Windows, dan CRLF.
  const bersih = teks.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const semua = bersih.split('\n');
  if (semua.length === 0 || semua[0].trim().length === 0) {
    return { ...kosong, galatBerkas: 'Berkas kosong.' };
  }

  const kolom = petakanKolom(pecahBarisCsv(semua[0]));
  if (!kolom) {
    // ⛔ Dilaporkan sebagai galat BERKAS, bukan sebagai nol baris valid.
    // Berkas yang menghasilkan "0 baris" tanpa penjelasan membuat merchant
    // mengira katalognya kosong, bukan mengira formatnya salah.
    return {
      ...kosong,
      galatBerkas:
        'Kolom "nama" dan "harga" tidak ditemukan di baris pertama. ' +
        'Periksa apakah berkas memakai koma sebagai pemisah.',
    };
  }

  const hasil: HasilPratinjau = { ...kosong, valid: [], dilewati: [], masalah: [], kategoriBaru: [] };
  const kunci = (s: string) => s.trim().toLowerCase();
  const sudahDiBerkas = new Set<string>();
  const adaDiKatalog = new Set(namaAda.map(kunci));
  const kategoriDikenal = new Set(kategoriAda.map(kunci));
  const kategoriBaru = new Map<string, string>();

  for (let i = 1; i < semua.length; i += 1) {
    const mentah = semua[i];
    if (mentah.trim().length === 0) continue;

    // ⛔ Nomor baris BERKAS, 1-based. Merchant memperbaikinya di spreadsheet,
    // dan di sana header adalah baris 1 — indeks larik data akan menunjuk
    // baris yang salah, dan perbaikan di baris yang salah membuat impor kedua
    // gagal juga.
    const nomor = i + 1;
    hasil.jumlahBaris += 1;

    const sel = pecahBarisCsv(mentah);
    const nama = (sel[kolom.nama] ?? '').trim();
    if (nama.length === 0) {
      hasil.masalah.push({ baris: nomor, alasan: 'Nama produk kosong.' });
      continue;
    }

    if (sudahDiBerkas.has(kunci(nama))) {
      hasil.masalah.push({
        baris: nomor,
        alasan: `Nama produk "${nama}" duplikat di dalam berkas ini.`,
      });
      continue;
    }

    const hargaMentah = (sel[kolom.harga] ?? '').trim();
    const harga = parseHarga(hargaMentah);
    if (harga === null) {
      hasil.masalah.push({
        baris: nomor,
        // Nilai yang ditolak IKUT disebut: "harga tidak valid" tanpa nilainya
        // memaksa merchant membuka berkasnya sendiri untuk menebak.
        alasan: `Harga "${hargaMentah}" tidak dapat dibaca sebagai rupiah bulat.`,
      });
      continue;
    }

    sudahDiBerkas.add(kunci(nama));

    if (adaDiKatalog.has(kunci(nama)) && bilaSudahAda === 'lewati') {
      // ⛔ Dilewati BUKAN masalah — merchant sudah memutuskannya di awal
      // (`spec-a:280`), dan menandainya sebagai masalah membuat ringkasan
      // impor terlihat gagal padahal berjalan sesuai permintaan.
      hasil.dilewati.push({ baris: nomor, nama });
      continue;
    }

    const kategoriMentah = kolom.kategori >= 0 ? (sel[kolom.kategori] ?? '').trim() : '';
    const kategori = kategoriMentah.length > 0 ? kategoriMentah : null;
    if (kategori && !kategoriDikenal.has(kunci(kategori)) && !kategoriBaru.has(kunci(kategori))) {
      // `spec-a:278`: kategori yang belum ada DIBUAT otomatis, dicatat di
      // ringkasan. Menolak barisnya akan membuat merchant memperbaiki ratusan
      // baris untuk sesuatu yang dapat diselesaikan sistem.
      kategoriBaru.set(kunci(kategori), kategori);
    }

    hasil.valid.push({
      nama,
      kategori,
      harga,
      perbarui: adaDiKatalog.has(kunci(nama)),
      baris: nomor,
    });
  }

  hasil.kategoriBaru = [...kategoriBaru.values()];
  return hasil;
}
