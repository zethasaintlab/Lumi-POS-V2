/**
 * Aturan tampilan kuota untuk B-29 "Langganan & Batas". Murni: tanpa DOM,
 * tanpa React, tanpa jaringan.
 *
 * Dipisah dari komponennya supaya dapat diuji di `node --test` — pola yang
 * sama dengan `sesi-simpanan.ts`. Yang tersisa di komponen hanyalah JSX.
 *
 * ## ⛔ `batas: null` berarti TANPA BATAS, dan ia bukan kasus tepi
 *
 * Tier enterprise mengirim `null` di keempat dimensi. Setiap aritmetika yang
 * menyentuhnya diam-diam salah:
 *
 *   `terpakai / null` → `Infinity`   (bar progres meledak)
 *   `terpakai / 0`    → `Infinity`   (kalau `null` dikoersi lebih dulu)
 *   `terpakai > null` → `false`      (koersi ke 0; "12 dari 0" tidak penuh)
 *
 * Karena itu `null` dijawab SEBELUM satu operasi aritmetika pun berjalan, dan
 * ia menghasilkan status tersendiri — bukan persentase.
 */

import type { DimensiKuota } from '../../../../packages/domain/src/kuota.ts';

export interface PemakaianDimensi {
  terpakai: number;
  batas: number | null;
}

export interface Pemakaian {
  plan: string;
  status: string;
  /**
   * FR-C12 — kategori merchant menurut penggolongan penyelenggara QRIS.
   *
   * Opsional di tipe ini, dan sengaja: server versi N-1 tidak mengirimnya, dan
   * layar yang mati karena satu field tambahan tidak ada adalah layar yang
   * melanggar kompatibilitas klien N-1 (`Definition of Done`).
   */
  merchantCategory?: string;
  kuota: Record<string, PemakaianDimensi>;
}

/**
 * ⛔ Status TIDAK PERNAH warna saja (aturan design system #5). Setiap nilai di
 * sini punya `label` teks yang dirender berdampingan dengan warnanya.
 */
export type StatusKuota = 'tanpa-batas' | 'aman' | 'mendekati' | 'penuh' | 'terlampaui';

export interface BarisKuota {
  dimensi: DimensiKuota;
  /** Nama yang dibaca merchant, bukan nama kolom. */
  judul: string;
  terpakai: number;
  batas: number | null;
  status: StatusKuota;
  /** Teks status. Wajib — warna saja tidak pernah cukup. */
  label: string;
  /** 0–100, dibulatkan. `null` bila tanpa batas — bar progres tidak dirender. */
  persen: number | null;
  /** Tone design system untuk `Badge`. */
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

const JUDUL: Record<DimensiKuota, string> = {
  produk: 'Produk',
  outlet: 'Outlet',
  pengguna: 'Pengguna',
  device: 'Perangkat',
};

/**
 * Ambang peringatan.
 *
 * `research/09` § "Implikasi untuk IA": *"peringatan kuota mendekati batas
 * harus muncul di dashboard owner, bukan hanya saat operasi ditolak."*
 * Dokumen itu tidak menyebut angkanya, jadi 80% adalah `[ASUMSI]` — ditulis
 * di satu tempat supaya menggantinya satu edit.
 */
export const AMBANG_MENDEKATI = 0.8;

export function hitungBaris(dimensi: DimensiKuota, nilai: PemakaianDimensi): BarisKuota {
  const dasar = { dimensi, judul: JUDUL[dimensi], terpakai: nilai.terpakai, batas: nilai.batas };

  // ⛔ Dijawab SEBELUM aritmetika apa pun. Lihat komentar kepala berkas.
  if (nilai.batas === null) {
    return {
      ...dasar,
      status: 'tanpa-batas',
      label: 'Tanpa batas',
      persen: null,
      tone: 'neutral',
    };
  }

  // Batas nol adalah konfigurasi yang sah (paket yang tidak memuat dimensi
  // ini sama sekali). Membaginya menghasilkan `Infinity`; dijawab terpisah.
  if (nilai.batas === 0) {
    return {
      ...dasar,
      status: nilai.terpakai > 0 ? 'terlampaui' : 'penuh',
      label: nilai.terpakai > 0 ? 'Melebihi batas' : 'Tidak tersedia di paket ini',
      persen: 100,
      tone: 'danger',
    };
  }

  const rasio = nilai.terpakai / nilai.batas;
  // ⛔ Dijepit di 100. Merchant yang TURUN paket dapat berada di atas kuota
  // barunya, dan bar progres yang melewati wadahnya terbaca seperti kerusakan
  // tampilan — bukan seperti "kamu melebihi batas". Angka sebenarnya tetap
  // terbaca di `terpakai`/`batas`, dan statusnya menyebutnya.
  const persen = Math.min(100, Math.round(rasio * 100));

  if (nilai.terpakai > nilai.batas) {
    return { ...dasar, status: 'terlampaui', label: 'Melebihi batas', persen, tone: 'danger' };
  }
  if (nilai.terpakai === nilai.batas) {
    return { ...dasar, status: 'penuh', label: 'Penuh', persen, tone: 'danger' };
  }
  if (rasio >= AMBANG_MENDEKATI) {
    return { ...dasar, status: 'mendekati', label: 'Mendekati batas', persen, tone: 'warning' };
  }
  return { ...dasar, status: 'aman', label: 'Tersedia', persen, tone: 'success' };
}

/**
 * Urutan baris ditentukan `DIMENSI_KUOTA`, bukan urutan kunci dari server.
 *
 * ⛔ Ini yang mencegah LAYOUT SHIFT jenis kedua: `Object.keys` dari JSON
 * mengikuti urutan penulisan server, dan urutan itu dapat berubah tanpa ada
 * yang menganggapnya perubahan. Baris yang berpindah tempat setiap kali data
 * dimuat ulang adalah tabel yang tidak dapat dibaca.
 *
 * Dimensi yang tidak dikirim server DILEWATI, bukan dirender kosong —
 * menampilkan "0 dari 0" untuk sesuatu yang server tidak ketahui adalah
 * berbohong dengan percaya diri.
 */
export function susunBaris(
  pemakaian: Pemakaian,
  urutan: readonly DimensiKuota[]
): BarisKuota[] {
  const hasil: BarisKuota[] = [];
  for (const dimensi of urutan) {
    const nilai = pemakaian.kuota?.[dimensi];
    if (!nilai || typeof nilai.terpakai !== 'number') continue;
    hasil.push(hitungBaris(dimensi, nilai));
  }
  return hasil;
}

/** Label paket yang dibaca merchant. Nama teknisnya tidak pernah ditampilkan. */
export function labelPaket(plan: string): string {
  const peta: Record<string, string> = {
    free: 'Gratis',
    standard: 'Standar',
    pro: 'Pro',
    enterprise: 'Enterprise',
  };
  // ⛔ Paket tak dikenal ditampilkan APA ADANYA, bukan dijatuhkan ke "Gratis".
  // Menampilkan tier yang salah pada layar yang merchant pakai untuk
  // memutuskan pembayaran adalah kesalahan yang mahal.
  return peta[plan] ?? plan;
}

export function labelStatusTenant(status: string): string {
  const peta: Record<string, string> = {
    active: 'Aktif',
    suspended: 'Ditangguhkan',
    cancelled: 'Dibatalkan',
  };
  return peta[status] ?? status;
}
