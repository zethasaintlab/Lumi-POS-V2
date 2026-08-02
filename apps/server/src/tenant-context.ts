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
 * Placeholder for real auth (modul identity, F3). Reads X-Tenant-Id directly
 * from the request header -- NOT a security mechanism, RLS is. Every future
 * module reads tenantId this same way until identity replaces it with real
 * token/session extraction.
 */
export function getTenantId(req: FastifyRequest): string {
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
  return readIdHeader(req, 'x-actor-id', 'MISSING_ACTOR_ID', 'X-Actor-Id');
}
