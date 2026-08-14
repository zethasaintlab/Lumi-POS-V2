import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from 'ds';
import { bacaRiwayat, cariRiwayat, type RingkasOrder } from '../riwayat/baca.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { Bidang } from '../Bidang.tsx';
import { navigasi } from '../rute/navigasi.ts';
import { BASIS } from '../rute/tabel.ts';

/* K-08 — Riwayat Transaksi (IA §2.2).

   "Dalam jendela riwayat lokal" (`IA:67`). Seluruhnya dari SQLite perangkat:
   riwayat yang menuntut jaringan tidak berguna justru saat kasir paling
   membutuhkannya — pelanggan yang kembali dengan struk saat internet mati. */

const BATAS = 100;

function rupiah(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function jam(iso: string): string {
  // Format Indonesia `14:32` (`CLAUDE.md`). Zona perangkat sudah zona outlet
  // di lapangan; menampilkan UTC di sini akan membuat kasir mencari struk
  // pada jam yang salah.
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* Status sinkronisasi per baris — teks, bukan hanya warna (aturan design
   system #5). Kasir yang melihat titik merah tanpa kata tidak tahu apakah
   penjualannya hilang atau hanya menunggu. */
const TEKS_SYNC: Record<string, string> = {
  ok: 'Terkirim',
  queued: 'Menunggu',
  failed: 'Gagal kirim',
};

export function Riwayat() {
  const { db } = useDbLokal();
  const [daftar, setDaftar] = useState<RingkasOrder[]>([]);
  const [siap, setSiap] = useState(false);
  const [kueri, setKueri] = useState('');

  useEffect(() => {
    let hidup = true;
    void bacaRiwayat(db, { batas: BATAS }).then((d) => {
      if (!hidup) return;
      setDaftar(d);
      setSiap(true);
    });
    return () => {
      hidup = false;
    };
  }, [db]);

  const terlihat = useMemo(() => cariRiwayat(daftar, kueri), [daftar, kueri]);

  if (!siap) return <EmptyState title="Membaca riwayat" body="Mengambil transaksi dari perangkat." />;

  if (daftar.length === 0) {
    return (
      <EmptyState
        title="Belum ada transaksi"
        body="Penjualan yang tersimpan di perangkat ini akan muncul di sini."
      />
    );
  }

  return (
    <div className="kasir-grid-panel">
      <Bidang label="Cari nomor struk" value={kueri} onChange={setKueri} placeholder="K1-20260813-0001" />

      {terlihat.length === 0 ? (
        <EmptyState title="Tidak ada struk yang cocok" body={`Tidak ada hasil untuk "${kueri}".`} />
      ) : (
        <ul className="kasir-baris-daftar">
          {terlihat.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="kasir-riwayat-baris"
                onClick={() => navigasi(`${BASIS}/riwayat/${o.id}`)}
              >
                <span className="t-body-md num">{o.receiptNumber}</span>
                <span className="t-caption">{jam(o.occurredAt)}</span>
                <span className="grow" />

                {/* ⛔ Penanda pembatalan datang dari RANTAI KOREKSI, bukan dari
                    `status`. Order yang sudah di-void tetap berstatus `open`
                    (`CLAUDE.md`), jadi tanpa ini kasir melihat transaksi yang
                    terlihat normal padahal sudah dibatalkan. */}
                {o.dibatalkan && <span className="t-caption kasir-login-galat">Dibatalkan</span>}
                {o.membatalkan && <span className="t-caption kasir-login-sub">Pembatalan</span>}

                <span className="t-body-md num">{rupiah(o.total)}</span>
                <span className={o.statusSync === 'failed' ? 't-caption kasir-login-galat' : 't-caption kasir-login-sub'}>
                  {TEKS_SYNC[o.statusSync]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
