# Database dan PostgreSQL — keputusan dan riwayat

Dipindah dari CLAUDE.md, 28 September 2026 (#76/#78).

## Temuan F1: FK PostgreSQL tidak tunduk RLS

Ditemukan empiris saat membangun modul Katalog, bukan dari dokumentasi: sebelum diperbaiki, `createItem` menerima dan **benar-benar menyimpan** item yang mereferensi `category` milik tenant lain, lalu mengembalikan `201`. Foreign key constraint PostgreSQL dicek dengan privilese owner tabel yang direferensikan — **tidak tunduk `FORCE ROW LEVEL SECURITY`**. Constraint FK hanya membuktikan baris itu ada di *suatu* tenant, bukan tenant yang benar.

**Konsekuensi:** setiap FK yang nilainya disuplai klien ke tabel ber-`tenant_id` wajib divalidasi lewat `SELECT` yang tunduk RLS sebelum dipercaya. Modul Katalog menegakkannya lewat `assertCategoryVisible` (`apps/server/src/modules/catalog/handlers/items.ts`), `fetchModifierListOrThrow` (`modifier-lists.ts`), kedua guard di `item-modifier-lists.ts`, dan `assertOutletVisible`/`assertUserVisible` di `prices.ts`. Modul B, C, dan E akan punya paparan yang sama (`order_line.variation_id`, `payment.order_id`, `stock_movement.variation_id`, dst) — cek ini di setiap FK klien-suplai baru.

**Dikonfirmasi ulang 2 Agustus 2026 di `price_history.outlet_id`,** lewat sabotase yang disengaja: `assertOutletVisible` dinonaktifkan, request yang menunjuk outlet tenant lain mengembalikan `201` dan barisnya benar-benar tersimpan. FK ke `outlet(id)` tidak menghentikannya. Ini bukan pengulangan bug yang sama — ini FK yang berbeda, di tabel yang berbeda, di modul yang berbeda. Polanya berulang setiap kali FK klien-suplai baru muncul.

**Dikonfirmasi keempat kalinya di `order.shift_id`** (Modul B): `assertShiftOpen` dinonaktifkan, dan satu order **utuh** — order + check + seluruh baris — tersimpan menunjuk shift milik tenant lain, `201`. Empat kali, empat FK berbeda, empat modul berbeda. Berhenti menganggap ini kejadian; ini sifat PostgreSQL. **Anggap setiap FK klien-suplai baru terpapar sampai kamu membuktikan sebaliknya lewat sabotase.**

**Bentuk kelima, ditemukan 7 Agustus 2026 saat membangun refund: guard yang tidak dapat DIBEDAKAN dari luar adalah guard yang tidak teruji.** Penyetuju refund divalidasi dua kali — sekali eksplisit di jalur refund, sekali lagi di dalam `recordAuditEvent`. Karena keduanya menjawab dengan status dan kode yang sama persis, guard pertama bisa **dimatikan sepenuhnya** tanpa satu test pun merah. Perbaikannya bukan menghapus salah satunya (`refund.approved_by` ditulis sebelum audit berjalan, dan kolom itu tanpa FK), melainkan memisahkan pesannya: `assertApproverVisible` dengan kode `APPROVER_NOT_FOUND`. Itu sekaligus menutup cacat yang lebih nyata — manajer yang penyetujuannya ditolak sebelumnya diberi tahu bahwa **kasir**-nya yang tidak ditemukan.

**Kasus yang lebih buruk: kolom tanpa FK sama sekali.** `price_history.changed_by` adalah `text NOT NULL` tanpa FK ke `"user"` — database tidak akan menangkap id karangan apa pun. Kolom audit finansial yang isinya tidak dijamin siapa-siapa lebih berbahaya daripada FK yang tidak tunduk RLS, karena tidak ada apa pun yang terlihat menjaganya. `assertUserVisible` adalah satu-satunya yang berdiri di sana.

**Batas temuan ini:** suite isolasi 189 test (invariant #8) menguji akses tabel langsung dan itu tetap benar dan hijau — RLS bekerja sesuai spesifikasi. Yang tidak diuji suite itu adalah kelas ini: aplikasi menulis ke tabelnya sendiri, dengan `tenant_id` sendiri, lewat RLS yang berjalan benar, sambil menunjuk baris tenant lain lewat FK. RLS tidak pernah dilanggar di sini — FK-lah pintunya.

### ⛔ Docker: daemon BISA menyala, tarik image DIBLOKIR

**Label: diukur 2 September 2026, belum diukur ulang.**

Diukur 2 September 2026, dan ini mengoreksi catatan lama yang menyatakan Docker
tidak tersedia — **klaim keadaan yang sudah basi**.

- `docker` ADA (29.3.1) dan `dockerd` **berhasil dinyalakan** lewat `sudo`.
- Tarik image **gagal**: `production.cloudfront.docker.com` menjawab
  **403 Forbidden** lewat proxy egress, juga sesudah daemon dikonfigurasi
  memakai proxy itu.

⛔ Konsekuensinya untuk stack PowerSync di `prototypes/05`: ia tetap **tidak
dapat dijalankan di sini**, tapi sebabnya berbeda dari yang tercatat
sebelumnya. Yang dibutuhkan bukan Docker — melainkan allowlist untuk registry
Docker, atau image yang sudah ditarik lebih dulu.

