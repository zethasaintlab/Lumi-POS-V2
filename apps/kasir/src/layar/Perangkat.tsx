import { useEffect, useState } from 'react';
import { Card, EmptyState } from 'ds';
import {
  bacaKonfigPerangkat,
  simpanKonfigPerangkat,
  siapKirim,
  type KonfigPerangkat,
} from '../../../../packages/sync-client/src/perangkat.ts';
import { Bidang } from '../Bidang.tsx';
import { Tombol } from '../Tombol.tsx';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';

/* K-15 Perangkat & Uji Cetak — bagian PERANGKAT saja.

   Uji cetak menunggu `PeripheralPort` (F4); yang ada di sini adalah
   penghubungan perangkat, karena tanpanya tidak ada satu pun jalur sinkronisasi
   yang dapat menyala.

   Nilainya diketik tangan, dan itu memang bentuk sementara: di produksi
   back-office yang menerbitkan kredensial dan kasir memindai/menempelkannya
   sekali. Back-office belum ada, jadi yang tersedia adalah formulir. */

const KOSONG: KonfigPerangkat = {
  deviceId: '',
  deviceCode: '',
  tenantId: '',
  outletId: '',
  baseUrl: '',
  tokenSecret: '',
};

export function Perangkat() {
  const { db } = useDbLokal();
  const [nilai, setNilai] = useState<KonfigPerangkat>(KOSONG);
  const [tersimpan, setTersimpan] = useState<KonfigPerangkat | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);

  useEffect(() => {
    let hidup = true;
    bacaKonfigPerangkat(db).then(
      (k) => {
        if (!hidup) return;
        setTersimpan(k);
        if (k) setNilai({ ...k, tokenSecret: k.tokenSecret ?? '' });
        setMemuat(false);
      },
      () => hidup && setMemuat(false)
    );
    return () => {
      hidup = false;
    };
  }, [db]);

  const ubah = (kunci: keyof KonfigPerangkat) => (v: string) =>
    setNilai((n) => ({ ...n, [kunci]: v }));

  async function simpan() {
    await simpanKonfigPerangkat(db, nilai);
    setTersimpan(nilai);
    // Sinkronisasi dinyalakan saat aplikasi dimuat, bukan di tengah jalan:
    // menyambungkan PowerSync dua kali dalam satu proses belum pernah kami
    // uji, dan menebaknya di layar pengaturan bukan tempat yang benar.
    setPesan('Tersimpan. Muat ulang aplikasi untuk menyalakan sinkronisasi.');
  }

  if (memuat) {
    return <EmptyState title="Membaca konfigurasi perangkat" />;
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <span className="t-title">Perangkat</span>

      <Card>
        <div className="t-body-md">
          {siapKirim(tersimpan) ? 'Perangkat terhubung' : 'Perangkat belum terhubung'}
        </div>
        <div className="t-caption">
          {siapKirim(tersimpan)
            ? `${tersimpan?.deviceCode} · outlet ${tersimpan?.outletId}`
            : 'Sinkronisasi mati sampai identitas dan kredensial lengkap.'}
        </div>
      </Card>

      <Bidang label="Alamat server" value={nilai.baseUrl} onChange={ubah('baseUrl')} placeholder="http://localhost:3000" />
      <Bidang label="Tenant" value={nilai.tenantId} onChange={ubah('tenantId')} />
      <Bidang label="Outlet" value={nilai.outletId} onChange={ubah('outletId')} />
      <Bidang label="ID perangkat" value={nilai.deviceId} onChange={ubah('deviceId')} />
      <Bidang
        label="Kode perangkat"
        hint="Muncul di nomor struk, misalnya K1"
        value={nilai.deviceCode}
        onChange={ubah('deviceCode')}
      />
      <Bidang
        label="Kredensial perangkat"
        hint="Diterbitkan sekali oleh server dan tidak dapat dibaca ulang di sana"
        type="password"
        value={nilai.tokenSecret ?? ''}
        onChange={ubah('tokenSecret')}
      />

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Tombol varian="primary" disabled={!siapKirim(nilai)} onClick={simpan}>
          Simpan
        </Tombol>
      </div>
      {pesan && <p className="t-caption">{pesan}</p>}

      <p className="t-caption">
        Kredensial disimpan di database perangkat ini tanpa enkripsi. Enkripsi at-rest
        menunggu keystore OS lewat Tauri; sampai itu ada, perangkat yang hilang harus
        dicabut dari dashboard.
      </p>
    </div>
  );
}
