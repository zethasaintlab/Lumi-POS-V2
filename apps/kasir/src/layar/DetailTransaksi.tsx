import { useEffect, useState } from 'react';
import { EmptyState } from 'ds';
import { bacaDetail, type DetailOrder } from '../riwayat/baca.ts';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { DialogPembatalan } from '../komponen/DialogPembatalan.tsx';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { useSesi } from '../konteks/useSesi.ts';
import { Tombol } from '../Tombol.tsx';
import { rencanaPembatalan } from '../kasir/pembatalan.ts';
import { navigasi } from '../rute/navigasi.ts';
import { BASIS } from '../rute/tabel.ts';

/* K-09 — Detail Transaksi (IA §2.2).

   ⛔ "Menampilkan RANTAI KOREKSI" (`IA:68`). Itu bukan hiasan: order asli
   tidak pernah di-UPDATE (invariant #2), jadi void dan refund adalah baris
   LAIN. Layar yang hanya menampilkan order-nya sendiri akan memperlihatkan
   transaksi yang terlihat utuh padahal uangnya sudah dikembalikan. */

function rupiah(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

const ALASAN: Record<string, string> = {
  barang_rusak: 'Barang rusak',
  pesanan_salah: 'Pesanan salah',
  pelanggan_tidak_puas: 'Pelanggan tidak puas',
  kelebihan_bayar: 'Kelebihan bayar',
  salah_input: 'Salah input',
  pelanggan_batal: 'Pelanggan batal',
  item_habis: 'Item habis',
  uji_coba: 'Uji coba',
  lainnya: 'Lainnya',
};

const METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS',
  qris_static: 'QRIS statis',
  card: 'Kartu (EDC)',
};

