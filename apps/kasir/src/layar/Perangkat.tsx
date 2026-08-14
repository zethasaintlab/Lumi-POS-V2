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
import { bacaProfilPrinter, dokumenUjiCetak } from '../cetak/profil.ts';
import type { PrinterProfile } from '../cetak/escpos.ts';
import { cetakStruk, noopPeripheral, type HasilCetak } from '../cetak/port.ts';

/* K-15 Perangkat & Uji Cetak.

   Dua bagian: penghubungan perangkat (tanpanya tidak ada jalur sinkronisasi
   yang dapat menyala) dan UJI CETAK.

   ⛔ Uji cetak memakai `noopPeripheral` untuk sekarang. Adapter yang
   benar-benar menyentuh printer — Tauri/Rust, Network, WebUSB (`ARCH:200`) —
   menunggu shell Tauri, dan `ARCH:235` menyebut alasannya: WebUSB gagal di
   Windows, jadi jalur universalnya adalah Rust atau printer network.

   Yang sudah berlaku sekarang: dokumen uji dibangun, dirender ke byte ESC/POS
   sesuai profil, dan jumlah byte-nya DITAMPILKAN. Itu yang membuat kasir dapat
   melihat profil mana yang menghasilkan lebar yang benar sebelum satu lembar
   kertas pun terpakai — dan yang membuat adapter berikutnya tinggal
   dipasang.

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
  /* Profil dibaca dari DATABASE, bukan dari konstanta. `ERD:445`: menambah
     model printer = menambah baris. Baseline ikut di belakangnya supaya
     perangkat tanpa profil tersinkron tetap dapat mencetak. */
  const [profil, setProfil] = useState<PrinterProfile[]>([]);
  const [profilId, setProfilId] = useState('');
  const [hasilUji, setHasilUji] = useState<{ hasil: HasilCetak; byte: number } | null>(null);

  useEffect(() => {
    let hidup = true;
    bacaKonfigPerangkat(db).then(
      (k) => {
        if (!hidup) return;
        setTersimpan(k);
        if (k) setNilai({ ...k, tokenSecret: k.tokenSecret ?? '' });
        void bacaProfilPrinter(db).then((daftar) => {
          if (!hidup) return;
          setProfil(daftar);
          setProfilId((kini) => kini || daftar[0]?.id || '');
        });
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

  async function ujiCetak() {
    const dipilih = profil.find((p) => p.id === profilId) ?? profil[0];
    if (!dipilih) return;
    const dok = dokumenUjiCetak(dipilih);
    // Byte dihitung dari renderer yang SAMA yang dipakai penjualan — bukan
    // jalur cetak terpisah. Uji cetak yang memakai jalurnya sendiri dapat
    // berhasil sementara struk sungguhan gagal.
    const { renderEscPos } = await import('../cetak/escpos.ts');
    const byte = renderEscPos(dok, dipilih).length;
    setHasilUji({ hasil: await cetakStruk(noopPeripheral(), dok, dipilih), byte });
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

      <span className="t-title">Uji cetak</span>

      <Card>
        <div className="t-body-md">Profil printer</div>
        <div className="t-caption">
          Cetak lembar uji untuk memastikan lebar kertasnya benar. Penggaris angka
          di lembar itu harus muat dalam satu baris.
        </div>
        <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          {profil.map((p) => (
            <Tombol
              key={p.id}
              varian={p.id === profilId ? 'primary' : 'secondary'}
              onClick={() => setProfilId(p.id)}
            >
              {p.nama}
            </Tombol>
          ))}
        </div>
      </Card>

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Tombol varian="secondary" onClick={ujiCetak}>
          Cetak lembar uji
        </Tombol>
      </div>

      {hasilUji && (
        <p className="t-caption">
          {hasilUji.hasil.status === 'tercetak'
            ? `Lembar uji dibuat: ${hasilUji.byte} byte ESC/POS.`
            : hasilUji.hasil.status === 'tanpa_printer'
              ? 'Belum ada printer yang terpasang di perangkat ini.'
              : `Gagal mencetak: ${hasilUji.hasil.pesan}`}
        </p>
      )}

      <p className="t-caption">
        Printer belum benar-benar tersambung: adapter yang menyentuh perangkat
        keras menunggu Tauri. Yang diperiksa sekarang adalah byte yang akan
        dikirim, bukan kertas yang keluar.
      </p>

      <p className="t-caption">
        Kredensial disimpan di database perangkat ini tanpa enkripsi. Enkripsi at-rest
        menunggu keystore OS lewat Tauri; sampai itu ada, perangkat yang hilang harus
        dicabut dari dashboard.
      </p>
    </div>
  );
}
