import {
  PERAN_DIKENAL,
  CAKUPAN_TENANT,
  peranMelebihiCakupan,
  type Peran,
} from '../../../../packages/domain/src/rbac.ts';
import { detectWeakPin, isValidPinShape } from '../../../../packages/domain/src/pin.ts';

/**
 * B-27 — muatan `POST /users` dan pra-periksa PIN.
 *
 * Murni: form masuk → muatan keluar. Tanpa DOM, tanpa jaringan, tanpa
 * `randomUUID` — id diterima dari luar, sama seperti B-00b.
 *
 * ## ⛔ Cakupan peran diturunkan dari `spec-f:27-33`, bukan dikarang
 *
 * | Peran | Cakupan di spec | `user_role` yang ditulis |
 * |---|---|---|
 * | Owner | Tenant | satu baris, `scope_type = 'tenant'` |
 * | Akuntan | Tenant, read-only | satu baris, `scope_type = 'tenant'` |
 * | Manajer Area | **Beberapa** outlet | satu baris **per outlet** |
 * | Manajer Outlet | Satu outlet | satu baris outlet |
 * | Kasir | Satu outlet | satu baris outlet |
 *
 * Menulis scope tenant untuk Manajer Area akan memberinya hak di outlet yang
 * tidak pernah ditugaskan kepadanya; menulis scope outlet untuk Owner
 * menghasilkan baris yang terbaca lebih sempit daripada haknya. `user_role`
 * adalah tempat pertama yang dibaca orang saat menjawab "kenapa dia bisa".
 *
 * ## "Satu outlet" ditegakkan DI KEDUA SISI
 *
 * `POST /users` menolaknya dengan `400 ROLE_SCOPE_TOO_WIDE`, dan aturannya
 * fungsi yang SAMA — `peranMelebihiCakupan` di `packages/domain/src/rbac.ts`.
 *
 * Yang di sini karena itu bukan batas keamanan (batasnya di server) melainkan
 * penghapus perjalanan pulang-pergi: kesalahan yang dapat dilihat tanpa
 * bertanya tidak perlu ditanyakan. Yang penting keduanya tidak dapat
 * menyimpang — versi pertama berkas ini memegang salinan `SATU_OUTLET`
 * sendiri, dan salinan itulah yang akan tertinggal saat cakupan peran berubah.
 */

export interface FormPengguna {
  nama: string;
  email: string;
  peran: string;
  outletIds: string[];
  tanggalLahir: string;
}

export interface KonteksPengguna {
  tenantId: string;
  /** Di-generate klien, sekali per form (konvensi ID repo ini). */
  userId: string;
}

export interface BarisPeran {
  role: string;
  scopeType: 'tenant' | 'outlet';
  scopeId: string;
}

export interface MuatanPengguna {
  id: string;
  name: string;
  email: string | null;
  birthDate: string | null;
  roles: BarisPeran[];
  outletIds: string[];
}

export type HasilMuatanPengguna =
  | { ok: true; muatan: MuatanPengguna }
  | { ok: false; bidang: keyof FormPengguna; pesan: string };

export interface MuatanPeran {
  roles: BarisPeran[];
  outletIds: string[];
}

export type HasilMuatanPeran =
  | { ok: true; muatan: MuatanPeran }
  | { ok: false; bidang: keyof FormPengguna; pesan: string };

/**
 * Peran + outlet, aturannya sekali.
 *
 * ⛔ Diangkat keluar dari `buatMuatanPengguna` saat B-27 mendapat jalur UBAH
 * peran (24 Agustus 2026). Dua salinan aturan cakupan akan menyimpang tepat
 * pada kasus yang paling jarang dicoba — dan yang menyimpang menghasilkan form
 * tambah yang menolak apa yang form ubah terima, di layar yang sama.
 *
 * Aturannya sendiri tetap milik `packages/domain/src/rbac.ts`; yang di sini
 * adalah pemetaan peran → baris `user_role`, dan pesan untuk manusia.
 */
