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
 * ## ⛔ Kenapa `useState` + `useEffect`, bukan `getElementById` saat render
 *
 * Slotnya dirender oleh shell dalam commit yang SAMA dengan layar ini. Pada
 * render pertama ia belum ada di DOM, jadi pembacaan langsung saat render
 * mengembalikan `null` — dan `createPortal(anak, null)` melempar. Yang dibaca
 * saat render juga tidak pernah diperbarui saat slotnya muncul belakangan:
 * tombolnya hilang permanen tanpa satu pun error, bentuk cacat "nol baris,
 * bukan error" yang sama.
 *
 * Efek berjalan SESUDAH DOM terpasang, jadi di sanalah slotnya pasti ada.
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
