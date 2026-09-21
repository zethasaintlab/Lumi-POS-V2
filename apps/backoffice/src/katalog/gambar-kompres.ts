import {
  BATAS_BYTE,
  KUALITAS_TURUN_PERSEN,
  MIME_SIMPAN,
  MIME_SUMBER,
  SISI_PIKSEL,
  byteDariBase64,
} from '../../../../packages/domain/src/gambar-produk.ts';

/**
 * Kompresi gambar produk di KLIEN back-office (B-07).
 *
 * `CLAUDE.md` § Gambar produk: *"Kompresi di KLIEN back-office, bukan di
 * server. Canvas API mengecilkan ke ~400×400 WebP sebelum unggah — nol
 * dependensi native baru di server, dan CPU-nya di mesin yang tidak melayani
 * penjualan."*
 *
 * ## ⛔ Tangga kualitas, bukan `q` tetap
 *
 * Ukuran WebP bergantung pada ISI, dan rentangnya terukur **50×** antara foto
 * yang mudah dan sulit dikompresi (`docs/verifikasi/GAMBAR-ANGGARAN.md` § 2).
 * Satu nilai `q` karena itu tidak dapat menjamin apa pun: `q=0.8` menghasilkan
 * 1,9 KB untuk bidang warna dan 108 KB untuk derau. Yang dijamin adalah
 * HASILNYA — turunkan kualitas sampai muat.
 *
 * ⛔ Tangganya berhenti di 50 dan TIDAK menyerah diam-diam di bawah itu. Foto
 * yang tetap tidak muat pada 50% dikembalikan sebagai kegagalan bernama;
 * mengompresnya lebih jauh menghasilkan artefak blok yang terlihat sebagai
 * KOTOR pada makanan, dan gambar yang membuat produk terlihat buruk lebih
 * merugikan daripada kartu tanpa gambar.
 *
 * ## ⛔ Encoder DI-INJECT
 *
 * Tangganya adalah aturan produk — berapa kali mencoba, kapan berhenti, apa
 * yang dilaporkan saat gagal — dan aturan yang hanya dapat diuji lewat DOM
 * biasanya tidak diuji sama sekali. Bentuk yang sama dengan `modifier-pilihan`
 * yang aturannya keluar dari komponen React (`CLAUDE.md` § FR-A3).
 */

/** Meng-encode kanvas ke base64 pada kualitas tertentu (persen). */
export type Encoder = (kualitasPersen: number) => Promise<string>;

export type HasilKompres =
  | { ok: true; base64: string; byte: number; kualitasPersen: number; percobaan: number }
  | { ok: false; kode: 'TETAP_TERLALU_BESAR' | 'ENCODER_GAGAL'; pesan: string; byte: number };

/**
 * Turuni tangga kualitas sampai hasilnya ≤ `BATAS_BYTE`.
 *
 * ⛔ Yang dibandingkan byte hasil DECODE (`byteDariBase64`), bukan panjang
 * teksnya. Batas domain dinyatakan dalam byte mentah; membandingkannya dengan
 * panjang base64 akan menolak setiap gambar di atas ~22 KB — 25% lebih ketat
 * daripada yang merchant diberi tahu, tanpa satu pun pesan yang menjelaskannya.
 */