export function buatMuatanPeran(
  peran: string,
  outletDipilih: readonly string[],
  tenantId: string
): HasilMuatanPeran {
  if (!PERAN_DIKENAL.has(peran as Peran)) {
    // Peran karangan lolos sampai CHECK constraint di migrasi 0003, dan
    // jawabannya 500 — server menyalahkan dirinya sendiri atas isian layar.
    return { ok: false, bidang: 'peran', pesan: 'Pilih salah satu peran.' };
  }

  // Duplikat dibuang di sini, bukan diserahkan ke server. `POST /users`
  // memang mem-`Set`-kannya sendiri, tapi jumlah outlet yang dihitung penjaga
  // "satu outlet" di bawah harus jumlah yang sama.
  const outletIds = [...new Set(outletDipilih)].filter((o) => o.length > 0);

  if (outletIds.length === 0) {
    // ⛔ Jalur turun mereplikasi pengguna PER OUTLET. Tanpa keanggotaan,
    // kasirnya dibuat, PIN-nya disetel, dan namanya tidak pernah muncul di
    // layar login tablet — tanpa satu pun error di mana pun.
    return {
      ok: false,
      bidang: 'outletIds',
      pesan: 'Pilih minimal satu outlet. Tanpa outlet, pengguna ini tidak akan terlihat perangkat mana pun.',
    };
  }

  if (peranMelebihiCakupan([peran], outletIds.length)) {
    return {
      ok: false,
      bidang: 'outletIds',
      pesan: 'Peran ini bercakupan satu outlet. Pilih satu, atau pakai peran Manajer Area untuk beberapa outlet.',
    };
  }

  const roles: BarisPeran[] = CAKUPAN_TENANT.has(peran)
    ? [{ role: peran, scopeType: 'tenant', scopeId: tenantId }]
    : outletIds.map((outletId) => ({
        role: peran,
        scopeType: 'outlet' as const,
        scopeId: outletId,
      }));

  return { ok: true, muatan: { roles, outletIds } };
}

export function buatMuatanPengguna(
  form: FormPengguna,
  konteks: KonteksPengguna
): HasilMuatanPengguna {
  const nama = String(form.nama ?? '').trim();
  if (nama.length === 0) {
    return { ok: false, bidang: 'nama', pesan: 'Nama wajib diisi.' };
  }

  const peran = buatMuatanPeran(form.peran, form.outletIds ?? [], konteks.tenantId);
  if (!peran.ok) return peran;
  const { roles, outletIds } = peran.muatan;

  const email = String(form.email ?? '').trim();
  const lahir = String(form.tanggalLahir ?? '').trim();

  return {
    ok: true,
    muatan: {
      id: konteks.userId,
      name: nama,
      // ⛔ `null`, bukan string kosong. Kolomnya nullable, dan
      // `resolve_login_tenant` menyaring `email IS NOT NULL` — dua pengguna
      // ber-email '' akan bertabrakan di sana dan membuat resolusi tenant
      // mengembalikan NULL untuk orang yang tidak ada hubungannya.
      email: email.length > 0 ? email : null,
      birthDate: lahir.length > 0 ? lahir : null,
      roles,
      outletIds,
    },
  };
}

export type HasilPin = { ok: true } | { ok: false; pesan: string };

/**
 * Pra-periksa PIN, memakai aturan yang SAMA dengan server.
 *
 * ⛔ Kedua fungsinya dari `packages/domain` — `users.ts` memanggil yang persis
 * sama. Salinan di klien akan menyimpang, dan yang menyimpang di sini
 * menghasilkan layar yang berkata "PIN disetel" untuk PIN yang tidak pernah
 * tersimpan.
 *
 * Ia tidak menggantikan penegakan server; ia menghilangkan perjalanan
 * pulang-pergi untuk kesalahan yang dapat dilihat tanpa bertanya.
 */
export function periksaPinBaru(pin: string, opsi: { tanggalLahir?: string }): HasilPin {
  if (!isValidPinShape(pin)) {
    return { ok: false, pesan: 'PIN harus tepat 6 digit angka.' };
  }

  // Pesan datang dari domain dan menyebut POLA MANA (`spec-f:144`). Pesan
  // seragam membuat manajer yang ditolak tiga kali memilih PIN lemah keempat.
  const lemah = detectWeakPin(pin, { birthDate: opsi.tanggalLahir || undefined });
  if (lemah) return { ok: false, pesan: lemah.message };

  return { ok: true };
}
