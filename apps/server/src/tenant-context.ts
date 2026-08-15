import type { FastifyRequest } from 'fastify';
import { HttpError } from './http-error.ts';

const MAX_ID_HEADER_LENGTH = 64;

/**
 * Membaca satu id dari header request. Fastify menormalkan header duplikat
 * jadi array, jadi nilai pertama yang dipakai -- bukan "a,b" yang akan
 * tersimpan sebagai id sampah.
 *
 * Ini BUKAN mekanisme keamanan. Yang menegakkan isolasi adalah RLS, dan
 * -- untuk id yang menunjuk baris lain -- SELECT yang tunduk RLS di dalam
 * transaksi. Header hanya menyatakan maksud klien.
 */
function readIdHeader(
  req: FastifyRequest,
  headerName: string,
  errorCode: string,
  label: string
): string {
  const header = req.headers[headerName];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length === 0 || value.length > MAX_ID_HEADER_LENGTH) {
    throw new HttpError(400, errorCode, `Header ${label} wajib diisi (1-${MAX_ID_HEADER_LENGTH} karakter).`);
  }
  return value;
}

/**
 * Tenant yang berlaku untuk permintaan ini.
 *
 * ⛔ **Sesi terverifikasi MENANG atas header, selalu.** Pada rute terlindungi
 * (`apps/server/src/sesi.ts`), `req.sesi` diisi dari baris `user_session`
 * yang hanya dapat ditemukan oleh pemegang token 256-bit — dan nilainya
 * dipakai apa adanya. `X-Tenant-Id` yang dikirim klien pada rute itu hanya
 * berperan sebagai petunjuk pencarian; ia TIDAK PERNAH menentukan hasilnya.
 *
 * Header dibaca hanya bila tidak ada sesi, dan itu tepat pada rute yang
 * memang tidak punya sesi: jalur perangkat kasir (relay outbox tidak mengirim
 * Bearer sama sekali — `spec-f:183` melarang kasir punya sesi back-office)
 * dan endpoint terbuka. Di sana yang menjaga isolasi tetap RLS + guard SELECT
 * lintas modul, persis seperti sebelumnya.
 */
export function getTenantId(req: FastifyRequest): string {
  if (req.sesi) return req.sesi.tenantId;
  return readIdHeader(req, 'x-tenant-id', 'MISSING_TENANT_ID', 'X-Tenant-Id');
}

/**
 * Aktor yang melakukan perubahan, untuk kolom audit seperti
 * `price_history.changed_by` (FR-A7: "changed_by selalu terisi").
 *
 * Sama seperti getTenantId, ini placeholder sampai modul identity ada --
 * keputusan Q1 di docs/superpowers/plans/PLAN-katalog-harga-riwayat.md.
 *
 * Fungsi ini hanya membuktikan header ADA dan berbentuk masuk akal. Bahwa
 * aktornya benar-benar user aktif di tenant ini adalah pertanyaan terpisah
 * yang HARUS dijawab lewat SELECT yang tunduk RLS di dalam transaksi -- lihat
 * assertUserVisible di modules/identity. Kolom changed_by tidak punya FK ke
 * "user", jadi database tidak akan menangkap id karangan; dan bahkan kalau
 * ada FK, temuan F1 di CLAUDE.md sudah membuktikan FK PostgreSQL tidak tunduk
 * RLS -- ia hanya membuktikan baris itu ada di SUATU tenant.
 */
export function getActorId(req: FastifyRequest): string {
  // ⛔ Sesi menang. Inilah yang mengubah `X-Actor-Id` dari klaim menjadi
  // bukti: pada rute terlindungi, aktor datang dari baris `user_session`, dan
  // memalsukannya menuntut memiliki tokennya. Header yang dikirim klien di
  // rute itu diabaikan sepenuhnya — bukan divalidasi lalu dipakai, melainkan
  // tidak pernah dibaca.
  if (req.sesi) return req.sesi.userId;
  return readIdHeader(req, 'x-actor-id', 'MISSING_ACTOR_ID', 'X-Actor-Id');
}

/**
 * Penyetuju operasi yang menuntut otorisasi manajer — refund selalu, dan
 * kelak diskon di atas ambang (FR-B8/B9).
 *
 * `spec-b-kasir-order.md:278` menandai refund sebagai "PIN manajer, **tidak
 * dapat diubah**". Sampai modul identity ada, penyetuju dibaca dari header
 * seperti `X-Actor-Id` — keputusan Q2 di
 * `docs/superpowers/plans/PLAN-void-refund-gateway.md`.
 *
 * Fungsi ini TIDAK memeriksa bahwa penyetuju berbeda dari aktor. Itu
 * ditegakkan `CHECK (approver_user_id IS NULL OR actor_user_id <>
 * approver_user_id)` di `audit_event` — database yang menjaganya, bukan
 * hanya aplikasi, jadi jalur mana pun yang lupa memeriksanya tetap gagal.
 *
 * Void **tidak** memakai ini: keputusan user 1 Agustus 2026 menetapkan void
 * berjalan tanpa PIN manajer, cukup alasan daftar tertutup + audit + restock.
 */
export function getApproverId(req: FastifyRequest): string {
  return readIdHeader(req, 'x-approver-id', 'MISSING_APPROVER_ID', 'X-Approver-Id');
}
