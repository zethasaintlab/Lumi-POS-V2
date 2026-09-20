import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SLOT_AKSI } from '../ShellKasir.tsx';

/**
 * Menempatkan aksi milik LAYAR ke slot yang SHELL sediakan di bilah nav.
 *
 * ## ⛔ Kenapa portal, bukan prop
 *
 * Layar adalah anak `ShellKasir` dan tidak dapat mengoper prop ke atas.
 * Memindahkan aksinya ke shell berarti memindahkan shift, konfig, sesi, dan
 * fitur ke sana juga — ke komponen yang dipakai enam layar yang tidak
 * memerlukan satu pun di antaranya.
 *
 * ## Kenapa `useState` + `useEffect`, bukan `getElementById` saat render
 *
 * ⛔ Bukan karena pembacaan saat render TERBUKTI gagal — itu dicoba, dan di
 * urutan mount aplikasi ini ia justru bekerja: shell merender slotnya sebelum
 * layar ini merender isinya, jadi `getElementById` menemukannya. Penjaga
 * `tests/kasir-dom/k03-chrome.test.js` tetap hijau dengan bentuk itu.
 *
 * Yang membuat bentuk efek tetap dipilih adalah bahwa ia tidak BERGANTUNG pada
 * urutan itu. Pembacaan saat render benar selama slot kebetulan sudah ada, dan
 * ia berhenti benar tanpa satu pun error pada hari urutannya berubah — shell
 * yang menunda bilah navnya, layar yang dipasang lebih dulu, atau `Suspense`
 * di antara keduanya. Efek berjalan sesudah DOM terpasang, jadi ia benar untuk
 * ketiga urutan itu.
 *
 * ## ⛔ Kenapa ia mengembalikan `null` diam-diam saat slot tidak ada
 *
 * Harness dan test dapat merender layar ini tanpa shell. Melempar di sana akan
 * membuat satu-satunya cara menguji layar kasir menuntut seluruh kerangka
 * aplikasi; mengembalikan `null` membuat layarnya tetap dapat dirender, dan
 * ketiadaan tombolnya terlihat langsung oleh mata yang menatap harness.
 */
export function PortalAksi({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSlot(document.getElementById(SLOT_AKSI));
  }, []);

  if (!slot) return null;
  return createPortal(children, slot);
}
