import { useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, SegmentedControl } from 'ds';
import { Memuat } from '../komponen/Memuat.tsx';
import { Paginasi } from '../komponen/Paginasi.tsx';
import { potongHalaman, PER_HALAMAN_RIWAYAT } from '../komponen/halaman.ts';
import {
  bacaRiwayat,
  cariRiwayat,
  LABEL_URUTAN_RIWAYAT,
  urutkanRiwayat,
  type RingkasOrder,
  type UrutanRiwayat,
} from '../riwayat/baca.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { GagalBaca } from '../komponen/GagalBaca.tsx';
import { Bidang } from '../Bidang.tsx';
import { navigasi } from '../rute/navigasi.ts';
import { BASIS } from '../rute/tabel.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* K-08 — Riwayat Transaksi (IA §2.2).

   "Dalam jendela riwayat lokal" (`IA:67`). Seluruhnya dari SQLite perangkat:
   riwayat yang menuntut jaringan tidak berguna justru saat kasir paling
   membutuhkannya — pelanggan yang kembali dengan struk saat internet mati. */

const BATAS = 100;

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
  const [gagal, setGagal] = useState<string | null>(null);
  const [kueri, setKueri] = useState('');
  const [urutan, setUrutan] = useState<UrutanRiwayat>('terbaru');
  const [halamanKe, setHalamanKe] = useState(1);

  useEffect(() => {
    let hidup = true;
    /* ⛔ `catch` WAJIB, dan ketiadaannya bukan gaya. Tanpa ia, pembacaan yang
       menolak meninggalkan layar di "Membaca riwayat" selamanya — dan kasir
       yang mencari struk pelanggan yang sedang berdiri di depannya menunggu
       sesuatu yang tidak akan pernah datang. */
    void bacaRiwayat(db, { batas: BATAS }).then(
      (d) => {
        if (!hidup) return;
        setDaftar(d);
        setSiap(true);
      },
      (e: Error) => {
        if (!hidup) return;
        setGagal(e.message);
        setSiap(true);
      }
    );
    return () => {
      hidup = false;
    };
  }, [db]);

  const terlihat = useMemo(
    () => urutkanRiwayat(cariRiwayat(daftar, kueri), urutan),
    [daftar, kueri, urutan]
  );
  const halaman = potongHalaman(terlihat, halamanKe, PER_HALAMAN_RIWAYAT);

  /* ⛔ Kembali ke halaman 1 saat saringan atau urutan berubah.
     Tanpa ini, kasir di halaman 4 yang mengetik pencarian menyisakan 8 baris
     akan melihat daftar KOSONG — dan kosong di sana tidak dapat dibedakan dari
     "tidak ada struk yang cocok". `potongHalaman` men-clamp nomornya sebagai
     jaring kedua, tapi jaring kedua bukan pengganti yang pertama. */
  useEffect(() => {
    setHalamanKe(1);
  }, [kueri, urutan]);

  if (!siap) return <Memuat judul="Membaca riwayat penjualan perangkat ini…" bentuk="baris" jumlah={8} />;

  if (gagal) {
    return <GagalBaca akibat="Riwayat penjualan perangkat ini tidak dapat ditampilkan, dan struk lama tidak dapat dicetak ulang." pesan={gagal} />;
  }

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
      {/* Baris kontrol yang sama bentuknya dengan K-03: cari di kiri, urutan
          di kanan. Dua layar daftar yang kontrolnya diletakkan berbeda menuntut
          kasir belajar dua kali. */}
      <div className="kasir-kontrol-grid">
        <Bidang label="Cari nomor struk" value={kueri} onChange={setKueri} placeholder="K1-20260813-0001" />
        <div className="kasir-urutan">
          <span className="label">Urutkan</span>
          <SegmentedControl
            ariaLabel="Urutkan riwayat"
            value={urutan}
            onChange={(v: string) => setUrutan(v as UrutanRiwayat)}
            options={(Object.keys(LABEL_URUTAN_RIWAYAT) as UrutanRiwayat[]).map((u) => ({
              value: u,
              label: LABEL_URUTAN_RIWAYAT[u],
            }))}
          />
        </div>
      </div>

      {terlihat.length === 0 ? (
        <EmptyState title="Tidak ada struk yang cocok" body={`Tidak ada hasil untuk "${kueri}".`} />
      ) : (
        <ul className="kasir-baris-daftar">
          {halaman.baris.map((o) => (
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
                {/* ⛔ `<Badge>` bundle menggantikan `<span>` berwarna,
                    2 September 2026. Teks merah di antara teks abu-abu adalah
                    "status warna saja" dalam bentuk yang paling mudah luput:
                    katanya ada, tapi ia tidak terbaca sebagai LABEL — ia
                    terbaca sebagai kalimat yang kebetulan berwarna, dan pada
                    baris padat mata melewatinya.

                    Badge bundle memberi bentuk (pil bertepi) selain warna, dan
                    kontraknya sendiri menuntut teks. `tone` menyatakan artinya:
                    `danger` untuk order yang dibatalkan, `neutral` untuk order
                    yang MEMBATALKAN — yang kedua bukan kabar buruk, ia catatan
                    koreksi. */}
                {o.dibatalkan && <Badge tone="danger">Dibatalkan</Badge>}
                {o.membatalkan && <Badge tone="neutral">Pembatalan</Badge>}

                <span className="t-body-md num">{rupiah(o.total)}</span>
                {/* Status sinkronisasi: `warning` untuk gagal, bukan `danger`.
                    Penjualannya TERSIMPAN — yang belum terjadi adalah
                    pengirimannya, dan merah di sini terbaca seperti uang yang
                    hilang. `spec-h` memakai perbedaan itu. */}
                <Badge tone={o.statusSync === 'failed' ? 'warning' : 'neutral'}>
                  {TEKS_SYNC[o.statusSync]}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      {terlihat.length > 0 && <Paginasi halaman={halaman} onPindah={setHalamanKe} />}
    </div>
  );
}
