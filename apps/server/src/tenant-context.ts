import type { FastifyRequest } from 'fastify';
import { HttpError } from './http-error.ts';

const MAX_TENANT_ID_LENGTH = 64;

/**
 * Placeholder for real auth (modul identity, F3). Reads X-Tenant-Id directly
 * from the request header -- NOT a security mechanism, RLS is. Every future
 * module reads tenantId this same way until identity replaces it with real
 * token/session extraction.
 */
export function getTenantId(req: FastifyRequest): string {
  const header = req.headers['x-tenant-id'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length === 0 || value.length > MAX_TENANT_ID_LENGTH) {
    throw new HttpError(400, 'MISSING_TENANT_ID', 'Header X-Tenant-Id wajib diisi (1-64 karakter).');
  }
  return value;
}
