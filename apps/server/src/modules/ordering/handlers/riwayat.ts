import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertRentang } from './rentang.ts';
import {
  STATUS_TERLIHAT,
  ambilRiwayat,
  type Kursor,
  type StatusTerlihat,
} from './riwayat-data.ts';

/**
 * `GET /orders` — B-02 daftar transaksi.
 *
 * Handler tipis di atas `ambilRiwayat`. Seluruh aturan yang sulit — baris
 * pembatal, status turunan, keyset, pelucutan wildcard — hidup di sana beserta
 * testnya.
 *
 * ## Akses
 *
 * Sesi sah saja, tanpa operasi RBAC tambahan. Sejajar dengan keempat laporan
 * agregat: transaksi outletnya sendiri bukan rahasia dari orang yang bekerja
 * di sana. Yang menuntut operasi eksplisit hanya laporan exception, karena ia
 * menamai orang.
 */

const LIMIT_DEFAULT = 50;
const LIMIT_MAKS = 200;

/**
 * ⛔ Kursor dikirim sebagai SATU string buram, bukan tiga parameter.
 *
 * Klien tidak pernah menyusunnya sendiri — ia menyalin `cursorBerikut` dari
 * respons sebelumnya. Tiga parameter terpisah mengundang klien menebak
 * nilainya, dan kursor tebakan menghasilkan halaman yang melewatkan transaksi
 * tanpa satu pun error.
 *
 * Base64 di sini BUKAN keamanan — isinya tetap dapat dibaca siapa pun. Ia
 * penanda "ini bukan milikmu untuk disusun". Isinya tetap divalidasi seolah
 * datang dari penyerang.
 */
export function encodeKursor(k: Kursor): string {
  return Buffer.from(JSON.stringify(k), 'utf8').toString('base64url');
}

export function decodeKursor(teks: string): Kursor {
  let mentah: unknown;
  try {
    mentah = JSON.parse(Buffer.from(teks, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Parameter cursor tidak dapat dibaca.');
  }
  const k = mentah as Partial<Kursor>;
  if (
    typeof k?.businessDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(k.businessDate) ||
    typeof k.sequence !== 'number' ||
    !Number.isInteger(k.sequence) ||
    typeof k.id !== 'string' ||
    k.id.length === 0
  ) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Parameter cursor tidak berbentuk kursor.');
  }
  return { businessDate: k.businessDate, sequence: k.sequence, id: k.id };
}

function assertLimit(nilai: unknown): number {
  if (nilai === undefined || nilai === '') return LIMIT_DEFAULT;
  const n = Number(nilai);
  if (!Number.isInteger(n) || n < 1 || n > LIMIT_MAKS) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `Parameter limit harus bilangan bulat 1..${LIMIT_MAKS}.`
    );
  }
  return n;
}

/**
 * ⛔ Status tak dikenal DITOLAK, tidak diam-diam diabaikan.
 *
 * Mengabaikannya mengembalikan seluruh daftar untuk permintaan yang
 * penyaringnya salah ketik — dan layar menampilkannya seolah itu hasil
 * penyaringan. Jawaban yang lebih banyak daripada yang diminta lebih buruk
 * daripada error, karena tidak ada yang memeriksanya.
 */
function assertStatus(nilai: unknown): readonly StatusTerlihat[] | null {
  if (nilai === undefined || nilai === '') return null;
  if (typeof nilai !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Parameter status harus teks.');
  }
  // Dipisah koma — pilihan ganda di B-02. Satu nilai tetap sah.
  const daftar = nilai.split(',').map((s) => s.trim());
  const asing = daftar.filter((s) => !(STATUS_TERLIHAT as readonly string[]).includes(s));
  if (asing.length > 0) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `Parameter status harus salah satu dari: ${STATUS_TERLIHAT.join(', ')}.`
    );
  }
  // ⛔ Duplikat dibuang. `status=terjual,terjual` tidak berarti apa-apa, tapi
  // ia membengkakkan larik parameter tanpa batas dari luar.
  return [...new Set(daftar)] as StatusTerlihat[];
}

export function createRiwayatHandlers(pool: Pool): Record<string, unknown> {
  return {
    async listOrders(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as {
        from?: string;
        to?: string;
        outlet_id?: string;
        created_by?: string;
        receipt_number?: string;
        status?: string;
        limit?: string;
        cursor?: string;
      };

      const { from, to, outletId } = assertRentang(q);
      const limit = assertLimit(q.limit);
      const status = assertStatus(q.status);
      const cursor = q.cursor === undefined || q.cursor === '' ? null : decodeKursor(q.cursor);

      // Pencarian kosong diperlakukan sebagai TIDAK mencari. Klien mengirim
      // string kosong saat kotak pencariannya dikosongkan, dan mencari `%%`
      // hanya membuang kerja untuk hasil yang sama dengan tanpa penyaring.
      const receiptNumber =
        q.receipt_number === undefined || q.receipt_number.trim() === ''
          ? null
          : q.receipt_number.trim();

      const createdBy =
        q.created_by === undefined || q.created_by === '' ? null : q.created_by;

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);

        const { items, cursorBerikut } = await ambilRiwayat(client, {
          from,
          to,
          outletId,
          createdBy,
          receiptNumber,
          status,
          limit,
          cursor,
        });

        return {
          from,
          to,
          outletId,
          items,
          cursorBerikut: cursorBerikut === null ? null : encodeKursor(cursorBerikut),
        };
      });
    },
  };
}
