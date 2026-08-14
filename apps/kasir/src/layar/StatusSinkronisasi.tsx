import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Table } from 'ds';
import {
  buatEksporDarurat,
  daftarGagal,
  formatUkuran,
  keadaanIndikator,
  PER_HALAMAN,
  pesanGagal,
  umurRelatif,
  type HalamanGagal,
} from '../../../../packages/sync-client/src/status.ts';
import type { BarisOutbox } from '../../../../packages/sync-client/src/ports.ts';
import { bacaKonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { Tombol } from '../Tombol.tsx';
import { sinkronisasiSekarang, useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { useAntrean } from '../konteks/useAntrean.ts';

/* K-14 Status Sinkronisasi (FR-H3, IA §2.2 dan §2.4).

   Layar baru yang belum ada di design system; ia memakai ulang Card, Badge,
   Table, dan EmptyState, sesuai `IA:111`. Tombolnya lewat `Tombol` -- lihat
   berkas itu untuk alasannya.

   Satu aksi utama per layar (aturan design system #2): "Coba kirim sekarang".
   Ekspor darurat SELALU tersedia -- `spec-h:256` menyebutnya jaring pengaman
   terakhir, dan jaring pengaman yang bisa dinonaktifkan bukan jaring
   pengaman. */

const KOSONG: HalamanGagal = { baris: [], total: 0 };

interface Penyimpanan {
  dipakai: number | null;
  kuota: number | null;
}

export function StatusSinkronisasi() {
  const { db, keputusanMigrasi } = useDbLokal();
  const { ringkasan, muatUlang } = useAntrean();
  const [halaman, setHalaman] = useState(0);
  const [gagal, setGagal] = useState<HalamanGagal>(KOSONG);
  const [penyimpanan, setPenyimpanan] = useState<Penyimpanan>({ dipakai: null, kuota: null });
  const [pesan, setPesan] = useState<string | null>(null);
  const [terhubung, setTerhubung] = useState(false);
  const [mengirim, setMengirim] = useState(false);

  useEffect(() => {
    let hidup = true;
    sinkronisasiSekarang().then((s) => hidup && setTerhubung(s !== null), () => {});
    return () => {
      hidup = false;
    };
  }, []);

  // `spec-h:261`: "Tombol coba lagi memicu pengiriman ulang segera."
  // Ia memicu penjadwal yang SAMA yang berjalan di latar -- bukan putaran
  // kedua yang berdiri sendiri, karena dua putaran bersamaan mengirim item
  // yang sama dua kali dalam penerbangan.
  const cobaKirim = useCallback(async () => {
    setMengirim(true);
    try {
      const s = await sinkronisasiSekarang();
      if (!s) return;
      await s.penjadwal.picu('manual');
      setPesan('Pengiriman dijalankan.');
    } finally {
      setMengirim(false);
    }
  }, []);

  const indikator = keadaanIndikator(ringkasan);
  const sekarang = Date.now();

  useEffect(() => {
    let hidup = true;
    daftarGagal(db, halaman).then(
      (h) => hidup && setGagal(h),
      () => hidup && setGagal(KOSONG)
    );
    return () => {
      hidup = false;
    };
  }, [db, halaman, ringkasan.gagal]);

  useEffect(() => {
    let hidup = true;
    navigator.storage?.estimate?.().then(
      (e) => hidup && setPenyimpanan({ dipakai: e.usage ?? null, kuota: e.quota ?? null }),
      () => {}
    );
    return () => {
      hidup = false;
    };
  }, []);

  const ekspor = useCallback(async () => {
    const konfig = await bacaKonfigPerangkat(db);
    const teks = await buatEksporDarurat(db, {
      deviceCode: konfig?.deviceCode ?? 'belum-dihubungkan',
      sekarang: Date.now(),
    });
    const url = URL.createObjectURL(new Blob([teks], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `lumi-antrean-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setPesan('Ekspor darurat diunduh. Simpan sampai antrean benar-benar kosong.');
  }, [db]);

  const kolom = [
    { key: 'entity_type', header: 'Jenis' },
    { key: 'entity_id', header: 'ID transaksi' },
    {
      key: 'created_at',
      header: 'Dibuat',
      render: (b: BarisOutbox) => umurRelatif(b.created_at, sekarang),
    },
    { key: 'attempts', header: 'Percobaan', align: 'right' as const },
    { key: 'alasan', header: 'Alasan', render: (b: BarisOutbox) => pesanGagal(b) },
  ];

  const halamanTerakhir = Math.max(0, Math.ceil(gagal.total / PER_HALAMAN) - 1);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <span className="t-title">Status Sinkronisasi</span>
        <Badge tone={indikator.state === 'ok' ? 'success' : indikator.state === 'failed' ? 'danger' : 'warning'}>
          {indikator.state === 'ok' ? 'Tersinkron' : indikator.state === 'failed' ? 'Ada yang gagal' : 'Mengantre'}
        </Badge>
      </div>

      <p className="t-body">
        Terakhir terkirim ke server: {umurRelatif(ringkasan.terakhirTerkirimPada, sekarang)}.
        {' '}Angka ini untuk transaksi yang naik; katalog yang turun punya jadwalnya sendiri.
      </p>

      <Card>
        <div className="row between">
          <span className="t-body-md">Menunggu terkirim</span>
          <span className="t-title num">{ringkasan.menunggu}</span>
        </div>
        <div className="t-caption">Tertua: {umurRelatif(ringkasan.tertuaPada, sekarang)}</div>
      </Card>

      <Card>
        <div className="row between">
          <span className="t-body-md">Gagal terkirim</span>
          <span className="t-title num">{ringkasan.gagal}</span>
        </div>
        <div className="t-caption">
          Item gagal tidak dihapus. Ia menunggu diperiksa, bukan menghilang.
        </div>
      </Card>

      {/* Satu aksi utama per layar. Nonaktif hanya bila perangkat belum
          dihubungkan -- dan yang dinonaktifkan disertai ALASANNYA beserta
          jalan keluarnya, bukan tombol mati tanpa keterangan. */}
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Tombol
          varian="primary"
          disabled={!terhubung || mengirim}
          title={terhubung ? undefined : 'Perangkat belum dihubungkan'}
          onClick={cobaKirim}
        >
          {mengirim ? 'Mengirim…' : 'Coba kirim sekarang'}
        </Tombol>
        <Tombol varian="secondary" onClick={ekspor}>
          Ekspor darurat
        </Tombol>
      </div>
      {!terhubung && (
        <p className="t-caption">
          Pengiriman ulang belum dapat dijalankan: perangkat ini belum dihubungkan ke
          server. Hubungkan lewat menu Perangkat. Ekspor darurat tetap berfungsi tanpa
          koneksi.
        </p>
      )}

      {pesan && <p className="t-caption">{pesan}</p>}

      <Card>
        <div className="row between">
          <span className="t-body-md">Penyimpanan perangkat</span>
          <span className="t-caption num">
            {formatUkuran(penyimpanan.dipakai)} / {formatUkuran(penyimpanan.kuota)}
          </span>
        </div>
        <div className="t-caption">
          Angka ini kuota browser, bukan kapasitas disk perangkat, dan browser boleh
          menguranginya tanpa pemberitahuan.
        </div>
      </Card>

      <div className="stack" style={{ gap: 'var(--space-2)' }}>
        <span className="t-body-md">Detail item gagal</span>
        <Table
          columns={kolom}
          rows={gagal.baris}
          keyField="id"
          caption="Item yang gagal terkirim"
          empty={
            <EmptyState
              title="Tidak ada yang gagal"
              body="Semua transaksi di perangkat ini terkirim atau masih dalam antrean."
            />
          }
        />
        {gagal.total > PER_HALAMAN && (
          <div className="row" style={{ gap: 'var(--space-3)' }}>
            <Tombol varian="secondary" disabled={halaman === 0} onClick={() => setHalaman((h) => h - 1)}>
              Sebelumnya
            </Tombol>
            <span className="t-caption">
              Halaman {halaman + 1} dari {halamanTerakhir + 1}
            </span>
            <Tombol
              varian="secondary"
              disabled={halaman >= halamanTerakhir}
              onClick={() => setHalaman((h) => h + 1)}
            >
              Berikutnya
            </Tombol>
          </div>
        )}
      </div>

      <p className="t-caption">
        Skema lokal: {keputusanMigrasi.alasan}{' '}
        <Tombol varian="secondary" onClick={muatUlang}>
          Muat ulang angka
        </Tombol>
      </p>
    </div>
  );
}
