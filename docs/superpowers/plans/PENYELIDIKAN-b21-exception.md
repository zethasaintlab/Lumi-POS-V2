# Penyelidikan B-21 — Laporan Exception (FR-G5)

**Branch:** `g1-penyelidikan-b21-exception` · Tidak ada UI dibangun.

`CLAUDE.md`: keputusan 1 Agustus 2026 menghapus PIN manajer dari void, dan
konsekuensinya *"laporan exception FR-G5 naik jadi wajib"*. B-21 juga menjawab
pertanyaan yang B-18 sengaja tidak jawab: **siapa yang menekan tombol void**.

---

## 1. Apa yang SUDAH tercatat

### `audit_event` — tulang punggungnya

| Kolom | Untuk B-21 |
|---|---|
| `actor_user_id` **NOT NULL** | **Pelaku.** Ini yang B-18 sengaja tidak pakai |
| `approver_user_id` | Penyetuju refund; `CHECK` menjamin ia ≠ aktor |
| `event_type` | `order.voided`, `order.refunded` |
| `reason_code` / `reason_note` | Alasan, dari daftar tertutup |
| `outlet_id`, `device_id` | Penyaringan per outlet |
| `occurred_at` / `recorded_at` | Keduanya ada → X8 mungkin |
| `entity_id` | Order id → drill-down |

⛔ **`event_type` memakai TITIK, bukan garis bawah** — `order.voided`, bukan
`order_voided`. Grep dengan pola `[a-z_]*` melewatkan keduanya, dan
penyelidikan yang berhenti di situ akan menyimpulkan void tidak pernah diaudit.
Setiap penulis query B-21 harus tahu ini.

### Nilai uang: JOIN ke `order`, jangan baca `before`

`cancel.ts` menulis `before: { total: Number(asli.total) }` — **`Number()` atas
`bigint`**. Untuk order di atas 2⁵³ itu kehilangan presisi, dan nilainya sudah
terlanjur tersimpan begitu di jsonb.

Laporan karena itu **tidak boleh** mengambil nilai dari `before`/`after`. Ia
JOIN ke `"order"` lewat `entity_id`, tempat `total` masih `bigint` utuh.

> Cacat `Number()` di payload audit itu **tidak saya perbaiki** — ia mengubah
> bentuk data yang sudah tertulis, dan memutuskan apakah baris lama perlu
> di-backfill adalah keputusanmu.

---

## 2. Apa yang BELUM ada — dan kedelapan laporan tidak semuanya mungkin

| # | Laporan FR-G5 | Bisa dibangun? |
|---|---|---|
| **X1** Void & refund per kasir | ✅ penuh |
| **X2** Void mendekati/sesudah tutup shift | ✅ — `cash_drawer_shift.closed_at` ada |
| **X3** Refund bernilai tinggi | ✅ — `refund.amount`, `reason_code`, `approved_by` |
| **X4** Frekuensi no-sale | ❌ **tidak ada event maupun tabel `no_sale`** |
| **X5** Diskon manual per kasir | ❌ **tidak ada audit event untuk diskon** |
| **X6** Item berulang dibatalkan | ❌ penghapusan baris keranjang tidak pernah dicatat |
| **X7** Selisih kas per kasir | ✅ — `cash_drawer_shift` menyimpan hitungan vs seharusnya |
| **X8** Anomali waktu | ✅ — `occurred_at` vs `recorded_at` |

**Lima dari delapan dapat dibangun sekarang. Tiga tidak**, dan ketiganya butuh
penulisan data baru di jalur kasir — bukan sekadar query.

