# Audit `AppShell` terhadap aturan design system

**Tanggal:** 15 Agustus 2026 · **Pemicu:** back-office (B-29) memakainya sebagai kerangka utama — konsumen pertamanya sejak F0.

---

## ⛔ Batas kewenangan audit ini

`CLAUDE.md`: *"Aturan design system — `/ds-bundle` final, jangan diubah."*

`npm run lint:ds` menjalankan oxlint atas `apps packages` — **`ds-bundle` sengaja tidak dipindai**. Jadi temuan di bawah **tidak diperbaiki di komponennya**. Yang dilakukan adalah menghindari cabang kode yang melanggar, dari sisi konsumen.

Kalau kamu ingin salah satunya diperbaiki di sumbernya, itu keputusanmu — bukan kewenangan agent.

---

## Temuan

### 1. Fallback logo memanggang tiga nilai piksel — **dihindari**

`ds-bundle/components/navigation/AppShell.jsx:12`

```jsx
{brand?.logo || <span style={{ width: 28, height: 28, borderRadius: 8, ... }}>
```

Melanggar aturan #6: *"Semua styling lewat token; tidak ada nilai warna/ukuran hardcoded di komponen."*

Warnanya sudah token (`var(--accent)`, `var(--on-accent)`). Yang dipanggang adalah ukurannya. `28` bahkan bukan anak tangga skala spasi mana pun — skala itu berbasis 4px dengan anak tangga 4/8/12/16/24/32/48, dan `8` kebetulan sama dengan `--radius-control` tanpa merujuknya.

**Tindakan:** `apps/backoffice/src/App.tsx` selalu memberikan `brand.logo`, jadi cabang ini tidak pernah menyala. Penggantinya (`LogoLumi`) memakai `--space-8`, `--radius-control`, `--accent`, `--on-accent`, `--weight-bold` — nol angka bebas.

### 2. Nama merchant bawaan adalah nama merchant SUNGGUHAN — **dihindari**

`AppShell.jsx:13` — `{brand?.name || 'The Cafe by ORIGEN'}`

Bukan pelanggaran aturan design system, tapi tetap masalah: fallback yang terlihat seperti data asli tidak dapat dibedakan dari data asli. Merchant yang konfigurasinya gagal dimuat akan melihat nama kafe orang lain di sidebarnya sendiri.

**Tindakan:** `brand.name` selalu diberikan.

### 3. `.shell-link` `min-height: 40px` — **dilaporkan, tidak dihindari**

`ds-bundle/components.css:105`

Aturan #3: *"Target sentuh ≥ 44px; aksi menyangkut uang 56px."* Token `--touch-min: 44px` ada dan tidak dipakai di sini.

**Kenapa tidak dihindari:** ia di CSS design system, bukan di cabang yang dapat dimatikan konsumen. Menimpanya dari `apps/backoffice` berarti menulis nilai ukuran di aplikasi — yang melanggar aturan #6, aturan yang sama yang sedang dibela.

**Konteksnya meringankan, tapi tidak menghapus:** back-office adalah layar desktop bertetikus (`IA:§3`), dan aturan itu ditulis untuk kasir yang berdiri dengan satu tangan sering basah. Tetap saja teksnya tidak menyebut pengecualian.

**Keputusan ada padamu.** Pilihannya: (a) biarkan, dengan pengecualian tertulis di aturan design system; (b) naikkan ke `var(--touch-min)` di `ds-bundle/components.css` — satu baris, tapi menyentuh berkas yang dinyatakan final.

### 4. `.shell-group` memanggang `font-size: 11px` — **dilaporkan**

`ds-bundle/components.css:104`

Aturan #1: *"Tepat 4 ukuran teks: 32/20/15/12."* `11px` bukan salah satunya, dan tidak ada token untuknya (`--text-caption` = 12px).

Sama seperti temuan #3: di CSS, tidak dapat dihindari dari sisi konsumen, dan memperbaikinya berarti menyentuh `ds-bundle`.

### 5. ⛔ `.shell { height: 100% }` tidak punya jangkar — **ditemukan dengan menjalankannya**

`ds-bundle/components.css:100`

`base.css` design system tidak pernah memberi tinggi kepada `html`, `body`, maupun host aplikasi. `height: 100%` karena itu diselesaikan terhadap `body` yang tingginya mengikuti isi.

**Terukur di browser, viewport 1280×800:** `body`, `#root`, `.shell`, `.shell-side`, dan `.shell-main` semuanya **1442px** — seluruh halaman memanjang setinggi sidebar, dan `overflow-y: auto` pada `.shell-nav` tidak pernah menyala. Sidebar-lah yang mendorong halaman, bukan sebaliknya.

Ini yang paling penting dari seluruh audit, dan ia **tidak terlihat sama sekali dari membaca kode**: DOM-nya benar, typecheck bersih, nol error di konsol. `AppShell` tidak pernah dipakai siapa pun sejak F0, jadi tidak ada yang menabraknya.

**Tindakan:** `apps/backoffice/src/backoffice.css` memasang jangkarnya pada host (`html, body, #root { height: 100% }`). Bukan nilai desain — tidak ada warna, tidak ada ukuran dari skala spasi. Setelahnya: shell 1280×800, `pageScrolls: false`, `navScrolls: true`.

`apps/kasir/src/kasir.css` menyelesaikan hal yang sama dengan `height: 100vh` pada shell-nya sendiri — jadi kasir tidak pernah terpapar.

---

## Yang TIDAK melanggar — diperiksa dan bersih

| | |
|---|---|
| `<button className="shell-link" onClick=…>` | Bukan `<Button>` design system, jadi larangan props `onClick`/`disabled` tidak berlaku. Pola yang sama dipakai `SyncIndicator` dan `apps/kasir/src/Tombol.tsx` |
| Warna | Seluruhnya token: `--accent`, `--on-accent`, `--ink`, `--ink-muted`, `--ink-subtle`, `--surface*`, `--border` |
| Emoji / gambar / gradien | Nol |
| Dark mode | Tidak ada |
| Bahasa | Komponen netral bahasa; seluruh teks datang dari konsumen |
| Keadaan kosong | `EmptyState` tersedia dan dipakai — setiap menu yang belum ada isinya menampilkannya |

---

## Konsekuensi untuk B-29

Tidak ada yang memblokir. Temuan #1 dan #2 tertutup dari sisi konsumen; #3 dan #4 kosmetik dan menunggu keputusanmu.
