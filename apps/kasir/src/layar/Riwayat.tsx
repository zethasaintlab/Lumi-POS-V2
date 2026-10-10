import { useEffect, useId, useMemo, useState } from 'react';
import { Badge, EmptyState, potongSentuh, SegmentedControl } from 'ds';
import { Memuat } from '../komponen/Memuat.tsx';
import { Paginasi } from '../komponen/Paginasi.tsx';
import { potongHalaman, PER_HALAMAN_RIWAYAT } from '../komponen/halaman.ts';
import {
  bacaRiwayat,
  cariRiwayat,
  labelMetodeRingkas,
  LABEL_URUTAN_RIWAYAT,
  saringRiwayat,
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
import { LABEL_METODE } from '../../../../packages/domain/src/metode-tampilan.ts';

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

/* `2026-08-31` → `31 Agu 2026`. Tanggal bisnis adalah tanggal KALENDER tanpa
   zona, jadi diformat di UTC; zona perangkat akan menggeser harinya. */
const FORMAT_TANGGAL = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function tanggalBisnisTampil(ymd: string): string {
  return FORMAT_TANGGAL.format(new Date(`${ymd}T00:00:00Z`));
}

export function Riwayat() {
  const idTanggal = useId();
  const { db } = useDbLokal();
  const [daftar, setDaftar] = useState<RingkasOrder[]>([]);
  const [siap, setSiap] = useState(false);
  const [gagal, setGagal] = useState<string | null>(null);
  const [kueri, setKueri] = useState('');
  const [urutan, setUrutan] = useState<UrutanRiwayat>('terbaru');
  const [tanggal, setTanggal] = useState('');
  const [metode, setMetode] = useState('');
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

  /* ⛔ "Nol baris, bukan error": layar hanya membaca `BATAS` transaksi terakhir.
     Jendela PENUH berarti mungkin ada yang lebih lama di luar jangkauan, jadi
     penyaring yang kosong TIDAK boleh terbaca "tidak ada penjualan". Layar
     menyatakan cakupannya (N dan tanggal bisnis tertua) dan kalimat kosong
     menyebut batas yang sama. Belum penuh = seluruh riwayat lokal terbaca. */
  const cakupan = useMemo(() => {
    if (daftar.length < BATAS) return null;
    const tertua = daftar.map((o) => o.businessDate).sort()[0]!;
    return { n: daftar.length, tertua: tanggalBisnisTampil(tertua) };
  }, [daftar]);

  const terlihat = useMemo(
    () =>
      urutkanRiwayat(
        cariRiwayat(saringRiwayat(daftar, { tanggalBisnis: tanggal, metode }), kueri),
        urutan
      ),
    [daftar, kueri, urutan, tanggal, metode]
  );
  const halaman = potongHalaman(terlihat, halamanKe, PER_HALAMAN_RIWAYAT);

  /* ⛔ Kembali ke halaman 1 saat saringan atau urutan berubah.
     Tanpa ini, kasir di halaman 4 yang mengetik pencarian menyisakan 8 baris
     akan melihat daftar KOSONG — dan kosong di sana tidak dapat dibedakan dari
     "tidak ada struk yang cocok". `potongHalaman` men-clamp nomornya sebagai
     jaring kedua, tapi jaring kedua bukan pengganti yang pertama. */
  useEffect(() => {
    setHalamanKe(1);
  }, [kueri, urutan, tanggal, metode]);

  if (!siap) return <Memuat judul="Membaca riwayat penjualan perangkat ini…" bentuk="baris" jumlah={8} />;

  if (gagal) {
    return <GagalBaca akibat="Riwayat penjualan perangkat ini tidak dapat ditampilkan, dan struk lama tidak dapat dicetak ulang." pesan={gagal} />;
  }

  /* Rebuild UI Fase 3.9 — judul halaman, mengikuti mockup. Ia tampil juga
     saat kosong: layar tanpa judul yang isinya satu kalimat terbaca seperti
     layar yang gagal memuat. */
  const kepala = (
    <header className="kasir-halaman-kepala">
      <h1 className="t-title">Riwayat transaksi</h1>
      <p className="t-body-md kasir-login-sub">Penjualan yang tersimpan di perangkat ini.</p>
    </header>
  );

  if (daftar.length === 0) {
    return (
      <div className="kasir-grid-panel">
        {kepala}
        <div className="card card-pad">
          <EmptyState
            title="Belum ada transaksi"
            body="Penjualan yang tersimpan di perangkat ini akan muncul di sini."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="kasir-grid-panel">
      {kepala}
      {/* Baris kontrol yang sama bentuknya dengan K-03: cari di kiri, urutan
          di kanan. Dua layar daftar yang kontrolnya diletakkan berbeda menuntut
          kasir belajar dua kali. */}
      <div className="kasir-kontrol-grid">
        <Bidang label="Cari nomor struk" value={kueri} onChange={setKueri} placeholder="K1-20260813-0001" />
        <div className="kasir-urutan">
          <label className="label" htmlFor={idTanggal}>Tanggal</label>
          {/* Tanggal BISNIS (`business_date`), bukan tanggal kalender perangkat.
              Tanggal di luar jendela riwayat lokal menghasilkan kalimat kosong —
              tidak ada transaksi yang dikarang. Kosong = semua tanggal. */}
          <input id={idTanggal} className="field" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </div>
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

      {/* Penyaring Metode bayar: opsinya KODE LAPORAN (`LABEL_METODE`) — "Transfer"
          opsi sendiri, tidak di bawah "Lainnya". Chip yang aktif diketuk lagi =
          semua metode; chip, bukan `<select>`, supaya semua opsi terlihat
          sekaligus dan kasir tidak membuka daftar untuk menyaring. */}
      <div className="kasir-saring" role="group" aria-label="Metode bayar">
        {Object.entries(LABEL_METODE).map(([kode, label]) => (
          <button
            key={kode}
            type="button"
            className="chip sentuh"
            style={potongSentuh(['kiri', 'kanan'], 'var(--space-2)')}
            aria-pressed={metode === kode}
            onClick={() => setMetode(metode === kode ? '' : kode)}
          >
            {label}
          </button>
        ))}
      </div>

      {cakupan && (
        <p className="t-caption kasir-login-sub" data-cakupan="jendela">
          Menampilkan {cakupan.n} transaksi terakhir di perangkat ini (mulai {cakupan.tertua}).
        </p>
      )}

      {/* Tabel dalam `.card` bundle (Fase 3.9, mengikuti mockup). Kolom
          Waktu PERTAMA; kepala kolom memakai grid yang sama dengan baris. */}
      <div className="card kasir-riwayat-kartu">
        {terlihat.length === 0 ? (
          <div className="card-pad">
            <EmptyState
              title="Tidak ada struk yang cocok"
              body={
                (kueri.trim() !== ''
                  ? `Tidak ada hasil untuk "${kueri}" dengan penyaring yang dipilih.`
                  : 'Tidak ada transaksi yang cocok dengan tanggal dan metode bayar yang dipilih.') +
                (cakupan ? ` Pencarian hanya mencakup ${cakupan.n} transaksi terakhir perangkat ini.` : '')
              }
            />
          </div>
        ) : (
          <>
            <div className="kasir-riwayat-kepala t-caption kasir-login-sub" aria-hidden="true">
              <span>Waktu</span>
              <span>Nomor struk</span>
              <span className="kasir-riwayat-angka">Item</span>
              <span>Metode</span>
              <span className="kasir-riwayat-angka">Total</span>
              <span>Status</span>
            </div>
            <ul className="kasir-baris-daftar kasir-riwayat-daftar">
              {halaman.baris.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="kasir-riwayat-baris"
                    onClick={() => navigasi(`${BASIS}/riwayat/${o.id}`)}
                  >
                    <span className="t-body-md num">{jam(o.occurredAt)}</span>
                    <span className="kasir-riwayat-nomor">
                      <span className="t-body-md num">{o.receiptNumber}</span>

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
                    </span>

                    <span className="t-body-md num kasir-riwayat-angka">{o.jumlahBaris}</span>
                    <span className="t-body-md">{labelMetodeRingkas(o.metode)}</span>
                    <span className="t-body-md num kasir-riwayat-angka">{rupiah(o.total)}</span>
                    {/* Status sinkronisasi: `warning` untuk gagal, bukan `danger`.
                        Penjualannya TERSIMPAN — yang belum terjadi adalah
                        pengirimannya, dan merah di sini terbaca seperti uang yang
                        hilang. `spec-h` memakai perbedaan itu. */}
                    <span>
                      <Badge tone={o.statusSync === 'failed' ? 'warning' : 'neutral'}>
                        {TEKS_SYNC[o.statusSync]}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {terlihat.length > 0 && <Paginasi halaman={halaman} onPindah={setHalamanKe} />}
    </div>
  );
}
