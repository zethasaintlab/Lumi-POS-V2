import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { catatPerubahanServer } from '../../audit/index.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
// ⛔ Aturan batasnya di DOMAIN, dipakai server DAN klien back-office. Server
// yang punya batas sendiri berarti klien mengompres ke angka yang berbeda dari
// yang server terima — dan merchant yang fotonya ditolak setelah menunggu
// kompresi tidak punya cara tahu berapa yang sebenarnya boleh.
import {
  BATAS_BASE64,
  BATAS_BYTE,
  byteDariBase64,
  checksumGambar,
  MIME_SIMPAN,
  periksaGambar,
  SISI_PIKSEL,
} from '../../../../../../packages/domain/src/gambar-produk.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Gambar produk — unggah, baca, hapus. Migrasi `0036`.
 *
 * ## ⛔ Server MEMVALIDASI, tidak MENGOLAH
 *
 * `CLAUDE.md` § Gambar produk: kompresi terjadi di klien back-office lewat
 * Canvas API. Alasannya dua, dan keduanya masih berlaku:
 *
 * - **nol dependensi native baru di server.** `sharp`/`imagemagick` menuntut
 *   binary per-platform, dan jalur build server ini tidak punya satu pun.
 * - **CPU-nya di mesin yang tidak melayani penjualan.** Server yang mengubah
 *   ukuran gambar saat merchant mengunggah katalog 500 produk adalah server
 *   yang lambat menjawab `POST /orders` selama itu.
 *
 * Yang server periksa: mime, ukuran byte, dan dimensi yang klien SEBUTKAN.
 *
 * ⛔ Konsekuensinya dinyatakan: klien yang berbohong tentang dimensi dapat
 * menyimpan gambar 40×40. Yang ia TIDAK dapat lakukan adalah membuatnya besar,
 * dan batas byte itulah yang melindungi anggaran unduhan armada.
 */

interface BarisGambar {
  id: string;
  mime: string;
  width: number;
  height: number;
  updated_at: string;
  byte: number;
  checksum: string;
}

/**
 * ⛔ `assertItemVisible` — FK PostgreSQL TIDAK tunduk RLS.
 *
 * Dikonfirmasi empat kali di repo ini pada empat FK berbeda di empat modul
 * berbeda (`CLAUDE.md` § Temuan F1). FK ke `item(id)` hanya membuktikan
 * barisnya ada di SUATU tenant, bukan tenant yang benar — jadi tanpa SELECT
 * yang tunduk RLS, merchant dapat memasang gambar pada produk merchant lain,
 * dan gambar itu akan TURUN ke armada mereka.
 */