export function DetailTransaksi({ orderId }: { orderId: string }) {
  const { db } = useDbLokal();
  const { sesi } = useSesi();
  const [detail, setDetail] = useState<DetailOrder | null>(null);
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [siap, setSiap] = useState(false);
  const [membatalkan, setMembatalkan] = useState(false);
  const [muatUlang, setMuatUlang] = useState(0);

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const [d, k] = await Promise.all([bacaDetail(db, orderId), bacaKonfigPerangkat(db)]);
      if (!hidup) return;
      setDetail(d);
      setKonfig(k);
      if (hidup) setSiap(true);
    })();
    return () => {
      hidup = false;
    };
  }, [db, orderId, muatUlang]);

  if (!siap) return <EmptyState title="Membaca transaksi" body="Mengambil detail dari perangkat." />;

  if (!detail) {
    return (
      <div className="kasir-shift">
        <EmptyState
          title="Transaksi tidak ditemukan"
          body="Struk ini tidak ada di jendela riwayat perangkat ini."
        />
        <Tombol varian="primary" kritis onClick={() => navigasi(`${BASIS}/riwayat`)}>
          Kembali ke riwayat
        </Tombol>
      </div>
    );
  }

  const { order, baris, pembayaran, refund, sisaDapatDirefund } = detail;

  return (
    <div className="kasir-grid-panel">
      <h1 className="t-title num">{order.receiptNumber}</h1>
      <p className="t-caption kasir-login-sub">
        {order.businessDate} · oleh {order.createdBy}
      </p>

      {/* Rantai koreksi, di ATAS angka. Kasir yang melihat total dulu lalu
          catatan pembatalan di bawah sudah terlanjur menyebut angkanya. */}
      {order.membatalkan && (
        <p className="t-body-md kasir-login-galat" role="status">
          Transaksi ini membatalkan struk lain.{' '}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigasi(`${BASIS}/riwayat/${order.membatalkan}`)}
          >
            Lihat yang dibatalkan
          </button>
        </p>
      )}

      <ul className="kasir-baris-daftar">
        {baris.map((b) => (
          <li key={b.id} className="kasir-baris">
            <div className="grow">
              <span className="t-body-md">
                {b.itemName}
                {b.variationName !== 'Regular' ? ` · ${b.variationName}` : ''}
              </span>
              {b.modifier.length > 0 && (
                <span className="t-caption kasir-login-sub"> {b.modifier.join(', ')}</span>
              )}
            </div>
            <span className="t-caption num">{b.quantityMilli / 1000}×</span>
            <span className="t-body-md num">{rupiah(b.lineTotal)}</span>
          </li>
        ))}
      </ul>

      <div className="kasir-subtotal">
        <span className="t-body-md">Pajak</span>
        <span className="t-body-md num">{rupiah(order.taxAmount)}</span>
      </div>
      {order.roundingAdjustment !== 0 && (
        <div className="kasir-subtotal">
          <span className="t-body-md">Pembulatan</span>
          <span className="t-body-md num">
            {order.roundingAdjustment > 0 ? '+' : '−'}
            {rupiah(Math.abs(order.roundingAdjustment))}
          </span>
        </div>
      )}
      <div className="kasir-subtotal">
        <span className="t-body-md">Total</span>
        <span className="t-title num">{rupiah(order.amountDue)}</span>
      </div>

      <h2 className="t-body-md">Pembayaran</h2>
      {pembayaran.length === 0 ? (
        <p className="t-caption kasir-login-sub">Belum ada pembayaran tercatat.</p>
      ) : (
        <ul className="kasir-baris-daftar">
          {pembayaran.map((p) => (
            <li key={p.id} className="kasir-baris">
              <span className="grow t-body-md">{METODE[p.metode] ?? p.metode}</span>
              {p.diterima !== null && (
                <span className="t-caption num">diterima {rupiah(p.diterima)}</span>
              )}
              {p.kembalian !== null && p.kembalian > 0 && (
                <span className="t-caption num">kembali {rupiah(p.kembalian)}</span>
              )}
              <span className="t-body-md num">{rupiah(p.jumlah)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Refund muncul HANYA bila ada — bagian kosong yang selalu tampil
          membuat kasir memindai lebih banyak untuk menemukan yang penting. */}
      {refund.length > 0 && (
        <>
          <h2 className="t-body-md kasir-login-galat">Pengembalian dana</h2>
          <ul className="kasir-baris-daftar">
            {refund.map((r) => (
              <li key={r.id} className="kasir-baris">
                <div className="grow">
                  <span className="t-body-md">{ALASAN[r.alasan] ?? r.alasan}</span>
                  {r.catatan && <span className="t-caption kasir-login-sub"> {r.catatan}</span>}
                </div>
                {r.disetujuiOleh && (
                  <span className="t-caption kasir-login-sub">disetujui {r.disetujuiOleh}</span>
                )}
                <span className="t-body-md num">− {rupiah(r.jumlah)}</span>
              </li>
            ))}
          </ul>
          <div className="kasir-subtotal">
            <span className="t-body-md">Sisa dapat dikembalikan</span>
            <span className="t-body-md num">{rupiah(sisaDapatDirefund)}</span>
          </div>
        </>
      )}

      {/* K-10. Muncul HANYA bila transaksi ini masih dapat dibatalkan —
          `decideCancellation` melempar untuk order yang sudah `voided` atau
          `refunded`, dan tombol yang pasti gagal lebih buruk daripada tombol
          yang tidak ada.

          ⛔ TIDAK menuntut shift terbuka. Order pembatal menyalin `shift_id`
          dari order yang dibatalkan (sama seperti server), jadi shift yang
          sedang berjalan tidak dipakai sama sekali — dan menuntutnya akan
          menghalangi pembatalan yang sah setelah kas ditutup. */}
      {dapatDibatalkan(order.status) && konfig && sesi && (
        <Tombol varian="danger" kritis onClick={() => setMembatalkan(true)}>
          {order.status === 'closed' ? 'Kembalikan dana' : 'Batalkan transaksi'}
        </Tombol>
      )}

      <Tombol varian="ghost" kritis onClick={() => navigasi(`${BASIS}/riwayat`)}>
        Kembali ke riwayat
      </Tombol>

      {membatalkan && konfig && sesi && (
        <DialogPembatalan
          orderId={order.id}
          statusOrder={order.status}
          sisaDapatDirefund={sisaDapatDirefund}
          konfig={konfig}
          sesi={sesi}
          onBatal={() => setMembatalkan(false)}
          onSelesai={() => {
            setMembatalkan(false);
            // Dibaca ULANG dari database, bukan ditambal di memori: rantai
            // koreksi lahir dari baris-baris baru, dan menyusunnya di klien
            // berarti dua sumber kebenaran untuk satu layar.
            setMuatUlang((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/** `decideCancellation` melempar untuk status yang tidak mengizinkan keduanya. */
function dapatDibatalkan(status: string): boolean {
  try {
    rencanaPembatalan(status);
    return true;
  } catch {
    return false;
  }
}
