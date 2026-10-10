import { useEffect, useState } from 'react';
import { EmptyState, Icon } from 'ds';
import { Memuat } from '../komponen/Memuat.tsx';
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
import { bacaRupiah, rupiah, rupiahTerlaluBesar } from '../../../../packages/domain/src/uang-tampilan.ts';
import { Bidang } from '../Bidang.tsx';

/* K-02 — Buka Shift (IA §2.2).

   "Wajib sebelum K-03; input saldo awal" (`IA:61`).

   ⛔ Seluruh layar ini berfungsi TANPA JARINGAN, dan itu bukan bonus:
   `spec-d:3` menyebutnya pembeda utama produk. Tidak ada satu pun `fetch` di
   sini — yang ditulis masuk ke SQLite lokal dan `outbox_local`, dan relay
   yang mengirimkannya kapan pun koneksi kembali. */

export function BukaShift() {
  const { db } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [aktif, setAktif] = useState<ShiftAktif | null>(null);
  const [siap, setSiap] = useState(false);
  const [saldoTeks, setSaldoTeks] = useState('');
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

  if (!siap) return <Memuat judul="Menyiapkan shift…" bentuk="blok" jumlah={3} />;

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

  /* ⛔ `bacaRupiah`, bukan `Number()` dan bukan `?? 0`. Kolom kosong BUKAN
     saldo Rp 0 — itu laci yang belum dihitung, dan shift bersaldo 0 yang
     lahir dari kolom kosong menjadikan semua selisih kas hari itu salah.
     Nol yang benar-benar DIKETIK tetap sah (laci kosong adalah keadaan nyata).
     Keputusan user 28 September 2026 (#76); pola `TutupKas.tsx`. */
  const saldo = bacaRupiah(saldoTeks);
  const saldoTidakSah = saldo === null;
  /* Tiga kabar berbeda: kosong · bentuk tidak sah · di atas batas aman. Yang
     terakhir TIDAK dijepit ke batas — nilai yang dibulatkan diam-diam adalah
     uang yang bukan milik kasir. */
  const alasanSaldo =
    saldoTeks.trim() === ''
      ? 'Isi saldo awal kas.'
      : rupiahTerlaluBesar(saldoTeks)
        ? 'Saldo awal terlalu besar.'
        : 'Masukkan rupiah utuh, tanpa desimal.';

  const simpan = () => {
    if (saldo === null) return;
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
      {/* Rebuild UI Fase 3.8 — KARTU dua kolom, mengikuti mockup (624 px,
          ikon + subjudul, "Mulai Shift" di kanan bawah). */}
      <div className="kasir-shift-kartu">
        <div className="kasir-shift-kepala">
          <span className="kasir-login-ikon" aria-hidden="true">
            <Icon name="clock" size={24} />
          </span>
          <div>
            <h1 className="t-title">Buka Shift</h1>
            <p className="t-body-md kasir-login-sub">Berapa uang di laci sekarang?</p>
          </div>
        </div>

        <div className="kasir-shift-kolom">
          <div className="kasir-dialog-sel">
            <Bidang
              label="Saldo awal kas"
              ukuran="lg"
              awalan="Rp"
              inputMode="numeric"
              value={saldoTeks}
              /* ⛔ Teks disimpan APA ADANYA, tanpa saringan: koma dan minus yang
                 dibuang diam-diam mengubah "25,5" menjadi 255 (10×) dan "-50000"
                 menjadi 50000. Yang menafsirkan atau menolak hanya `bacaRupiah`
                 (menerima `1.500.000`, `Rp 750.000`; menolak `25.5`, `25,5`, `abc`). */
              onChange={(v) => {
                setSaldoTeks(v);
                setGalat(null);
              }}
              placeholder="0"
            />
          </div>

          {/* Mockup menampilkan staf pembuka sebagai field. Di sini TEKS: ia
              diambil dari sesi, dan field yang dapat diubah akan mengundang
              shift dibuka atas nama orang lain. */}
          <dl className="kasir-dialog-sel">
            <div>
              <dt className="t-caption kasir-login-sub">Staf pembuka</dt>
              <dd className="t-body-md">{sesi?.nama ?? '—'}</dd>
            </div>
            <div>
              <dt className="t-caption kasir-login-sub">Tanggal bisnis</dt>
              <dd className="t-body-md">Dihitung dari zona outlet saat shift dibuka</dd>
            </div>
          </dl>
        </div>

        {/* Aturan design system #5: status tidak pernah warna saja. */}
        {galat && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galat}
          </p>
        )}

        {/* Kalimat ini ADA karena FR-D1 adalah janji produk yang harus terbaca
            kasir, bukan hanya benar di kode. Merchant yang tidak tahu bahwa ini
            berfungsi offline akan menelepon support saat internet mati. */}
        <div className="kasir-bayar-baris">
          <div>
            {saldoTidakSah && (
              <p id="bukashift-mulai-alasan" className="t-caption">
                {alasanSaldo}
              </p>
            )}
            <p className="t-caption kasir-login-sub">
              Shift tersimpan di perangkat ini dan terkirim sendiri saat internet kembali.
            </p>
          </div>
          {/* Satu aksi utama per layar (aturan #2), 56px karena menyangkut uang. */}
          <Tombol
            varian="primary"
            kritis
            disabled={menyimpan || saldoTidakSah}
            keterangan={saldoTidakSah ? 'bukashift-mulai-alasan' : undefined}
            onClick={simpan}
          >
            {menyimpan ? 'Menyimpan…' : 'Mulai Shift'}
          </Tombol>
        </div>
      </div>
    </div>
  );
}