async function assertItemVisible(client: PoolClient, itemId: string): Promise<void> {
  const { rows } = await client.query('SELECT 1 FROM item WHERE id = $1', [itemId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Item ${itemId} tidak ditemukan.`);
  }
}

/**
 * ⛔ Server MENYIMPAN TEKS base64-nya, tidak pernah men-decode-nya.
 *
 * Itu bukan kemalasan — itu seluruh maksud pencabutan `bytea` (2 September
 * 2026). Byte biner yang melintas jalur teks dengan salah membuat 15 byte
 * menjadi 4, tanpa satu pun error. Server yang men-decode lalu menyandikan
 * ulang menambahkan DUA titik tempat itu dapat terjadi, dan tidak membeli apa
 * pun: yang perangkat butuhkan adalah teksnya.
 *
 * Panjang byte dihitung dari panjang teksnya (`byteDariBase64`) — aritmetika,
 * bukan decode.
 *
 * ⛔ Base64, bukan `multipart/form-data`.
 *
 * Seluruh permukaan REST repo ini JSON ber-OpenAPI, dan validator AJV berdiri
 * di depan setiap rute. Satu endpoint multipart berarti satu jalur yang
 * melewati validator itu — dan jalur yang melewati validator adalah tempat
 * pemeriksaan berikutnya akan terlupa.
 *
 * Ongkosnya dinyatakan: base64 membengkak ~33%, jadi muatan HTTP untuk gambar
 * 32 KB adalah ~43 KB. Itu satu kali saat unggah, bukan per perangkat per
 * sinkronisasi — dan yang dibatasi anggaran armada adalah yang kedua.
 */
function bacaBase64(nilai: unknown): string {
  if (typeof nilai !== 'string' || nilai.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Field `data` wajib berisi base64 gambar.');
  }
  // ⛔ `base64` Node menerima masukan cacat DIAM-DIAM: karakter di luar alfabet
  // base64 dibuang, jadi string sampah menghasilkan Buffer pendek alih-alih
  // error. Buffer pendek itu lolos batas atas dengan mudah dan tersimpan
  // sebagai gambar yang tidak dapat dirender — kartu yang gagal muat, tanpa
  // satu pun error. Karena itu bentuknya diperiksa LEBIH DULU.
  return nilai;
}

export async function putItemImage(
  pool: Pool,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = getTenantId(req);
  const actorId = getActorId(req);
  const { itemId } = req.params as { itemId: string };
  const body = (req.body ?? {}) as { data?: unknown; width?: unknown; height?: unknown };

  const base64 = bacaBase64(body.data);
  const lebar = typeof body.width === 'number' ? body.width : undefined;
  const tinggi = typeof body.height === 'number' ? body.height : undefined;

  const periksa = periksaGambar({ mime: MIME_SIMPAN, base64, lebar, tinggi });
  if (!periksa.ok) {
    // ⛔ Kode galatnya DIBEDAKAN, bukan diseragamkan jadi VALIDATION_ERROR.
    // `TERLALU_BESAR` menuntut merchant memotong fotonya; `KOSONG` menuntut ia
    // mengulang unggahannya. Menyamakannya membuang satu-satunya sinyal yang
    // membedakan keduanya — pola yang sama dengan `POSSIBLE_CARD_NUMBER`.
    throw new HttpError(400, periksa.kode ?? 'VALIDATION_ERROR', periksa.pesan ?? 'Gambar ditolak.');
  }

  const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
    await assertItemVisible(client, itemId);

    const { rows: sebelum } = await client.query<BarisGambar>(
      `SELECT id, mime, width, height, updated_at, byte, checksum
         FROM item_image WHERE id = $1`,
      [itemId]
    );

    /* ⛔ UPSERT, bukan DELETE lalu INSERT.
       Yang kedua meninggalkan jendela — sekecil apa pun — tempat item ada
       tanpa gambar, dan jendela itu dapat tertangkap replikasi logis lalu
       terkirim ke armada sebagai penghapusan yang disusul penyisipan. Kartu
       yang berkedip kosong lalu terisi lagi adalah gejala yang tidak dapat
       dijelaskan siapa pun.

       Ini pengecualian yang DINYATAKAN terhadap invariant #2: gambar bukan
       transaksi dan bukan katalog — ia setelan tampilan, sejajar `peripheral`.
       Riwayat perubahannya ada di `audit_event`. */
    /* ⛔ `checksum` dan `byte` dihitung DI SINI, dari teks yang benar-benar
       akan disimpan — bukan diterima dari klien.

       Klien yang mengirim checksumnya sendiri membuat verifikasi perangkat
       memeriksa klaim klien terhadap dirinya sendiri: muatan yang rusak DI
       KLIEN akan datang dengan checksum yang cocok dengan kerusakannya, dan
       perangkat menyebutnya utuh. Yang harus dilindungi adalah perjalanan dari
       SINI ke perangkat, dan titik awalnya harus di sini. */
    await client.query(
      `INSERT INTO item_image (id, tenant_id, data_base64, byte, checksum,
                               mime, width, height, updated_at, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
       ON CONFLICT (id) DO UPDATE
              SET data_base64 = EXCLUDED.data_base64, byte = EXCLUDED.byte,
                  checksum = EXCLUDED.checksum, mime = EXCLUDED.mime,
                  width = EXCLUDED.width, height = EXCLUDED.height,
                  updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [
        itemId, tenantId, base64, byteDariBase64(base64), checksumGambar(base64),
        MIME_SIMPAN, lebar ?? SISI_PIKSEL, tinggi ?? SISI_PIKSEL, actorId,
      ]
    );

    /* ⛔ `item_updated`, BUKAN nama peristiwa baru.
       `spec-f:288` adalah kosakata TERTUTUP, dan `item_image_updated` tidak ada
       di dalamnya. Aturan yang sama sudah dipakai untuk arsip/pemulihan item:
       peristiwa yang sama, dibedakan `before`/`after`. Nama karangan membuat
       setiap laporan yang menyaring per jenis diam-diam melewatkannya.

       ⛔ `before`/`after` memuat METADATA, tidak pernah byte-nya. Audit
       bertahan lima tahun; menyalin gambar ke dalamnya menggandakan seluruh
       anggaran penyimpanan ke tabel yang tidak pernah dibaca untuk itu. */
    await catatPerubahanServer(client, {
      tenantId,
      actorUserId: actorId,
      eventType: 'item_updated',
      entityType: 'item_image',
      entityId: itemId,
      before: sebelum[0]
        ? { byte: Number(sebelum[0].byte), width: sebelum[0].width, height: sebelum[0].height }
        : { gambar: null },
      after: {
        byte: byteDariBase64(base64),
        width: lebar ?? SISI_PIKSEL,
        tinggi: tinggi ?? SISI_PIKSEL,
      },
    });

    return { baru: sebelum.length === 0 };
  });

  await reply.code(hasil.baru ? 201 : 200).send({
    itemId,
    byte: byteDariBase64(base64),
    batasByte: BATAS_BYTE,
    // Yang MELINTAS jaringan adalah teksnya; layar yang menghitung anggaran
    // dari `batasByte` saja akan melaporkan 25% lebih kecil dari kenyataan.
    batasBase64: BATAS_BASE64,
  });
}