export async function kompresBertahap(encode: Encoder): Promise<HasilKompres> {
  let terakhir = 0;
  for (const [i, q] of KUALITAS_TURUN_PERSEN.entries()) {
    let base64: string;
    try {
      base64 = await encode(q);
    } catch {
      return {
        ok: false,
        kode: 'ENCODER_GAGAL',
        pesan: 'Gambar tidak dapat diproses di peramban ini. Coba berkas lain.',
        byte: 0,
      };
    }
    if (base64.length === 0) {
      return {
        ok: false,
        kode: 'ENCODER_GAGAL',
        pesan: 'Gambar tidak dapat diproses di peramban ini. Coba berkas lain.',
        byte: 0,
      };
    }

    const byte = byteDariBase64(base64);
    terakhir = byte;
    if (byte <= BATAS_BYTE) {
      return { ok: true, base64, byte, kualitasPersen: q, percobaan: i + 1 };
    }
  }

  /* ⛔ Kegagalan BERNAMA dengan angkanya, bukan pemaksaan kualitas lebih
     rendah. Merchant yang fotonya ditolak harus tahu berapa besarnya dan apa
     yang dapat ia lakukan — dan yang dapat ia lakukan nyata: latar polos dan
     potongan yang lebih rapat memangkas WebP jauh lebih banyak daripada
     kualitas. */
  const kb = Math.ceil(terakhir / 1024);
  return {
    ok: false,
    kode: 'TETAP_TERLALU_BESAR',
    pesan:
      `Setelah dikompresi maksimal, gambar masih ${kb} KB — batasnya ` +
      `${BATAS_BYTE / 1024} KB. Coba foto dengan latar lebih polos, atau potong ` +
      'lebih rapat ke produknya.',
    byte: terakhir,
  };
}

export function mimeSumberSah(mime: string): boolean {
  return (MIME_SUMBER as readonly string[]).includes(mime);
}

/**
 * Muat berkas → kanvas 400×400 → encoder.
 *
 * ⛔ **Dipotong TENGAH, bukan diregangkan.** `object-fit: cover` di kartu
 * kasir sudah memotong; meregangkan di sini berarti gambar tersimpan sudah
 * cacat proporsinya dan tidak ada jalan kembali — sumbernya tidak disimpan.
 *
 * ⛔ Selalu tepat `SISI_PIKSEL` × `SISI_PIKSEL`, juga untuk sumber yang lebih
 * kecil. Server memeriksa dimensi yang klien SEBUTKAN, dan klien yang
 * mengirim ukuran asli untuk foto 200×200 akan ditolak `DIMENSI_SALAH` setelah
 * merchant menunggu unggahannya.
 */
export async function siapkanDariBerkas(berkas: File): Promise<HasilKompres> {
  if (!mimeSumberSah(berkas.type)) {
    return {
      ok: false,
      kode: 'ENCODER_GAGAL',
      pesan: 'Format berkas tidak didukung. Pakai JPG, PNG, atau WebP.',
      byte: 0,
    };
  }

  const url = URL.createObjectURL(berkas);
  try {
    const img = await new Promise<HTMLImageElement>((selesai, tolak) => {
      const el = new Image();
      el.onload = () => selesai(el);
      el.onerror = () => tolak(new Error('gambar tidak dapat dibaca'));
      el.src = url;
    });

    const kanvas = document.createElement('canvas');
    kanvas.width = SISI_PIKSEL;
    kanvas.height = SISI_PIKSEL;
    const ctx = kanvas.getContext('2d');
    if (!ctx) {
      return {
        ok: false,
        kode: 'ENCODER_GAGAL',
        pesan: 'Peramban ini tidak menyediakan kanvas 2D.',
        byte: 0,
      };
    }

    // Potongan tengah persegi dari sumbernya.
    const sisi = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - sisi) / 2;
    const sy = (img.naturalHeight - sisi) / 2;
    ctx.drawImage(img, sx, sy, sisi, sisi, 0, 0, SISI_PIKSEL, SISI_PIKSEL);

    return await kompresBertahap(async (persen) => {
      const blob = await new Promise<Blob | null>((r) =>
        kanvas.toBlob(r, MIME_SIMPAN, persen / 100)
      );
      if (!blob) return '';
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      // Potong per 8 KB: `String.fromCharCode(...buf)` melempar
      // `RangeError: Maximum call stack size exceeded` pada muatan besar, dan
      // sumbernya di sini dapat beberapa megabyte sebelum kompresi.
      for (let i = 0; i < buf.length; i += 8192) {
        s += String.fromCharCode(...buf.subarray(i, i + 8192));
      }
      return btoa(s);
    });
  } catch {
    return {
      ok: false,
      kode: 'ENCODER_GAGAL',
      pesan: 'Berkas ini bukan gambar yang dapat dibaca.',
      byte: 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
