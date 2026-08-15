import { bacaRupiah } from './produk.ts';

/**
 * B-10 — muatan harga dan ringkasan riwayat. Murni.
 *
 * ## ⛔ "Berlaku sekarang" MENGHILANGKAN `effectiveFrom`
 *
 * `createPrice` menulis `COALESCE($6, now())` — jam **PostgreSQL**. Kunci
 * `effectiveFrom` karena itu tidak boleh ada sama sekali saat merchant
 * memilih "berlaku sekarang". Bukan `null`, bukan string kosong: **tidak ada**.
 *
 * Mengirim `new Date().toISOString()` dari browser memperkenalkan **jam
 * ketiga**. `CLAUDE.md` mencatat pengukurannya: skew ±2 ms antara jam Node dan
 * jam PostgreSQL sudah cukup membuat harga yang baru ditulis dianggap belum
 * berlaku, dan resolusi diam-diam jatuh ke anak tangga di bawahnya — 4 dari 12
 * run test gagal karenanya. Jam browser merchant dapat meleset **menit**.
 *
 * Akibatnya bila dilanggar: merchant menaikkan harga, layar berkata tersimpan,
 * dan kasir tetap menagih harga lama. Tanpa satu pun error di mana pun.
 *
 * ## Harga terjadwal masa depan diizinkan
 *
 * `effective_from` boleh di masa depan; resolusi `effective_from <= at` yang
 * menentukan kapan ia berlaku. Baris terjadwal karena itu TIDAK boleh
 * ditampilkan seolah sedang berlaku.
 */

export interface FormHarga {
  harga: string;
  /** `''` berarti semua outlet (anak tangga kedua, `outlet_id IS NULL`). */
  outletId: string;
  berlaku: string;
  /** `YYYY-MM-DD`, hanya dipakai saat `berlaku === 'terjadwal'`. */
  tanggal: string;
  /** `HH:MM`, opsional. Kosong berarti tengah malam. */
  jam: string;
  alasan: string;
}

interface MuatanHarga {
  id: string;
  price: number;
  outletId: string | null;
  reason: string | null;
  /** ⛔ Ada HANYA saat merchant menjadwalkannya secara eksplisit. */
  effectiveFrom?: string;
}

export type HasilHarga =
  | { ok: true; muatan: MuatanHarga }
  | { ok: false; bidang: keyof FormHarga; pesan: string };

export function buatMuatanHarga(form: FormHarga, id: string): HasilHarga {
  const price = bacaRupiah(form.harga);
  if (price === null) {
    // Aturan rupiah dari `produk.ts`, bukan disalin. Ia sudah punya cacat yang
    // diperbaiki (`25.5` → 255); salinan kedua akan mengulanginya.
    return { ok: false, bidang: 'harga', pesan: 'Harga wajib diisi, dalam rupiah utuh.' };
  }

  const outlet = String(form.outletId ?? '').trim();
  const alasan = String(form.alasan ?? '').trim();

  const muatan: MuatanHarga = {
    id,
    price,
    // `null` = semua outlet. String kosong adalah FK ke outlet bernama kosong,
    // dan server menjawab 404 OUTLET_NOT_FOUND.
    outletId: outlet.length > 0 ? outlet : null,
    reason: alasan.length > 0 ? alasan : null,
  };

  if (form.berlaku !== 'terjadwal') {
    // ⛔ Berhenti di sini. Tidak ada cabang yang menambahkan `effectiveFrom`,
    // dan tidak ada nilai cadangan berbasis jam browser. Lihat catatan kepala.
    return { ok: true, muatan };
  }

  const tanggal = String(form.tanggal ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
    // ⛔ Ditolak, bukan jatuh ke "sekarang". Merchant yang bermaksud
    // menjadwalkan kenaikan pekan depan akan menaikkannya HARI INI, dan baru
    // mengetahuinya dari laporan.
    return { ok: false, bidang: 'tanggal', pesan: 'Isi tanggal berlaku (YYYY-MM-DD).' };
  }

  const jam = /^\d{2}:\d{2}$/.test(String(form.jam ?? '').trim()) ? form.jam.trim() : '00:00';

  // ⛔ Ditafsirkan di zona waktu PERANGKAT, bukan UTC. Merchant memilih jam
  // dindingnya, dan `new Date('2026-09-01T08:00')` (tanpa `Z`) memang itu.
  // Menambahkan `Z` akan menggeser jadwal sebesar offset zona — tujuh jam di
  // WIB, yang berarti harga naik sore hari alih-alih pagi.
  const waktu = new Date(`${tanggal}T${jam}`);
  if (Number.isNaN(waktu.getTime())) {
    return { ok: false, bidang: 'tanggal', pesan: 'Tanggal atau jam tidak dapat dibaca.' };
  }

  muatan.effectiveFrom = waktu.toISOString();
  return { ok: true, muatan };
}

/* ---------------------------------------------------------------- riwayat -- */

export interface BarisHarga {
  id: string;
  variationId: string;
  outletId: string | null;
  price: number;
  effectiveFrom: string;
  changedBy: string;
  reason: string | null;
}

export type StatusHarga = 'berlaku' | 'terjadwal' | 'lampau';

export interface BarisRingkas extends BarisHarga {
  status: StatusHarga;
}

/**
 * Menandai setiap baris riwayat: sedang berlaku, terjadwal, atau lampau.
 *
 * ⛔ **Ini PENAFSIRAN KLIEN, bukan kebenaran.** Ia dihitung dari jam yang
 * di-inject (di layar: jam browser). Yang otoritatif adalah
 * `GET .../price` — ia memakai jam DATABASE dan mengembalikan `source`, anak
 * tangga mana yang benar-benar dipakai. Layar menampilkan keduanya dan
 * menyatakan perbedaannya.
 *
 * ⛔ Scope OUTLET dan scope TENANT dihitung TERPISAH. Keduanya anak tangga
 * berbeda: harga outlet yang lebih lama tidak menjadi "lampau" hanya karena
 * ada harga tenant yang lebih baru — ia tetap yang berlaku di outletnya, dan
 * justru menimpa harga tenant itu.
 *
 * Urutan tampil dimiliki di sini, bukan diwarisi dari `ORDER BY` server —
 * jaminan yang hanya hidup di SQL tidak dapat diuji sama sekali.
 */
export function ringkasRiwayat(
  semua: readonly BarisHarga[],
  sekarang: number
): BarisRingkas[] {
  const urut = [...semua].sort((a, b) => {
    const selisih = Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom);
    // Tie-breaker `id DESC`, sama dengan server — dua baris ber-waktu identik
    // harus punya urutan yang tetap, bukan urutan yang berpindah tiap muat.
    return selisih !== 0 ? selisih : b.id.localeCompare(a.id);
  });

  const sudahBerlaku = new Set<string>();

  return urut.map((baris) => {
    const mulai = Date.parse(baris.effectiveFrom);
    if (Number.isNaN(mulai) || mulai > sekarang) {
      return { ...baris, status: 'terjadwal' as const };
    }

    // Karena `urut` menurun, yang pertama ditemui per scope adalah yang
    // terbaru — dan itu yang berlaku.
    const scope = baris.outletId ?? '__tenant__';
    if (!sudahBerlaku.has(scope)) {
      sudahBerlaku.add(scope);
      return { ...baris, status: 'berlaku' as const };
    }
    return { ...baris, status: 'lampau' as const };
  });
}
