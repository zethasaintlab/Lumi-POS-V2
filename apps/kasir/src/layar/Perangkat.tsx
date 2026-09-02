import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, SegmentedControl } from 'ds';
import {
  bacaKonfigPerangkat,
  siapKirim,
  type KonfigPerangkat,
} from '../../../../packages/sync-client/src/perangkat.ts';
import { Bidang } from '../Bidang.tsx';
import { Tombol } from '../Tombol.tsx';
import { simpanIdentitasPerangkat } from '../perangkat/simpan-identitas.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { GagalBaca } from '../komponen/GagalBaca.tsx';
import { useSesi } from '../konteks/useSesi.ts';
import { bacaProfilPrinter, dokumenUjiCetak } from '../cetak/profil.ts';
import { pesanProfil, profilBerlaku } from '../cetak/berlaku.ts';
import { bacaPilihanProfil } from '../cetak/pilihan.ts';
import { simpanPeripheralPrinter } from '../cetak/simpan-peripheral.ts';
import {
  jumlahCetakTertunda,
  prosesAntreanCetak,
  MAKS_PERCOBAAN_CETAK,
} from '../cetak/antrean.ts';
import { peripheralAktif } from '../cetak/aktif.ts';
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
  const { sesi } = useSesi();
  const [nilai, setNilai] = useState<KonfigPerangkat>(KOSONG);
  const [tersimpan, setTersimpan] = useState<KonfigPerangkat | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  /* Pesan blokir FR-H4 BUKAN pesan sukses berwarna sama. Aturan design system
     #5: status tidak pernah warna saja — dan di sini teksnya juga berbeda,
     jadi yang dijaga adalah keduanya tidak terlihat serupa. */
  const [pesanBlokir, setPesanBlokir] = useState(false);
  const [memuat, setMemuat] = useState(true);
  const [gagalMuat, setGagalMuat] = useState<string | null>(null);
  /* Profil dibaca dari DATABASE, bukan dari konstanta. `ERD:445`: menambah
     model printer = menambah baris. Baseline ikut di belakangnya supaya
     perangkat tanpa profil tersinkron tetap dapat mencetak. */
  const [profil, setProfil] = useState<PrinterProfile[]>([]);
  const [profilId, setProfilId] = useState('');
  /* Pilihan yang BENAR-BENAR tersimpan, terpisah dari yang sedang disorot.
     Tanpa pemisahan itu, layar tidak dapat mengatakan "belum disimpan" — dan
     kasir yang menutup layar mengira pilihannya berlaku. */
  const [tersimpanProfil, setTersimpanProfil] = useState<string | null>(null);
  const [peripheralId, setPeripheralId] = useState<string | null>(null);
  const [pesanProfilSimpan, setPesanProfilSimpan] = useState<string | null>(null);
  const [hasilUji, setHasilUji] = useState<{ hasil: HasilCetak; byte: number } | null>(null);
  const [tertunda, setTertunda] = useState(0);
  const [pesanAntrean, setPesanAntrean] = useState<string | null>(null);
  const [memproses, setMemproses] = useState(false);

  useEffect(() => {
    let hidup = true;
    bacaKonfigPerangkat(db).then(
      (k) => {
        if (!hidup) return;
        setTersimpan(k);
        if (k) setNilai({ ...k, tokenSecret: k.tokenSecret ?? '' });
        void Promise.all([bacaProfilPrinter(db), bacaPilihanProfil(db)]).then(
          ([daftar, dipilih]) => {
            if (!hidup) return;
            setProfil(daftar);
            setTersimpanProfil(dipilih);
            // ⛔ BUKAN `daftar[0]`. Query profil tidak punya `ORDER BY`, jadi
            // "yang pertama" tidak dijamin apa pun — dan itu tepat cacat yang
            // pilihan tersimpan ada untuk memperbaikinya.
            setProfilId((kini) => kini || profilBerlaku(daftar, dipilih).profil?.id || '');
          }
        );
        void db
          .getAll<{ peripheral_id: string | null }>(
            'SELECT peripheral_id FROM device_config WHERE id = 1'
          )
          .then((baris) => hidup && setPeripheralId(baris[0]?.peripheral_id ?? null))
          .catch(() => {});
        void jumlahCetakTertunda(db).then((n) => hidup && setTertunda(n), () => {});
        setMemuat(false);
      },
      (e: Error) => {
        /* ⛔ Kegagalan MEMBACA dibedakan dari perangkat yang memang belum
           terhubung. Sebelum 1 September 2026 keduanya jatuh ke layar yang
           sama, dan layar itu berbunyi "Perangkat belum terhubung" — kalimat
           yang menyuruh merchant memasukkan ulang kredensial yang sebenarnya
           sudah ada di perangkatnya, dan yang sekali tersimpan salah
           mematikan sinkronisasi sungguhan. */
        if (!hidup) return;
        setGagalMuat(e.message);
        setMemuat(false);
      }
    );
    return () => {
      hidup = false;
    };
  }, [db]);

  const ubah = (kunci: keyof KonfigPerangkat) => (v: string) =>
    setNilai((n) => ({ ...n, [kunci]: v }));

  /* FR-H4 — ganti identitas perangkat diblokir saat antrean tidak kosong.

     ⛔ Aturannya di `perangkat/simpan-identitas.ts`, bukan di sini. AC ketiga
     menuntut blokirnya "ditegakkan di lapisan domain, bukan hanya
     menyembunyikan tombol", dan versi pertama saya menaruhnya di komponen ini
     — lalu penjaga strukturalnya terbukti lolos saat pemanggilnya dihapus dan
     import-nya tertinggal. Yang hanya dapat diuji lewat DOM tidak benar-benar
     diuji. */
  async function simpan() {
    const hasil = await simpanIdentitasPerangkat(db, nilai);
    if (!hasil.berhasil) {
      setPesanBlokir(true);
      setPesan(hasil.pesan);
      return;
    }
    setTersimpan(nilai);
    setPesanBlokir(false);
    // Sinkronisasi dinyalakan saat aplikasi dimuat, bukan di tengah jalan:
    // menyambungkan PowerSync dua kali dalam satu proses belum pernah kami
    // uji, dan menebaknya di layar pengaturan bukan tempat yang benar.
    setPesan('Tersimpan. Muat ulang aplikasi untuk menyalakan sinkronisasi.');
  }

  /* K-15 — menyimpan pilihan profil printer perangkat ini.

     ⛔ Sebelum ini, pilihan di layar ini murni state React: ia hilang saat
     layar ditutup, dan K-09 (cetak ulang) tidak pernah melihatnya sama sekali.
     Yang dipakai mencetak adalah `p[0]` — baris pertama dari query tanpa
     `ORDER BY`. */
  async function simpanProfil() {
    if (!tersimpan) {
      setPesanProfilSimpan('Hubungkan perangkat lebih dulu.');
      return;
    }
    // ⛔ Aktor adalah PENGGUNA, bukan perangkat. `audit_event.actor_user_id`
    // ber-FK ke `"user"` dan NOT NULL; mengirim `deviceId` menghasilkan 404
    // yang berhenti permanen di antrean — dan yang menemukannya adalah
    // merchant, berjam-jam kemudian.
    if (!sesi) {
      setPesanProfilSimpan('Masuk lebih dulu — perubahan ini tercatat atas nama Anda.');
      return;
    }
    try {
      const hasil = await simpanPeripheralPrinter(db, {
        peripheralIdTersimpan: peripheralId,
        profilId,
        deviceId: tersimpan.deviceId,
        outletId: tersimpan.outletId,
        actorId: sesi.userId,
      });
      setPeripheralId(hasil.peripheralId);
      setTersimpanProfil(profilId);
      setPesanProfilSimpan('Profil tersimpan untuk perangkat ini.');
    } catch (e) {
      setPesanProfilSimpan(`Profil tidak dapat disimpan: ${(e as Error).message}`);
    }
  }

  /* F4 — antrean cetak (`ERD:447`).

     ⛔ Memakai `peripheralAktif()`, BUKAN `noopPeripheral()`. Uji cetak boleh
     memakai noop karena yang dibuktikannya adalah byte-nya terbentuk, dan
     layarnya menyatakan itu. Antrean cetak berbeda: menandai job `printed`
     lewat noop berarti struk yang benar-benar gagal hilang dari antrean tanpa
     pernah dicetak. */
  async function prosesAntrean() {
    const dipilih = profil.find((p) => p.id === profilId) ?? profil[0] ?? null;
    setMemproses(true);
    setPesanAntrean(null);
    try {
      const hasil = await prosesAntreanCetak(db, peripheralAktif(), dipilih);
      setTertunda(await jumlahCetakTertunda(db));
      setPesanAntrean(
        hasil.dicoba === 0
          ? 'Tidak ada yang dicoba — belum ada printer terpasang di perangkat ini.'
          : `${hasil.berhasil} tercetak, ${hasil.gagal} masih gagal dari ${hasil.dicoba} percobaan.`
      );
    } finally {
      setMemproses(false);
    }
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

  if (gagalMuat) {
    return <GagalBaca akibat="Identitas perangkat tidak dapat dibaca, jadi layar ini tidak dapat menampilkan setelan yang sedang berlaku." pesan={gagalMuat} />;
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <span className="t-title">Perangkat</span>

      <Card>
        {/* ⛔ `<Badge>`, bukan kalimat biasa. Layar ini dibaca orang yang tidak
            memasang POS setiap hari, dan keadaan sambungan adalah satu-satunya
            hal di halaman ini yang harus terbaca dalam sekali lihat. */}
        <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
          <Badge tone={siapKirim(tersimpan) ? 'success' : 'warning'}>
            {siapKirim(tersimpan) ? 'Terhubung' : 'Belum terhubung'}
          </Badge>
          <span className="t-caption">
            {siapKirim(tersimpan)
              ? `${tersimpan?.deviceCode} · outlet ${tersimpan?.outletId}`
              : 'Sinkronisasi mati sampai identitas dan kredensial lengkap.'}
          </span>
        </div>
      </Card>

      {/* ⛔ Keenam kolom DIKELOMPOKKAN dalam satu kartu, 2 September 2026.
          Sebelumnya keenamnya melayang di aliran halaman dengan jarak yang
          sama seperti jarak antar-BAGIAN — jadi tidak ada apa pun yang
          menyatakan bahwa keenamnya satu formulir, dan tombol Simpan di
          bawahnya terbaca seperti menyimpan seluruh halaman.

          `<Card>` bundle, dan judul bagiannya di dalam kartu: itu yang
          mengikat tombol Simpan ke kolom-kolom yang ia simpan. */}
      <Card>
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          <div>
            <div className="t-body-md">Identitas perangkat</div>
            <div className="t-caption">
              Diberikan oleh pemilik saat perangkat didaftarkan. Salin apa adanya.
            </div>
          </div>

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
        </div>
      </Card>
      {pesan && (
        <p
          className={pesanBlokir ? 't-body-md kasir-login-galat' : 't-caption'}
          role={pesanBlokir ? 'alert' : 'status'}
        >
          {pesan}
        </p>
      )}

      <span className="t-title">Uji cetak</span>

      <Card>
        <div className="t-body-md">Profil printer</div>
        <div className="t-caption">
          Cetak lembar uji untuk memastikan lebar kertasnya benar. Penggaris angka
          di lembar itu harus muat dalam satu baris.
        </div>
        {/* ⛔ Kalimat yang menyatakan profil mana yang BERLAKU, dan kenapa.
            Kasir yang melihat profil yang bukan pilihannya harus dapat
            mengetahui sebabnya, bukan menyimpulkan aplikasinya mengabaikan
            setelannya. */}
        <div className="t-caption" style={{ marginTop: 'var(--space-2)' }}>
          {(() => {
            const b = profilBerlaku(profil, tersimpanProfil);
            return pesanProfil(b.sebab, b.profil?.nama ?? null);
          })()}
        </div>
        {/* ⛔ `<SegmentedControl>`, bukan barisan tombol. Deretan tombol
            `primary`/`secondary` membuat setiap profil terlihat seperti AKSI —
            orang awam yang menekan "Epson TM-T82" wajar mengira ia baru saja
            menyuruh sesuatu dicetak. Ini pilihan MODE, dan segmented control
            adalah bentuk yang menyatakannya.

            Sekaligus mengembalikan aturan DS #2: sebelumnya ada dua tombol
            `primary` di layar yang sama (Simpan dan profil terpilih), dan
            "satu aksi utama per layar" berhenti berlaku. */}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <SegmentedControl
            ariaLabel="Profil printer"
            value={profilId ?? ''}
            onChange={(id: string) => setProfilId(id)}
            options={profil.map((p) => ({ value: p.id, label: p.nama }))}
          />
        </div>
      </Card>

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <Tombol varian="secondary" onClick={ujiCetak}>
          Cetak lembar uji
        </Tombol>
        <Tombol
          varian="primary"
          disabled={profilId === '' || profilId === tersimpanProfil}
          onClick={simpanProfil}
        >
          Simpan profil untuk perangkat ini
        </Tombol>
      </div>

      {pesanProfilSimpan && <p className="t-caption">{pesanProfilSimpan}</p>}

      {hasilUji && (
        <p className="t-caption">
          {hasilUji.hasil.status === 'tercetak'
            ? `Lembar uji dibuat: ${hasilUji.byte} byte ESC/POS.`
            : hasilUji.hasil.status === 'tanpa_printer'
              ? 'Belum ada printer yang terpasang di perangkat ini.'
              : `Gagal mencetak: ${hasilUji.hasil.pesan}`}
        </p>
      )}

      <span className="t-title">Antrean cetak</span>

      <Card>
        <div className="t-body-md">
          {tertunda === 0 ? 'Tidak ada struk yang tertunda' : `${tertunda} struk belum tercetak`}
        </div>
        {/* ⛔ Dokumen dicetak ulang APA ADANYA dari baris `print_job`, bukan
            dibangun ulang. FR-B11 menuntut cetak ulang identik dengan cetakan
            pertama, dan itu hanya dapat dijamin bila byte-nya sama. */}
        <div className="t-caption">
          Struk yang gagal dicetak tersimpan di perangkat ini beserta dokumennya.
          Setelah {MAKS_PERCOBAAN_CETAK} percobaan ia berhenti dicoba otomatis, tapi tetap
          tersimpan dan masih dapat dicetak dari layar Detail Transaksi.
        </div>
        <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          <Tombol varian="secondary" disabled={memproses || tertunda === 0} onClick={() => void prosesAntrean()}>
            {memproses ? 'Mencoba…' : 'Coba cetak lagi'}
          </Tombol>
        </div>
      </Card>

      {pesanAntrean && (
        <p className="t-caption" role="status">
          {pesanAntrean}
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
