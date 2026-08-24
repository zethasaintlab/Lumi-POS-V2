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

  // --- ambang otorisasi (B-26) ----------------------------------------------
  //
  // ⛔ Owner dan Manajer Area saja, diturunkan dari `IA:205`. Manajer Outlet
  // SENGAJA di luar: ambang inilah yang memutuskan kapan persetujuan Manajer
  // Outlet dituntut, dan yang dapat menaikkannya dapat menghapus kebutuhan
  // atas persetujuannya sendiri — pemisahan tugas `spec-f:91` runtuh tanpa
  // satu pun aturan terlihat dilanggar.
  //
  // ⛔ MEMBACA (`GET`) sengaja tidak di sini. Kasir yang ditolak PIN-nya
  // berhak tahu ambang mana yang menolaknya, dan angkanya sudah turun ke
  // perangkat lewat jalur diskon. Yang dijaga adalah MENULISNYA.
  //
  // Handler-nya juga memanggil `assertBoleh` — dua lapisan, dan itu disengaja
  // di sini: peta ini menjaga rute, `assertBoleh` menjaga fungsinya kalau
  // kelak dipanggil dari jalur lain.
  { metode: 'PUT', pola: '/outlets/:outletId/thresholds', operasi: 'threshold_settings' },

  // --- akses support (F.5) --------------------------------------------------
  //
  // ⛔ MEMBERI dan MENGAKHIRI dijaga; MEMBACA daftarnya tidak.
  //
  // Setiap orang di merchant berhak tahu bahwa pihak kami sedang punya akses
  // ke datanya, dan kapan itu berakhir. `spec-f:401` menuntut banner "terlihat
  // di SELURUH layar" — banner yang hanya muncul untuk owner tidak memenuhi
  // kalimat itu, dan menyembunyikannya dari staf lain berarti orang yang
  // sedang bekerja di layar itu tidak tahu siapa lagi yang sedang melihatnya.
  { metode: 'POST', pola: '/support-sessions', operasi: 'support_grant' },
  { metode: 'POST', pola: '/support-sessions/:sessionId/end', operasi: 'support_grant' },

  // --- profil vertikal (B-24) -----------------------------------------------
  //
  // Owner saja (`IA:203`), operasi yang sama dengan membuat outlet: profil
  // vertikal menentukan perilaku SELURUH outlet yang mewarisinya, dan
  // `spec-f:30` menaruh "membuat/menghapus outlet" di kolom yang TIDAK BOLEH
  // milik Manajer Area.
  //
  // ⛔ `outlet_manage` dipakai ulang, BUKAN operasi baru: himpunan perannya
  // sama persis ({owner}) dan cakupannya sama — keduanya menentukan bentuk
  // jaringan outlet merchant. Operasi baru yang himpunannya identik hanya
  // menambah baris ke matriks yang spec tidak nyatakan.
  { metode: 'POST', pola: '/vertical-profiles', operasi: 'outlet_manage' },
  { metode: 'PATCH', pola: '/vertical-profiles/:profileId', operasi: 'outlet_manage' },
  { metode: 'PUT', pola: '/outlets/:outletId/vertical-profile', operasi: 'outlet_manage' },

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
    pola: '/shifts/:shiftId/cash-movements',
    alasan:
      'FR-D5. Alasan yang SAMA dengan no-sale, dan lebih kuat: kasir yang menerima ' +
      'kembalian dari bank atau owner yang mengambil uang untuk membayar pemasok tidak ' +
      'dapat menunggu manajer, dan di kafe kecil ia SATU-SATUNYA orang yang ada. Setiap ' +
      'entri di PETA_PERAN diuji MENOLAK kasir; menaruh rute ini di sana akan menuntut ' +
      'test yang menyatakan kebalikan dari perilaku yang benar. Yang menjaganya: ' +
      '`assertBoleh(shift_open_close)` di handler (menutup akuntan, `spec-f:82`) plus ' +
      'alasan daftar tertutup + audit untuk SETIAP baris — kontrol yang sama yang ' +
      'keputusan 1 Agustus 2026 tetapkan untuk void',
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
