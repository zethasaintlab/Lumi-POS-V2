import type { Operasi } from '../../../packages/domain/src/rbac.ts';

/**
 * Peta rute → operasi RBAC. Satu tempat, bukan 30 pemanggilan yang tersebar.
 *
 * ## ⛔ Kenapa terpusat, bukan `assertBoleh` di tiap handler
 *
 * Audit menemukan **34 endpoint mutasi tanpa penjaga peran sama sekali**.
 * Matriksnya ada dan lengkap di `packages/domain/src/rbac.ts` sejak F3; yang
 * tidak ada adalah pemanggilannya.
 *
 * Menambalnya satu per satu memperbaiki ke-34 itu dan **tidak memperbaiki
 * yang ke-35** — endpoint yang ditambahkan bulan depan akan lahir tanpa
 * penjaga persis seperti ke-34 ini lahir. Itu pola yang sama dengan
 * `RUTE_TERBUKA` di `sesi.ts`: yang menahan bukan disiplin penulisnya,
 * melainkan daftar yang gagal-tertutup dan sebuah test yang menuntut setiap
 * rute mutasi punya entri.
 *
 * ## Kuncinya pola rute Fastify
 *
 * `POST /items/:itemId/archive`, bukan URL mentah. Sama seperti `RUTE_TERBUKA`.
 *
 * ## Yang TIDAK ada di sini
 *
 * - **Rute terbuka** (`RUTE_TERBUKA` di `sesi.ts`) — tidak punya sesi, jadi
 *   tidak punya peran untuk diperiksa. Jalur perangkat kasir termasuk di
 *   dalamnya, dan itu disengaja: relay tidak mengirim Bearer sama sekali.
 * - **Rute BACA** (GET). `spec-f:81` membatasi apa yang terlihat manajer
 *   outlet, tapi batas itu tentang OUTLET MANA, bukan tentang operasi — ia
 *   ditegakkan di lapisan query, bukan di sini. Dua pengecualian yang memang
 *   komersial punya entrinya sendiri.
 */

interface AturanRute {
  metode: string;
  pola: string;
  operasi: Operasi;
}

/**
 * ⛔ Setiap entri diturunkan dari `spec-f:38-53`, bukan ditebak:
 *
 *   `catalog_edit`   owner, area_manager
 *   `price_edit`     owner, area_manager
 *   `tax_settings`   owner
 *   `device_revoke`  owner, area_manager, outlet_manager
 *   `billing`        owner
 *   `outlet_manage`  owner
 *   `stock_adjust`   owner, area_manager, outlet_manager
 */
