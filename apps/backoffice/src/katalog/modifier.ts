import { bacaRupiah } from './produk.ts';

/**
 * B-09 — Modifier List dan opsinya. Murni.
 *
 * Dua kelompok aturan, keduanya dari spec:
 *
 * **FR-A3** — kombinasi `selectionType`/`min`/`max`/`allowDuplicate`
 * menentukan perilaku dialog di layar KASIR. Merchant yang mengonfigurasinya
 * di back-office tidak pernah melihat dialog itu, jadi `ringkasPerilaku`
 * menerjemahkannya.
 *
 * **FR-A5** — *"Kesalahan penempatan adalah jebakan #1 di modul ini. UI harus
 * MENCEGAHNYA, bukan mendokumentasikannya."* Ukuran dan rasa hampir selalu
 * **variation**, bukan modifier: keduanya punya stok sendiri, dan modifier
 * tidak pernah punya.
 *
 * ⛔ `polaMencurigakan` dan `buatMuatanList` sengaja TIDAK saling tahu. AC
 * `spec-a:163` menuntut peringatan pola **tidak memblokir penyimpanan** —
 * penjaga yang memanggil pendeteksi akan mengubah peringatan menjadi
 * penolakan pada suntingan pertama yang lupa membedakan keduanya.
 */

export interface FormList {
  nama: string;
  selectionType: string;
  minSelections: string;
  maxSelections: string;
  allowDuplicate: boolean;
  isRequired: boolean;
}

export interface MuatanList {
  id: string;
  name: string;
  selectionType: string;
  minSelections: number;
  maxSelections: number | null;
  allowDuplicate: boolean;
  isRequired: boolean;
}

export type Hasil<T, B> = { ok: true; muatan: T } | { ok: false; bidang: B; pesan: string };

const TIPE_SAH = ['single', 'multi'];

/** `''` → `null` (tanpa batas atas). Selain itu wajib bilangan bulat >= 0. */
function bacaCacah(teks: string): number | null | 'salah' {
  const bersih = String(teks ?? '').trim();
  if (bersih.length === 0) return null;
  if (!/^\d+$/.test(bersih)) return 'salah';
  return Number.parseInt(bersih, 10);
}

export function buatMuatanList(form: FormList, id: string): Hasil<MuatanList, keyof FormList> {
  const nama = String(form.nama ?? '').trim();
  if (nama.length === 0) {
    return { ok: false, bidang: 'nama', pesan: 'Nama daftar wajib diisi.' };
  }

  if (!TIPE_SAH.includes(form.selectionType)) {
    return { ok: false, bidang: 'selectionType', pesan: 'Pilih satu pilihan atau beberapa pilihan.' };
  }

  const min = bacaCacah(form.minSelections);
  if (min === 'salah') {
    return { ok: false, bidang: 'minSelections', pesan: 'Minimal harus bilangan bulat 0 atau lebih.' };
  }
  const max = bacaCacah(form.maxSelections);
  if (max === 'salah') {
    return {
      ok: false,
      bidang: 'maxSelections',
      pesan: 'Maksimal harus bilangan bulat 0 atau lebih, atau kosong untuk tanpa batas.',
    };
  }

  // ⛔ Kalimatnya dari server (`modifier-lists.ts`), dan ia menyebut
  // AKIBATNYA. Penolakan "min > max" saja membuat merchant menebak kenapa itu
  // masalah; yang di bawah menjelaskan bahwa dialognya menjadi buntu.
  if (min !== null && max !== null && min > max) {
    return {
      ok: false,
      bidang: 'maxSelections',
      pesan: 'Minimal tidak boleh lebih besar dari maksimal — dialog modifier tidak akan pernah dapat dikonfirmasi kasir.',
    };
  }

  return {
    ok: true,
    muatan: {
      id,
      name: nama,
      selectionType: form.selectionType,
      minSelections: min ?? 0,
      // `null` dipertahankan, bukan dihilangkan: `max_selections IS NULL`
      // berarti "tanpa batas atas", dan itu keadaan bermakna.
      maxSelections: max,
      allowDuplicate: form.allowDuplicate === true,
      isRequired: form.isRequired === true,
    },
  };
}

/* -------------------------------------------------------------- modifier -- */

export interface FormModifier {
  nama: string;
  harga: string;
  isDefault: boolean;
}

