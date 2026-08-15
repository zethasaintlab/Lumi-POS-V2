/**
 * B-25 — Pajak. Murni.
 *
 * ## ⛔ Persen → pecahan lewat GESER KOMA, tidak pernah lewat pembagian
 *
 * `rate` wajib **string desimal pecahan** (`"0.11"`), sementara merchant
 * berpikir **persen** (`11%` — format yang `CLAUDE.md` tetapkan).
 *
 * `parseRateToScaled` menolak `number` secara eksplisit, dan komentarnya
 * menyebut alasannya: *"JSON.parse menghasilkan `number` untuk `0.1`.
 * Menerimanya diam-diam akan membatalkan seluruh alasan modul ini ada."*
 *
 * Membagi `11 / 100` di klien menyentuh IEEE754 double persis di jalur yang
 * modul itu bangun untuk dihindari. Yang di sini menggeser koma pada STRING —
 * tidak ada aritmetika float di mana pun.
 *
 * ## ⛔ Tidak ada `PATCH`, dan itu DISENGAJA
 *
 * FR-C6 memperlakukan tarif sebagai entitas berdata, bukan konstanta.
 * Perubahan perda menghasilkan **record baru**; yang lama diakhiri lewat
 * `POST /tax-rates/{id}/end`, dan barisnya tidak pernah dihapus (invariant
 * #2). Mengubah tarif di tempat akan mengubah pajak transaksi yang **sudah
 * terjadi**.
 */

