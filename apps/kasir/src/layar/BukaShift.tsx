import { useEffect, useState } from 'react';
import { EmptyState } from 'ds';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { bukaShift, shiftAktif, validasiSaldoAwal, type ShiftAktif } from '../kas/shift.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { GagalBaca } from '../komponen/GagalBaca.tsx';
import { muatHlc } from '../lokal/hlc.ts';
import type { Hlc } from '../../../../packages/domain/src/hlc.ts';
import { useSesi } from '../konteks/useSesi.ts';
import { Tombol } from '../Tombol.tsx';
import { navigasi } from '../rute/navigasi.ts';
import { BASIS } from '../rute/tabel.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* K-02 — Buka Shift (IA §2.2).

   "Wajib sebelum K-03; input saldo awal" (`IA:61`).

   ⛔ Seluruh layar ini berfungsi TANPA JARINGAN, dan itu bukan bonus:
   `spec-d:3` menyebutnya pembeda utama produk. Tidak ada satu pun `fetch` di
   sini — yang ditulis masuk ke SQLite lokal dan `outbox_local`, dan relay
   yang mengirimkannya kapan pun koneksi kembali. */

/* Pecahan yang benar-benar dipakai laci kafe Indonesia.

   Kasir mengetik saldo awal sekali per shift, dengan tangan yang sering
   sibuk; tombol pecahan menghilangkan lima ketukan dan seluruh peluang salah
   ketik nol. Angka bebas tetap mungkin lewat tombol hapus + pecahan lain. */
const PECAHAN = [50000, 100000, 200000, 500000];

export function BukaShift() {
  const { db } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [aktif, setAktif] = useState<ShiftAktif | null>(null);
  const [siap, setSiap] = useState(false);
  const [saldo, setSaldo] = useState(0);
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [hlc, setHlc] = useState<Hlc | null>(null);
  const [gagalMuat, setGagalMuat] = useState<string | null>(null);

  useEffect(() => {
    let hidup = true;
    void bacaKonfigPerangkat(db).then(async (k) => {
      if (!hidup) return;
      setKonfig(k);
      // Perangkat yang dimatikan di tengah shift harus kembali ke shift yang
      // SAMA, bukan diminta membuka lagi — yang akan ditolak, dan kasir
      // terjebak di layar yang tidak dapat dilewati.
      if (k) setAktif(await shiftAktif(db, k.deviceId));
      // HLC melanjutkan dari keadaan tersimpan — instance baru tiap boot akan
      // membuat movement modal awal ber-HLC lebih kecil daripada yang sudah
      // ada di perangkat ini.
      setHlc(await muatHlc(db, () => Date.now()));
      setSiap(true);
    }, (e) => {
      /* ⛔ Tanpa penanganan ini K-02 berhenti di penanda memuat selamanya, dan
         kasir tidak dapat membuka shift MAUPUN mengetahui kenapa — di layar
         pertama pagi hari, yang seluruh nilai jual produk ini bergantung
         padanya. */
      if (!hidup) return;
      setGagalMuat((e as Error).message);
      setSiap(true);
    });
    return () => {
      hidup = false;
    };
  }, [db]);

  if (!siap) return <EmptyState title="Menyiapkan shift" body="Membaca data perangkat." />;

  if (gagalMuat) {
    return <GagalBaca akibat="Shift tidak dapat dibuka di perangkat ini, jadi penjualan belum dapat dimulai." pesan={gagalMuat} />;
  }

  if (!konfig) {
    return (
      <EmptyState
        title="Perangkat belum terdaftar"
        body="Daftarkan perangkat ini lebih dulu di layar Perangkat & Uji Cetak."
      />
    );
  }

  if (aktif) {
    return (
      <div className="kasir-shift">
        <h1 className="t-title">Shift sudah berjalan</h1>
        <p className="t-body-md">
          Tanggal bisnis {aktif.businessDate} · saldo awal{' '}
          <span className="num">{rupiah(aktif.openingFloat)}</span>
        </p>
        <Tombol varian="primary" kritis onClick={() => navigasi(BASIS + '/')}>
          Lanjut ke kasir
        </Tombol>
      </div>
    );
  }

  const simpan = () => {
    const g = validasiSaldoAwal(saldo);
    if (g) {
      setGalat(g);
      return;
    }
    setMenyimpan(true);
    void bukaShift({
      db,
      konfig,
      sesi: sesi!,
      saldoAwal: saldo,
      waktu: () => new Date(),
      hlc: () => hlc!.tick(),
      idBaru: () => crypto.randomUUID(),
      idOutbox: () => crypto.randomUUID(),
    })
      .then((hasil) => {
        if (hasil.status === 'terbuka') {
          navigasi(BASIS + '/');
          return;
        }
        if (hasil.status === 'sudah_ada') {
          setAktif({ id: hasil.shiftId, businessDate: '', openingFloat: 0 });
          return;
        }
        setGalat(hasil.pesan);
      })
      .finally(() => setMenyimpan(false));
  };

  return (
    <div className="kasir-shift">
      <h1 className="t-title">Buka Shift</h1>
      <p className="t-body-md kasir-login-sub">Berapa uang di laci sekarang?</p>

      <p className="t-display num">{rupiah(saldo)}</p>

      <div className="kasir-pecahan">
        {PECAHAN.map((p) => (
          <Tombol
            key={p}
            kritis
            disabled={menyimpan}
            onClick={() => {
              setSaldo((s) => s + p);
              setGalat(null);
            }}
          >
            + {rupiah(p)}
          </Tombol>
        ))}
        <Tombol
          varian="ghost"
          kritis
          disabled={menyimpan || saldo === 0}
          onClick={() => {
            setSaldo(0);
            setGalat(null);
          }}
        >
          Hapus
        </Tombol>
      </div>

      {/* Aturan design system #5: status tidak pernah warna saja. */}
      {galat && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galat}
        </p>
      )}

      {/* Satu aksi utama per layar (aturan #2), 56px karena menyangkut uang. */}
      <Tombol varian="primary" kritis disabled={menyimpan} onClick={simpan}>
        {menyimpan ? 'Menyimpan…' : 'Mulai Shift'}
      </Tombol>

      {/* Kalimat ini ADA karena FR-D1 adalah janji produk yang harus terbaca
          kasir, bukan hanya benar di kode. Merchant yang tidak tahu bahwa ini
          berfungsi offline akan menelepon support saat internet mati. */}
      <p className="t-caption kasir-login-sub">
        Shift tersimpan di perangkat ini dan terkirim sendiri saat internet kembali.
      </p>
    </div>
  );
}
