import { randomUUID } from 'node:crypto';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import { pratinjauImpor } from '../../../../../../packages/domain/src/impor-katalog.ts';
import { assertKuota } from '../../tenancy/index.ts';
import { hitungProduk } from './items.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * FR-A8 — impor katalog (`spec-a:252`).
 *
 * ## Satu operasi dengan `dryRun`, bukan dua endpoint
 *
 * Alur `spec-a:261` menuntut PRATINJAU sebelum impor dijalankan. Pratinjau
 * lewat endpoint terpisah dapat menyimpang dari yang benar-benar dijalankan —
 * merchant menyetujui satu hasil lalu menerima hasil lain. Satu jalur kode,
 * satu hasil.
 *
 * ⛔ `dryRun` BAWAANNYA `true`. Impor yang berjalan karena field lupa diisi
 * tidak dapat dibatalkan: katalog tidak pernah di-`DELETE` (invariant #2),
 * jadi produk yang salah masuk harus diarsipkan satu per satu.
 *
 * ## Baris bermasalah tidak menghentikan yang sah
 *
 * `spec-a:267` melarang impor DIAM-DIAM, bukan impor sebagian. Menolak seluruh
 * berkas karena satu baris membuat merchant dengan 5.000 produk tidak dapat
 * pindah sama sekali — dan migrasi katalog adalah biaya switching terbesarnya.
 */

interface BodyImpor {
  csv?: unknown;
  dryRun?: unknown;
  bilaSudahAda?: unknown;
}

export function createImportHandlers(pool: Pool) {
  return {
    async importCatalog(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = (req.body ?? {}) as BodyImpor;

      const csv = typeof body.csv === 'string' ? body.csv : '';
      // ⛔ Yang benar-benar menegakkan bawaan `true` adalah `default: true` di
      // OpenAPI — validator mengisinya SEBELUM handler ini berjalan, dan itu
      // sudah dibuktikan dengan mencetak nilai yang diterima.
      //
      // Baris di bawah adalah lapisan KEDUA, bukan yang pertama. Ia hanya
      // berlaku bila field datang tanpa melewati validator, dan hari ini itu
      // tidak terjadi. Yang menjaga bawaannya tetap ada adalah penjaga di
      // `tests/catalog/import.test.js` yang membaca kontrak OpenAPI langsung —
      // sabotase pada baris ini saja TIDAK menjatuhkan satu test pun, dan itu
      // ditemukan dengan mencobanya.
      const dryRun = body.dryRun !== false;
      const bilaSudahAda = body.bilaSudahAda === 'perbarui' ? 'perbarui' : 'lewati';

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);

        // ⛔ Keduanya dibaca lewat SELECT yang tunduk RLS. "Sudah ada di
        // katalog" berarti ada di katalog TENANT INI — nama yang sama di
        // merchant lain tidak boleh memblokir impor merchant ini.
        const { rows: itemAda } = await client.query<{ name: string }>(
          'SELECT name FROM item WHERE archived_at IS NULL'
        );
        const { rows: kategoriAda } = await client.query<{ id: string; name: string }>(
          'SELECT id, name FROM category WHERE archived_at IS NULL'
        );

        const hasil = pratinjauImpor(csv, {
          namaAda: itemAda.map((r) => r.name),
          kategoriAda: kategoriAda.map((r) => r.name),
          bilaSudahAda,
        });

        if (hasil.galatBerkas) {
          // Berkas yang tidak dapat dibaca SAMA SEKALI adalah permintaan yang
          // cacat — berbeda dari berkas yang sebagian barisnya bermasalah,
          // yang tetap 200 karena baris bermasalah adalah HASIL.
          throw new HttpError(400, 'IMPORT_FILE_INVALID', hasil.galatBerkas);
        }

        // ⛔ Titik penegakan kuota yang PALING MUDAH TERLEWAT, dan paling
        // penting. Impor menambah ribuan baris dalam satu request; kuota yang
        // hanya dipasang di `POST /items` akan dilewati sepenuhnya oleh jalur
        // yang justru dirancang untuk volume.
        //
        // Dinilai UTUH, bukan per baris: `(terpakai + jumlahBaris) <= kuota`.
        // Memeriksa satu-satu akan memasukkan 200 baris pertama lalu menolak
        // sisanya — impor parsial karena kuota, yang meninggalkan katalog
        // setengah jadi tanpa cara membatalkannya (katalog tidak pernah
        // di-DELETE, invariant #2).
        //
        // ⛔ Yang dihitung adalah SELURUH BARIS BERKAS, bukan hanya baris yang
        // akan benar-benar dibuat. Konsekuensinya nyata dan disengaja: berkas
        // 150 baris yang seluruhnya sudah ada di katalog tetap menghabiskan
        // 150 slot dalam penilaian ini, jadi unggah-ulang berkas yang sudah
        // diimpor dapat ditolak meski nol produk akan bertambah. Itu
        // bertabrakan dengan alur `spec-a:288` ("unduh baris gagal, perbaiki,
        // unggah ulang) dan dicatat sebagai keputusan yang menunggu, bukan
        // sebagai kelalaian.
        await assertKuota(
          client,
          tenantId,
          'produk',
          await hitungProduk(client),
          hasil.jumlahBaris
        );

        const ringkas = {
          dryRun,
          jumlahBaris: hasil.jumlahBaris,
          diimpor: hasil.valid.length,
          dilewati: hasil.dilewati.length,
          kategoriBaru: hasil.kategoriBaru,
          masalah: hasil.masalah,
        };

        if (dryRun) {
          reply.code(200);
          return ringkas;
        }

        // --- kategori baru -------------------------------------------------
        const idKategori = new Map<string, string>();
        for (const k of kategoriAda) idKategori.set(k.name.trim().toLowerCase(), k.id);

        for (const nama of hasil.kategoriBaru) {
          const id = randomUUID();
          await client.query(
            'INSERT INTO category (id, tenant_id, name) VALUES ($1, $2, $3)',
            [id, tenantId, nama]
          );
          idKategori.set(nama.trim().toLowerCase(), id);
        }

        // --- item + variation ----------------------------------------------
        for (const baris of hasil.valid) {
          const categoryId = baris.kategori
            ? (idKategori.get(baris.kategori.trim().toLowerCase()) ?? null)
            : null;

          if (baris.perbarui) {
            // `bilaSudahAda = 'perbarui'`. Yang diperbarui hanya kategorinya;
            // HARGA tidak disentuh, karena `item_variation.price` beku setelah
            // variation dibuat (keputusan katalog) dan perubahan harga wajib
            // lewat `price_history`. Mengubahnya di sini akan melanggar aturan
            // itu diam-diam, lewat jalur yang tidak menulis riwayat sama
            // sekali.
            await client.query('UPDATE item SET category_id = $1 WHERE name = $2', [
              categoryId,
              baris.nama,
            ]);
            continue;
          }

          const itemId = randomUUID();
          await client.query(
            'INSERT INTO item (id, tenant_id, name, category_id) VALUES ($1, $2, $3, $4)',
            [itemId, tenantId, baris.nama, categoryId]
          );
          // FR-A1: item TIDAK PERNAH ada tanpa variation, bahkan sesaat —
          // keduanya di transaksi yang sama.
          await client.query(
            `INSERT INTO item_variation (id, tenant_id, item_id, name, price)
             VALUES ($1, $2, $3, 'Regular', $4)`,
            [randomUUID(), tenantId, itemId, String(baris.harga)]
          );
        }

        // `spec-a:290`: impor dicatat di audit trail DENGAN JUMLAH BARIS.
        // Hanya untuk impor sungguhan — pratinjau bukan peristiwa, dan
        // mencatatnya membuat audit trail penuh baris yang tidak mengubah apa
        // pun sementara yang sungguhan tenggelam di antaranya.
        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          // Impor adalah operasi tingkat TENANT, bukan outlet: katalog dimiliki
          // tenant, dan produk yang diimpor berlaku di seluruh cabang.
          outletId: null,
          deviceId: null,
          actorUserId: actorId,
          // Tidak butuh persetujuan — impor bukan operasi yang membalik uang.
          approverUserId: null,
          eventType: 'catalog_imported',
          entityType: 'catalog',
          entityId: null,
          reasonCode: null,
          reasonNote: null,
          after: ringkas,
          // Impor terjadi di SERVER, jadi ia tidak punya HLC perangkat.
          // Nol adalah nilai yang jujur: ia tidak mengklaim urutan kausal
          // terhadap peristiwa perangkat mana pun.
          hlc: 0n,
        });

        reply.code(200);
        return ringkas;
      });
    },
  };
}