export const PETA_PERAN: readonly AturanRute[] = [
  // --- katalog -------------------------------------------------------------
  { metode: 'POST', pola: '/categories', operasi: 'catalog_edit' },
  { metode: 'PATCH', pola: '/categories/:categoryId', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/categories/:categoryId/archive', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/categories/:categoryId/restore', operasi: 'catalog_edit' },

  { metode: 'POST', pola: '/items', operasi: 'catalog_edit' },
  { metode: 'PATCH', pola: '/items/:itemId', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/items/:itemId/archive', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/items/:itemId/restore', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/items/:itemId/variations', operasi: 'catalog_edit' },
  { metode: 'PATCH', pola: '/items/:itemId/variations/:variationId', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/items/:itemId/variations/:variationId/archive', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/items/:itemId/variations/:variationId/restore', operasi: 'catalog_edit' },

  { metode: 'POST', pola: '/modifier-lists', operasi: 'catalog_edit' },
  { metode: 'PATCH', pola: '/modifier-lists/:modifierListId', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/modifier-lists/:modifierListId/archive', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/modifier-lists/:modifierListId/restore', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/modifier-lists/:modifierListId/modifiers', operasi: 'catalog_edit' },
  { metode: 'PATCH', pola: '/modifier-lists/:modifierListId/modifiers/:modifierId', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/modifier-lists/:modifierListId/modifiers/:modifierId/archive', operasi: 'catalog_edit' },
  { metode: 'POST', pola: '/modifier-lists/:modifierListId/modifiers/:modifierId/restore', operasi: 'catalog_edit' },

  { metode: 'POST', pola: '/items/:itemId/modifier-lists/:modifierListId', operasi: 'catalog_edit' },
  { metode: 'DELETE', pola: '/items/:itemId/modifier-lists/:modifierListId', operasi: 'catalog_edit' },

  // Impor adalah penyuntingan katalog dalam jumlah besar — peran yang sama.
  { metode: 'POST', pola: '/catalog/import', operasi: 'catalog_edit' },

  // --- harga ---------------------------------------------------------------
  //
  // ⛔ `price_edit`, BUKAN `catalog_edit`. `spec-f` memisahkan keduanya, dan
  // harga adalah yang langsung menentukan berapa pelanggan membayar.
  { metode: 'POST', pola: '/items/:itemId/variations/:variationId/prices', operasi: 'price_edit' },

  // --- pajak ---------------------------------------------------------------
  //
  // Owner saja (`spec-f:52`). Tarif pajak menentukan kewajiban fiskal
  // merchant; salah tarif adalah masalah hukum, bukan masalah data.
  { metode: 'POST', pola: '/tax-rates', operasi: 'tax_settings' },
  { metode: 'POST', pola: '/tax-rates/:taxRateId/end', operasi: 'tax_settings' },

  // --- perangkat -----------------------------------------------------------
  { metode: 'POST', pola: '/devices', operasi: 'device_revoke' },
  { metode: 'POST', pola: '/devices/:deviceId/credentials', operasi: 'device_revoke' },
  { metode: 'POST', pola: '/devices/:deviceId/revoke', operasi: 'device_revoke' },
  { metode: 'GET', pola: '/devices', operasi: 'device_revoke' },

  // --- inventori -----------------------------------------------------------
  //
  // `stock_adjust` — owner, manajer area, manajer outlet (`spec-f`). Kasir
  // tidak menyesuaikan stok: seluruh pengurangan yang boleh ia sebabkan lahir
  // dari penjualan, dan yang di luar itu adalah koreksi yang harus disetujui.
  { metode: 'POST', pola: '/inventory/movements', operasi: 'stock_adjust' },


  // Opname — seluruh siklus hidupnya tingkat manajer. `spec-e` FR-E7 menyebut
  // "Manajer menyetujui" untuk penyelesaian; memulai dan menghitung diberi
  // operasi yang sama karena hitungan fisik yang dapat disimpan siapa pun
  // membuat persetujuan di ujungnya tidak menjamin apa-apa.
  { metode: 'POST', pola: '/inventory/stocktakes', operasi: 'stock_adjust' },
  { metode: 'PUT', pola: '/inventory/stocktakes/:stocktakeId/lines', operasi: 'stock_adjust' },
  { metode: 'POST', pola: '/inventory/stocktakes/:stocktakeId/complete', operasi: 'stock_adjust' },

  // ⛔ Pembersihan keranjang terbengkalai ada di sini, bukan di `void_refund`,
  // karena EFEKNYA adalah membebaskan stok — dan `void_refund` mencakup kasir,
  // yang tidak boleh menjalankan pembersihan massal lintas outlet.
  { metode: 'POST', pola: '/orders/cleanup-abandoned', operasi: 'stock_adjust' },

  // --- outlet & komersial --------------------------------------------------
  { metode: 'POST', pola: '/outlets', operasi: 'outlet_manage' },
  { metode: 'GET', pola: '/tenants/usage', operasi: 'billing' },

  // FR-C12 — kategori merchant. `billing` karena ia klasifikasi KOMERSIAL
  // merchant di mata penyelenggara QRIS, dan karena angka turunannya adalah
  // yang merchant pakai untuk menjelaskan selisih uang yang masuk rekening.
  { metode: 'PATCH', pola: '/tenants/settings', operasi: 'billing' },

  // F5 — menaikkan paket. `spec-f:52` menandai "Billing & langganan" ✅ hanya
  // untuk Owner, dan di sini kata itu berarti uang sungguhan yang keluar dari
  // rekening merchant: manajer outlet yang dapat menaikkan paket dapat
  // menaikkan tagihan bulanan tanpa sepengetahuan pemiliknya.
  { metode: 'POST', pola: '/tenants/subscription/invoices', operasi: 'billing' },
  { metode: 'GET', pola: '/tenants/subscription/invoices', operasi: 'billing' },
  { metode: 'POST', pola: '/tenants/subscription/invoices/:invoiceId/check-status', operasi: 'billing' },
];

const PETA = new Map(PETA_PERAN.map((r) => [`${r.metode} ${r.pola}`, r.operasi]));

/**
 * Rute mutasi yang SENGAJA tidak punya aturan peran di sini, beserta
 * alasannya. Dipakai penjaga cakupan supaya daftar ini tidak dapat bertambah
 * diam-diam.
 *
 * ⛔ Yang berkaitan dengan pengguna tidak dijaga peta ini karena aturannya
 * BUKAN "peran X boleh operasi Y". `spec-f:50` menetapkan Manajer Outlet
 * hanya boleh mengelola **Kasir** — aturan yang bergantung pada peran TARGET,
 * bukan hanya peran aktor. Itu hidup di `bolehKelolaPengguna`
 * (`packages/domain/src/rbac.ts`) dan ditegakkan `assertBolehKelola` di
 * `handlers/users.ts`, dan memaksanya ke dalam peta ini akan MELONGGARKANNYA.
 */
export const DIKECUALIKAN: readonly { metode: string; pola: string; alasan: string }[] = [
  {
    metode: 'POST',
    pola: '/users',
    alasan: 'Dijaga `assertBolehKelola` — aturannya bergantung pada peran TARGET (spec-f:50)',
  },
  {
    metode: 'PATCH',
    pola: '/users/:userId',
    alasan: 'Idem; plus penjaga owner-terakhir (spec-f:425)',
  },
  {
    metode: 'PUT',
    pola: '/users/:userId/pin',
    alasan: 'Idem — PIN diatur oleh yang berhak mengelola pengguna itu',
  },
  {
    metode: 'PUT',
    pola: '/users/:userId/password',
    alasan: 'Idem. Password back-office diatur pengelola pengguna, bukan peran tersendiri',
  },
  {
    metode: 'POST',
    pola: '/users/:userId/pin-attempts',
    alasan: 'Dipanggil PERANGKAT saat PIN salah, bukan operasi administratif (FR-F4)',
  },
  {
    metode: 'POST',
    pola: '/shifts/:shiftId/close',
    alasan:
      'Aturannya BUKAN "peran X boleh operasi Y" melainkan "pemilik shift ATAU manajer". ' +
      'Peta ini hanya dapat menyatakan yang pertama, dan memakainya di sini akan menolak ' +
      'kasir yang menutup shiftnya SENDIRI — jalur normalnya. Dijaga di handler: ' +
      '`opened_by === aktor` atau `approve_cash_variance`',
  },
  {
    metode: 'POST',
    pola: '/shifts/:shiftId/no-sale',
    alasan:
      'FR-D7. Kasir BOLEH membuka laci — `IA:66` menandai K-16 "Kasir + alasan", dan ' +
      'menukar uang pecahan tidak dapat menunggu manajer. Peta ini hanya menyatakan ' +
      '"peran X boleh operasi Y", dan setiap entri di dalamnya diuji MENOLAK kasir; ' +
      'menaruh rute ini di sana akan menuntut test yang menyatakan kebalikan dari ' +
      'perilaku yang benar. Yang menjaganya: `assertBoleh(shift_open_close)` di handler ' +
      '(menutup akuntan, `spec-f:82`) plus AMBANG FREKUENSI — PIN manajer mulai ' +
      'pembukaan ke-4 dalam shift',
  },
  {
    metode: 'POST',
    pola: '/auth/logout',
    alasan:
      'Setiap pemegang sesi berhak MENGAKHIRI sesinya sendiri. Peran tidak relevan — ' +
      'dan menolak logout karena peran akan mengunci pengguna di sesi yang tidak dapat ia tutup',
  },
];

const PETA_KECUALI = new Set(DIKECUALIKAN.map((r) => `${r.metode} ${r.pola}`));

/** Operasi yang dibutuhkan rute ini, atau `null` bila tidak diatur peta ini. */
export function operasiUntuk(metode: string, pola: string | undefined): Operasi | null {
  if (pola === undefined) return null;
  const m = metode === 'HEAD' ? 'GET' : metode;
  return PETA.get(`${m} ${pola}`) ?? null;
}

export function dikecualikan(metode: string, pola: string): boolean {
  return PETA_KECUALI.has(`${metode} ${pola}`);
}
