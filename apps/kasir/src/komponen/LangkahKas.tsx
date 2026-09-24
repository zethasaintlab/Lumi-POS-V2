/* Penanda langkah K-12 — dua langkah, memetakan tahap yang sudah ada.

   ## ⛔ Kenapa ditulis sendiri, padahal aturannya "pakai komponen bundle dulu"

   Bundle TIDAK mengirim komponen ini. `_ds_manifest.json` memuat 21 komponen
   dan tidak satu pun di antaranya penanda langkah; `Stepper` yang ada di sana
   adalah pengatur KUANTITAS (− 2 +), bukan indikator progres.

   `StepBadge` yang mockup pakai hidup DI DALAM
   `ds-bundle/ui_kits/pos/TutupKasScreen.jsx` — berkas demo ui-kit, bukan
   komponen yang diekspor. Ia tidak dapat diimpor, dan `ds-bundle/` tidak
   pernah disunting.

   ⛔ Bentuknya disalin, NILAINYA tidak. Mockup memanggang `width: 24`,
   `height: 24`, dan `fontSize` sebagai angka; keduanya melanggar aturan design
   system #6. Versi ini token saja, dan stylingnya di `kasir.css` bukan di
   `style` inline.

   ## ⛔ Dua langkah, bukan tiga

   Tahap ketiga (`selesai` → K-13 Laporan Shift) sengaja TIDAK dihitung. Ia
   layar yang berbeda dengan judulnya sendiri, dan kas sudah tertutup saat ia
   muncul — penanda langkah yang masih terlihat di sana menjanjikan sesuatu
   yang masih dapat dikerjakan, padahal `CashDrawerShift` tidak dapat dibuka
   ulang setelah `CLOSED` (`PRD:522`).

   ## ⛔ Status dibawa TEKS, bukan warna saja

   Aturan design system #5. Langkah aktif membawa `aria-current="step"` dan
   kata "Langkah N dari 2" yang dapat dibaca pembaca layar; lingkaran teal
   hanya mengulang apa yang sudah tertulis. */

export interface Langkah {
  nomor: number;
  judul: string;
}

export function LangkahKas({ langkah, aktif }: { langkah: Langkah[]; aktif: number }) {
  return (
    <ol className="kasir-langkah" aria-label="Langkah tutup kas">
      {langkah.map((l) => {
        const selesai = l.nomor < aktif;
        const kini = l.nomor === aktif;
        return (
          <li
            key={l.nomor}
            className="kasir-langkah-item"
            data-keadaan={selesai ? 'selesai' : kini ? 'aktif' : 'nanti'}
            aria-current={kini ? 'step' : undefined}
          >
            {/* `aria-hidden`: nomornya sudah disebut kalimat di sebelahnya, dan
                angka yang terbaca dua kali membuat daftarnya lebih lambat
                didengar, bukan lebih jelas. */}
            <span className="kasir-langkah-nomor" aria-hidden="true">
              {l.nomor}
            </span>
            <span className="t-body-md">{l.judul}</span>
            {/* Teks yang menyatakan keadaannya, karena warna saja tidak sah. */}
            <span className="t-caption kasir-langkah-status">
              {selesai ? 'selesai' : kini ? `langkah ${l.nomor} dari ${langkah.length}` : 'berikutnya'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