export function buatMuatanModifier(
  form: FormModifier,
  id: string
): Hasil<{ id: string; name: string; price: number; isDefault: boolean }, keyof FormModifier> {
  const nama = String(form.nama ?? '').trim();
  if (nama.length === 0) {
    return { ok: false, bidang: 'nama', pesan: 'Nama pilihan wajib diisi.' };
  }

  // ⛔ Kosong berarti NOL, bukan ditolak. Berbeda dari harga varian, yang
  // wajib: modifier tanpa biaya tambahan adalah kasus paling umum ("Tanpa
  // es", "Extra pedas"), dan AC FR-A3 menuntut Rp 0 tetap dapat dibuat —
  // ia mengubah pesanan meski tidak mengubah harga, dan tetap tercetak di
  // struk.
  const teks = String(form.harga ?? '').trim();
  const harga = teks.length === 0 ? 0 : bacaRupiah(teks);
  if (harga === null) {
    return { ok: false, bidang: 'harga', pesan: 'Harga harus rupiah utuh, atau kosong untuk Rp 0.' };
  }

  return { ok: true, muatan: { id, name: nama, price: harga, isDefault: form.isDefault === true } };
}

/* -------------------------------------------------- FR-A5 guardrail pola -- */

/** `spec-a:157` — daftarnya persis, bukan tafsiran. */
const KATA_VARIATION = ['ukuran', 'size', 'varian', 'rasa', 'flavor'];

/**
 * Peringatan pola — **tidak pernah memblokir**.
 *
 * Mengembalikan daftar kalimat. Kosong berarti tidak ada yang mencurigakan.
 */
export function polaMencurigakan(
  nama: string,
  modifiers: readonly { price: number }[]
): string[] {
  const temuan: string[] = [];
  const kecil = String(nama ?? '').toLowerCase();

  const kata = KATA_VARIATION.find((k) => kecil.includes(k));
  if (kata) {
    temuan.push(
      `Nama daftar memuat kata "${kata}". Ukuran, varian, dan rasa biasanya perlu stok sendiri — itu ciri variation, bukan modifier.`
    );
  }

  // ⛔ Minimal DUA opsi. "Semua harga berbeda" secara teknis benar untuk satu
  // elemen, dan peringatan yang muncul saat merchant baru mengisi opsi
  // pertamanya akan diabaikan orang — termasuk nanti saat ia benar.
  if (modifiers.length >= 2) {
    const harga = modifiers.map((m) => Number(m.price));
    const semuaBeda = new Set(harga).size === harga.length;
    const adaNol = harga.some((h) => h === 0);
    if (semuaBeda && !adaNol) {
      temuan.push(
        'Semua pilihan berharga berbeda dan tidak ada yang Rp 0. Itu bentuk daftar harga, bukan daftar tambahan — kemungkinan yang Anda maksud adalah variation.'
      );
    }
  }

  return temuan;
}

/* ------------------------------------------------- FR-A3 perilaku kasir -- */

export interface KonfigPerilaku {
  selectionType: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  allowDuplicate: boolean;
}

/**
 * Menerjemahkan konfigurasi menjadi satu kalimat perilaku di layar kasir.
 *
 * ⛔ Ada karena merchant yang mengonfigurasi di sini **tidak pernah melihat
 * dialog kasirnya**. Tabel `spec-a:119-125` adalah lima kombinasi yang
 * mustahil dinalar dari empat field mentah — dan yang salah dikonfigurasi baru
 * ketahuan saat kasir tidak dapat menyelesaikan pesanan di jam sibuk.
 */
export function ringkasPerilaku(k: KonfigPerilaku): string {
  const bagian: string[] = [];

  if (k.selectionType === 'single') {
    bagian.push(
      k.isRequired
        ? 'Kasir memilih tepat satu, dan wajib memilih sebelum dapat lanjut.'
        : 'Kasir memilih satu, atau memilih "Tanpa pilihan".'
    );
  } else {
    bagian.push(
      k.maxSelections === null
        ? 'Kasir dapat memilih beberapa sekaligus, tanpa batas.'
        : `Kasir dapat memilih beberapa sekaligus, maksimal ${k.maxSelections} — pilihan berikutnya dinonaktifkan dengan pesan, bukan diam-diam gagal.`
    );
  }

  if (k.minSelections > 0) {
    bagian.push(
      `Tombol konfirmasi nonaktif sampai ${k.minSelections} pilihan terpenuhi, dengan hitungannya terlihat.`
    );
  }

  if (k.allowDuplicate) {
    bagian.push('Setiap pilihan punya pengatur jumlah (mis. "Extra Shot ×2"), dan harganya ikut berlipat.');
  }

  return bagian.join(' ');
}
