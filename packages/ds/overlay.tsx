import React from 'react';
import { Modal as ModalBundle } from '../../ds-bundle/components/overlays/Modal.jsx';
import { ConfirmDialog as ConfirmDialogBundle } from '../../ds-bundle/components/overlays/ConfirmDialog.jsx';

/**
 * Dialog `/ds-bundle`, DIBUNGKUS agar Escape menutupnya.
 *
 * ## ⛔ Kenapa pembungkus, bukan suntingan di bundle
 *
 * `ds-bundle/` adalah artefak vendor dan tidak pernah disunting di tempat
 * (keputusan user, 31 Agustus 2026). Suntingan di sana hilang tanpa jejak pada
 * pembaruan bundle berikutnya, dan yang hilang di sini adalah perbaikan
 * AKSESIBILITAS. Cacat yang kembali diam-diam adalah cacat yang paling mahal
 * ditemukan dua kali.
 *
 * ## ⛔ Cacat yang ditutupnya
 *
 * `Modal` dan `ConfirmDialog` bundle tidak punya penanganan Escape sama sekali.
 * Satu-satunya jalan keluar adalah menekan ✕ atau mengklik tepat di luar kotak
 * dialog. Diverifikasi di browser sebelum diperbaiki: Escape ditekan, dialog
 * tetap terbuka.
 *
 * Akibatnya bukan sekadar kurang nyaman. Sapuan audit UI pertama saya MACET di
 * layar ke-10 dari 26 karena dialog B-13 menutupi navigasi dan tidak dapat
 * ditutup dari keyboard — enam belas layar tidak pernah terperiksa, dan yang
 * menahannya adalah cacat ini.
 *
 * Escape adalah gerakan tutup yang universal. Dialog yang mengabaikannya tidak
 * terasa modal; ia terasa macet.
 */

interface PropsModal {
  open?: boolean;
  title?: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

/**
 * ⛔ Hook dipanggil TANPA SYARAT, di atas percabangan apa pun.
 *
 * Hook di belakang early return mengubah jumlah hook antar render, dan React
 * menjawabnya dengan membongkar seluruh pohon — persis cacat yang membuat
 * back-office menjadi halaman putih pada detik merchant menekan "Masuk"
 * (31 Agustus 2026). Yang menahan diri adalah ISI efeknya, bukan
 * pemanggilannya.
 */
function useEscape(open: boolean, onEscape?: () => void): void {
  React.useEffect(() => {
    if (!open || onEscape === undefined) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onEscape]);
}

export function Modal(props: PropsModal) {
  useEscape(props.open ?? true, props.onClose);
  return <ModalBundle {...props} />;
}

interface PropsConfirmDialog {
  open?: boolean;
  // WAJIB, mengikuti kontrak bundle: dialog aksi merusak tanpa judul tidak
  // menyatakan apa yang sedang dikonfirmasi.
  title: React.ReactNode;
  description?: React.ReactNode;
  detail?: React.ReactNode;
  pin?: string;
  onPin?: (nilai: string) => void;
  reason?: string;
  onReason?: (nilai: string) => void;
  note?: string;
  onNote?: (nilai: string) => void;
  reasons?: string[];
  pinError?: React.ReactNode;
  confirmLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog(props: PropsConfirmDialog) {
  /* ⛔ Escape memanggil `onCancel`, TIDAK PERNAH `onConfirm`.
     Dialog ini menjaga aksi merusak — void, refund, tutup kas. Tombol keluar
     darurat tidak boleh punya jalan menuju "ya". */
  useEscape(props.open ?? true, props.onCancel);
  return <ConfirmDialogBundle {...props} />;
}