export interface TarifPajak {
  id: string;
  outletId: string | null;
  name: string;
  type: string;
  /** String desimal pecahan, mis. `"0.1100"`. */
  rate: string;
  isInclusive: boolean;
  phase: string;
  channel: string;
  appliesTo: string;
  appliesToIds: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface FormPajak {
  nama: string;
  tipe: string;
  /** Yang DIKETIK merchant: persen. */
  persen: string;
  isInclusive: boolean;
  phase: string;
  channel: string;
  appliesTo: string;
  appliesToIds: string[];
  outletId: string;
}

interface MuatanPajak {
  id: string;
  name: string;
  type: string;
  rate: string;
  isInclusive: boolean;
  phase: string;
  channel: string;
  appliesTo: string;
  appliesToIds: string[];
  outletId: string | null;
}

export type HasilPajak =
  | { ok: true; muatan: MuatanPajak }
  | { ok: false; bidang: keyof FormPajak; pesan: string };

/** Harus sama persis dengan `VALID_*` di `payment/handlers/tax-rates.ts`. */
export const TIPE = ['pbjt', 'ppn', 'service_charge', 'none'] as const;
export const PHASE = ['subtotal', 'total'] as const;
export const CHANNEL = ['all', 'dine_in', 'takeaway'] as const;
export const APPLIES_TO = ['all_items', 'category', 'item'] as const;

/**
 * `"11"` → `"0.11"`, `"8.25"` → `"0.0825"`.
 *
 * ⛔ Geser koma dua tempat pada STRING. Tidak ada `/ 100` di berkas ini, dan
 * tidak boleh ada.
 *
 * Mengembalikan `null` bila bentuknya tidak sah.
 */
export function persenKeRate(persen: string): string | null {
  const bersih = String(persen ?? '').replace(',', '.').trim();
  if (!/^\d+(\.\d+)?$/.test(bersih)) return null;

  const [utuh, pecahan = ''] = bersih.split('.');

  // `numeric(6,4)` menyimpan EMPAT digit desimal pada pecahan. Menggeser dua
  // tempat berarti persen hanya punya dua.
  if (pecahan.length > 2) return null;

  // ⛔ Titik desimal digeser `pecahan.length + 2` dari KANAN, bukan dua.
  //
  // Versi pertama menempelkan dua nol ke digitnya LALU memotong dua dari
  // kanan — kedua langkah itu saling meniadakan, dan `"11"` menghasilkan
  // `"11.00"`: seribu seratus persen. Ditemukan test, bukan review.
  //
  // Yang benar: seluruh digit diperlakukan sebagai bilangan bulat, dan
  // membagi 100 berarti menambah dua ke eksponen desimalnya.
  const digit = (utuh + pecahan).replace(/^0+(?=\d)/, '');
  const geser = pecahan.length + 2;
  const berbantalan = digit.padStart(geser + 1, '0');

  const pemisah = berbantalan.length - geser;
  const kiri = berbantalan.slice(0, pemisah);
  const kanan = berbantalan.slice(pemisah);

  // Nol di ekor pecahan dibuang, tapi minimal dua digit dipertahankan supaya
  // bentuknya konsisten dengan cara merchant menuliskan persen.
  const kananRapi = kanan.replace(/0+$/, '').padEnd(2, '0');
  return `${kiri}.${kananRapi}`;
}

/** `"0.1100"` → `"11"`. Untuk ditampilkan, bukan untuk dikirim. */
export function rateKePersen(rate: string): string {
  const bersih = String(rate ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(bersih)) return bersih;

  const [utuh, pecahan = ''] = bersih.split('.');
  const digit = utuh + pecahan.padEnd(4, '0').slice(0, 4);
  const angka = digit.replace(/^0+(?=\d)/, '').padStart(3, '0');

  const pemisah = angka.length - 2;
  const kiri = angka.slice(0, pemisah).replace(/^0+(?=\d)/, '');
  const kanan = angka.slice(pemisah).replace(/0+$/, '');

  // Ditampilkan dengan koma — format Indonesia (`CLAUDE.md`).
  return kanan.length > 0 ? `${kiri},${kanan}` : kiri;
}

export function buatMuatanPajak(form: FormPajak, id: string): HasilPajak {
  const nama = String(form.nama ?? '').trim();
  if (nama.length === 0) {
    return { ok: false, bidang: 'nama', pesan: 'Nama tarif wajib diisi.' };
  }

  if (!(TIPE as readonly string[]).includes(form.tipe)) {
    return { ok: false, bidang: 'tipe', pesan: 'Pilih jenis pajak.' };
  }
  if (!(PHASE as readonly string[]).includes(form.phase)) {
    return { ok: false, bidang: 'phase', pesan: 'Pilih dasar perhitungan.' };
  }
  if (!(CHANNEL as readonly string[]).includes(form.channel)) {
    return { ok: false, bidang: 'channel', pesan: 'Pilih kanal penjualan.' };
  }
  if (!(APPLIES_TO as readonly string[]).includes(form.appliesTo)) {
    return { ok: false, bidang: 'appliesTo', pesan: 'Pilih ruang lingkup penerapan.' };
  }

  const rate = persenKeRate(form.persen);
  if (rate === null) {
    return {
      ok: false,
      bidang: 'persen',
      pesan: 'Tarif harus angka persen, maksimal dua angka di belakang koma (mis. 11 atau 8,25).',
    };
  }

  // ⛔ Kedua arah ditegakkan, bukan hanya satu.
  //
  // `CLAUDE.md` mencatat cacat F3 yang persis di sini: tarif ber-scope
  // item/kategori TIDAK PERNAH BERLAKU karena `getVariationSnapshot` tidak
  // menyeleksi idnya — dua dari tiga tingkat FR-C6 mati tanpa satu pun error.
  // Yang menyembunyikannya: test hanya menguji PEMBUATAN tarif ber-scope,
  // bukan penerapannya.
  //
  // Layar yang membiarkan daftar kosong lolos menghasilkan tarif yang terlihat
  // ada dan tidak pernah menyentuh satu transaksi pun.
  const ids = [...new Set(form.appliesToIds ?? [])].filter((x) => x.length > 0);
  if (form.appliesTo === 'all_items' && ids.length > 0) {
    return {
      ok: false,
      bidang: 'appliesToIds',
      pesan: 'Tarif untuk semua produk tidak boleh menyebut kategori atau produk tertentu.',
    };
  }
  if (form.appliesTo !== 'all_items' && ids.length === 0) {
    return {
      ok: false,
      bidang: 'appliesToIds',
      pesan:
        form.appliesTo === 'category'
          ? 'Pilih minimal satu kategori. Tarif ber-lingkup kategori tanpa kategori tidak akan pernah berlaku.'
          : 'Pilih minimal satu produk. Tarif ber-lingkup produk tanpa produk tidak akan pernah berlaku.',
    };
  }

  const outlet = String(form.outletId ?? '').trim();

  return {
    ok: true,
    muatan: {
      id,
      name: nama,
      type: form.tipe,
      // ⛔ STRING, selalu. Lihat catatan kepala berkas.
      rate,
      isInclusive: form.isInclusive === true,
      phase: form.phase,
      channel: form.channel,
      appliesTo: form.appliesTo,
      appliesToIds: ids,
      // `null` = seluruh tenant. String kosong adalah FK ke outlet bernama
      // kosong, dan server menjawab 404.
      outletId: outlet.length > 0 ? outlet : null,
    },
    // ⛔ `effectiveFrom` sengaja TIDAK disertakan. Sama seperti B-10:
    // mengirimnya dari browser memperkenalkan jam ketiga, dan tarif yang
    // "belum berlaku" karena skew diam-diam tidak dipakai `TaxCalculator`.
  };
}

/**
 * Memisahkan tarif yang masih berlaku dari yang sudah diakhiri.
 *
 * Keduanya ditampilkan: `GET /tax-rates` mengembalikan keduanya, dan barisnya
 * tidak pernah dihapus (invariant #2) supaya pajak pada transaksi historis
 * tetap dapat dijelaskan.
 *
 * Urutan dimiliki di sini, bukan diwarisi dari `ORDER BY` server.
 */
export function pisahkanTarif(semua: readonly TarifPajak[]): {
  aktif: TarifPajak[];
  diakhiri: TarifPajak[];
} {
  const urut = (a: TarifPajak, b: TarifPajak) =>
    Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom) || b.id.localeCompare(a.id);

  return {
    aktif: semua.filter((t) => t.effectiveTo === null).sort(urut),
    diakhiri: semua.filter((t) => t.effectiveTo !== null).sort(urut),
  };
}
