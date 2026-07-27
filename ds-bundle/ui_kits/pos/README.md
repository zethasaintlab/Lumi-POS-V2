# UI Kit — Lumi POS

Rekreasi hi-fi empat surface produk, satu codebase, tiga konteks fisik. Semua layar menyusun primitif dari design system (tidak mengimplementasi ulang Button/Card dsb).

Buka `index.html` untuk kit interaktif: navigasi antar-konteks lewat bar atas.

| Surface | Viewport acuan | Catatan |
|---|---|---|
| `KasirScreen.jsx` | Tablet counter 1024×768 | Layar terpadat. Katalog + keranjang kolom kanan; klik produk menambah ke keranjang, stepper mengubah qty. |
| `KdsScreen.jsx` | Monitor dapur 1920×1080 | Dalam `.kds-scale` (--scale 1.6). Tiga kolom status, tiket terlambat ditandai border+ikon, jam berjalan. |
| `TutupKasScreen.jsx` | Tablet & HP | Form bertahap: hitung fisik dulu, angka sistem menyusul. Panel selisih + ConfirmDialog PIN owner. |
| `LaporanScreen.jsx` | HP owner 390×844 | Mobile-first; panel anomali di atas, grafik & ranking di bawah. Desktop hanya melebar. |

Sumber rekreasi: `design-system/{kasir,kds,tutup-kas,laporan}.html` (folder yang diberikan user).