export async function deleteItemImage(
  pool: Pool,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = getTenantId(req);
  const actorId = getActorId(req);
  const { itemId } = req.params as { itemId: string };

  await withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<BarisGambar>(
      `DELETE FROM item_image WHERE id = $1
         RETURNING id, mime, width, height, updated_at, byte, checksum`,
      [itemId]
    );
    /* ⛔ 404 saat tidak ada barisnya, bukan 204 diam-diam.
       Merchant yang menekan "Hapus gambar" dua kali harus tahu bahwa yang
       kedua tidak melakukan apa-apa; 204 untuk keduanya membuat "gambar masih
       ada" dan "gambar sudah hilang" terlihat sama. */
    if (rows.length === 0) {
      throw new HttpError(404, 'NOT_FOUND', 'Item ini tidak punya gambar.');
    }

    await catatPerubahanServer(client, {
      tenantId,
      actorUserId: actorId,
      eventType: 'item_updated',
      entityType: 'item_image',
      entityId: itemId,
      before: { byte: Number(rows[0].byte), width: rows[0].width, height: rows[0].height },
      after: { gambar: null },
    });
  });

  await reply.code(204).send();
}

/**
 * Metadata gambar untuk SATU tenant — dipakai layar katalog back-office.
 *
 * ⛔ Byte-nya TIDAK dikembalikan. Layar daftar hanya perlu tahu item mana yang
 * sudah punya gambar dan berapa besarnya; mengirim blob-nya berarti back-office
 * mengunduh seluruh katalog gambar setiap kali daftar produk dibuka.
 *
 * Gambar untuk DITAMPILKAN di back-office diambil satu per satu lewat
 * `GET /items/{itemId}/image`.
 */
export async function listItemImageMeta(
  pool: Pool,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = getTenantId(req);
  const baris = await withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<BarisGambar>(
      `SELECT id, mime, width, height, updated_at, byte, checksum
         FROM item_image ORDER BY id`
    );
    return rows;
  });

  await reply.send({
    gambar: baris.map((b) => ({
      itemId: b.id,
      byte: Number(b.byte),
      checksum: b.checksum,
      width: b.width,
      height: b.height,
      updatedAt: b.updated_at,
    })),
    batasByte: BATAS_BYTE,
  });
}

export async function getItemImage(
  pool: Pool,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = getTenantId(req);
  const { itemId } = req.params as { itemId: string };

  const baris = await withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ data_base64: string; mime: string }>(
      'SELECT data_base64, mime FROM item_image WHERE id = $1',
      [itemId]
    );
    return rows[0] ?? null;
  });

  if (!baris) throw new HttpError(404, 'NOT_FOUND', 'Item ini tidak punya gambar.');

  /* ⛔ `no-store`, bukan cache panjang.
     Gambar diganti di tempat dan URL-nya tidak berubah (PK `item_id`), jadi
     cache yang panjang menampilkan foto LAMA kepada merchant yang baru saja
     menggantinya — dan ia akan mengunggah ulang, mengira unggahannya gagal.
     Jalur yang benar-benar butuh cache adalah perangkat kasir, dan ia tidak
     memakai endpoint ini sama sekali: gambarnya turun lewat PowerSync. */
  /* ⛔ Decode terjadi HANYA di sini, di titik kirim ke browser back-office —
     satu-satunya pembaca yang membutuhkan byte mentah. Perangkat kasir tidak
     memakai endpoint ini sama sekali; gambarnya turun sebagai TEKS lewat
     PowerSync, dan itu yang membuat jalur perangkat bebas dari kelas kerusakan
     biner sepenuhnya. */
  await reply
    .header('content-type', baris.mime)
    .header('cache-control', 'no-store')
    .send(Buffer.from(baris.data_base64, 'base64'));
}

/** Sepola dengan `createItemHandlers` — pool di-inject di batas modul. */
export function createItemImageHandlers(pool: Pool) {
  return {
    putItemImage: (req: FastifyRequest, reply: FastifyReply) => putItemImage(pool, req, reply),
    deleteItemImage: (req: FastifyRequest, reply: FastifyReply) =>
      deleteItemImage(pool, req, reply),
    getItemImage: (req: FastifyRequest, reply: FastifyReply) => getItemImage(pool, req, reply),
    listItemImageMeta: (req: FastifyRequest, reply: FastifyReply) =>
      listItemImageMeta(pool, req, reply),
  };
}