⛔ X4 dan X5 patut diperhatikan: keduanya disebut `CLAUDE.md` di ambang
otorisasi yang sudah kamu putuskan 1 Agustus (*"no-sale wajib alasan, PIN di
atas 3×/shift"* dan *"diskon >20% atau >Rp50.000"*). Aturannya sudah diputuskan;
yang belum ada adalah **pencatatannya**.

---

## 3. Rancangan `GET /reports/exceptions`

Satu endpoint, satu jenis per permintaan — pola yang sama dengan
`/reports/export`.

```
GET /reports/exceptions?type=void_refund&from&to&outlet_id
```

`type` untuk sekarang: `void_refund` (X1 + drill-down). Sisanya menyusul, dan
`type` sengaja **tanpa `enum` di OpenAPI** supaya handler yang menyebut pilihan
sah — pola yang sama dengan `price`, `rate`, dan `selectionType`.

### Bentuk respons

```jsonc
{
  "from": "2026-08-01", "to": "2026-08-31", "outletId": null,
  "type": "void_refund",
  // Ringkasan per aktor, TERURUT rasio menurun (AC: "pengurutan berdasarkan
  // tingkat anomali, bukan abjad atau waktu").
  "perAktor": [
    {
      "userId": "…", "name": "Sari",
      "jumlahVoid": 12, "nilaiVoid": "600000",
      "jumlahRefund": 3, "nilaiRefund": "150000",
      "jumlahTotal": 15,
      // ⛔ Rasio terhadap RATA-RATA seluruh aktor pada periode ini.
      // `spec-g`: "yang dicari bukan nilai absolut melainkan VARIASI".
      // String desimal — bukan float, dan bukan persen.
      "rasio": "4.0",
      "alasan": [{ "reasonCode": "salah_input", "jumlah": 9 }]
    }
  ],
  // Drill-down: setiap peristiwa, untuk baris yang diklik.
  "peristiwa": [
    {
      "auditId": "…", "occurredAt": "…", "recordedAt": "…",
      "jenis": "void",              // void | refund
      "aktorId": "…", "aktorNama": "Sari",
      "penyetujuId": null, "penyetujuNama": null,
      "orderId": "…", "receiptNumber": "K1-20260815-0007",
      "nilai": "50000",             // dari `order.total`, BUKAN dari jsonb
      "reasonCode": "salah_input", "reasonNote": null,
      "outletId": "…"
    }
  ]
}
```

### ⛔ Aturan yang mengikat, dan alasannya

1. **Nilai uang STRING**, dari `order.total` lewat JOIN — bukan dari
   `before`/`after` yang sudah melewati `Number()`.
2. **Tidak ada bahasa menuduh.** AC `spec-g` menyebutnya eksplisit. Tidak ada
   field `mencurigakan`, tidak ada `skorFraud`. Yang dikembalikan angka dan
   konteks; penilaian milik owner.
3. **Rasio adalah string desimal**, dihitung dari `bigint`, dengan satu angka
   di belakang koma. Float di sini tidak berbahaya secara uang, tapi ia satu-
   satunya angka yang akan diurutkan — dan urutan yang berpindah antar-muat
   adalah laporan yang tidak dapat dipercaya.
4. **Aktor void ≠ pemilik penjualan.** B-18 melekatkan `voidAmount` pada kasir
   yang penjualannya dibatalkan; B-21 melekatkannya pada **yang menekan
   tombol**. Keduanya benar untuk pertanyaan yang berbeda, dan keduanya harus
   ada — itu sebabnya B-18 sengaja tidak menjawab yang ini.
5. **Kasir tidak dapat membukanya** (AC `spec-g`). Operasi RBAC-nya
   `report_exception`: owner, area_manager, outlet_manager, accountant.

---

## 4. Yang sudah dibangun di branch ini

- `apps/server/src/modules/ordering/handlers/exceptions-data.ts` — helper SQL
  + agregasi, **tanpa endpoint**. Ia diuji langsung.
- `tests/server/exception-pelacakan.test.js` — membuktikan pelacakan pelaku
  akurat, termasuk kasus yang paling mudah salah: manajer yang membatalkan
  penjualan kasir lain.

Endpoint dan UI **belum** dibangun — menunggu keputusanmu atas §2 dan §3.
