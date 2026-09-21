import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Table } from 'ds';
import {
  buatEksporDarurat,
  buatEksporPemulihan,
  daftarGagal,
  formatUkuran,
  keadaanIndikator,
  PER_HALAMAN,
  pesanGagal,
  umurRelatif,
  type HalamanGagal,
} from '../../../../packages/sync-client/src/status.ts';
import type { BarisOutbox } from '../../../../packages/sync-client/src/ports.ts';
import {
  bacaKonfigPerangkat,
  type KonfigPerangkat,
} from '../../../../packages/sync-client/src/perangkat.ts';
import { pantauJangkauan, type KeadaanJangkauan } from '../lokal/keterjangkauan.ts';
import { PortalAksi } from '../komponen/PortalAksi.tsx';
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

/**
 * Label badge, satu per keadaan.
 *
 * ⛔ `tak-terbaca` BUKAN keadaan `keadaanIndikator`, dan itu disengaja: ia
 * keadaan yang hanya layar ini ketahui. Saat `daftarGagal` menolak, `ringkasan`
 * tetap 0/0 dan `keadaanIndikator` menjawab `ok` — jadi badge berbunyi
 * "Tersinkron" tepat di atas `EmptyState` yang berbunyi "Ini BUKAN berarti
 * semuanya terkirim". Satu layar, dua kalimat yang saling membantah, dan
 * kalimat yang dibaca lebih dulu adalah yang di atas.
 *
 * Ditemukan saat K-14 pertama kali dirender, 21 September 2026 — bukan dari
 * membaca kode.
 */
const LABEL_BADGE = {
  ok: 'Tersinkron',
  failed: 'Ada yang gagal',
  queued: 'Mengantre',
  'offline-only': 'Butuh koneksi',
  'tak-terbaca': 'Antrean belum dapat dibaca',
} as const;

/**
 * Kenapa "Coba kirim sekarang" tidak dapat dijalankan — kalimat per sebab.
 *
 * ⛔ TIGA sebab, bukan satu. Sampai 21 September 2026 layar ini punya satu
 * kalimat untuk semuanya: *"perangkat ini belum dihubungkan ke server.
 * Hubungkan lewat menu Perangkat."* Ia diturunkan dari `sinkronisasiSekarang()
 * !== null` — penjadwal relay hidup atau tidak — dan itu **bukan**
 * keterjangkauan. Konsekuensinya: perangkat yang SUDAH terdaftar dan hanya
 * kehilangan uplink dikirim ke menu Perangkat, tempat tidak ada satu pun hal
 * yang dapat ia perbaiki, sementara antreannya sebenarnya baik-baik saja dan
 * akan terkirim sendiri.
 *
 * Kalimat yang menyuruh orang memperbaiki hal yang tidak rusak jauh lebih
 * mahal daripada kalimat yang tidak ada: ia menghabiskan waktu kasir di jam
 * ramai, dan ia menghapus kepercayaan pada kalimat berikutnya.
 */
function ALASAN_TAK_SIAP(terdaftar: boolean, jangkauan: KeadaanJangkauan): string {
  if (!terdaftar) {
    return (
      'Pengiriman ulang belum dapat dijalankan: perangkat ini belum terdaftar. ' +
      'Daftarkan lewat menu Perangkat. Ekspor darurat tetap berfungsi tanpa koneksi.'
    );
  }
  if (jangkauan === 'memeriksa') {
    return 'Memeriksa apakah server dapat dijangkau dari perangkat ini…';
  }
  return (
    'Server tidak dapat dijangkau dari perangkat ini sekarang. Antreannya akan ' +
    'terkirim sendiri begitu koneksi kembali — tidak ada yang hilang, dan tidak ada ' +
    'yang perlu diatur ulang. Ekspor darurat tetap berfungsi tanpa koneksi.'
  );
}

const NADA_BADGE = {
  ok: 'success',
  failed: 'danger',
  queued: 'warning',
  'offline-only': 'warning',
  'tak-terbaca': 'warning',
} as const;

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
  const [gagalMuat, setGagalMuat] = useState<string | null>(null);
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [jangkauan, setJangkauan] = useState<KeadaanJangkauan>('memeriksa');

  useEffect(() => {
    let hidup = true;
    sinkronisasiSekarang().then((s) => hidup && setTerhubung(s !== null), () => {});
    return () => {
      hidup = false;
    };
  }, []);

  /* ⛔ Identitas perangkat dibaca di layar ini SENDIRI, dengan aturan yang
     sama persis dengan `useIdentitasPerangkat` di `App.tsx`: ada `device_config`
     berarti terdaftar, dan kegagalan baca diperlakukan sebagai BELUM terdaftar.

     Ia tidak dapat dioper sebagai prop — layar adalah anak `ShellKasir`, bukan
     saudaranya. Yang penting bukan dari mana nilainya datang melainkan bahwa
     kedua tempat menurunkannya dari SATU sumber: baris `device_config`. */
  useEffect(() => {
    let hidup = true;
    bacaKonfigPerangkat(db).then(
      (k) => hidup && setKonfig(k),
      () => hidup && setKonfig(null)
    );
    return () => {
      hidup = false;
    };
  }, [db]);

  const terdaftar = konfig !== null;

  /* ⛔ FR-C3 — keterjangkauan server, lewat modul yang SUDAH ADA.
     `apps/kasir/src/lokal/keterjangkauan.ts` menjawab pertanyaan ini untuk
     K-06 sejak 24 Agustus 2026; pemeriksa kedua di layar ini akan menyimpang
     darinya, dan dua jawaban untuk "apakah server dapat dijangkau" adalah
     tepat yang membuat satu layar menawarkan aksi yang layar lain tahu gagal.

     `memeriksa` DIPERLAKUKAN SEBAGAI TIDAK TERJANGKAU sampai terbukti
     sebaliknya — arah yang sama dengan K-06. Aksi yang ditawarkan selama
     jawabannya belum ada adalah aksi yang gagal di depan kasir. */
  useEffect(() => {
    if (!konfig) return;
    const pemantau = pantauJangkauan({
      baseUrl: konfig.baseUrl,
      pasangPendengar: (nama, fn) => {
        window.addEventListener(nama, fn);
        return () => window.removeEventListener(nama, fn);
      },
    });
    setJangkauan(pemantau.keadaan());
    const lepas = pemantau.langgan(setJangkauan);
    return () => {
      lepas();
      pemantau.hentikan();
    };
  }, [konfig]);

  /* Tiga syarat, dan ketiganya harus benar sebelum aksi ini jujur: perangkat
     terdaftar, penjadwal relay hidup, dan server benar-benar terjangkau. */
  const siapKirim = terdaftar && terhubung && jangkauan === 'terjangkau';

  // `spec-h:261`: "Tombol coba lagi memicu pengiriman ulang segera."
  // Ia memicu penjadwal yang SAMA yang berjalan di latar -- bukan putaran
  // kedua yang berdiri sendiri, karena dua putaran bersamaan mengirim item
  // yang sama dua kali dalam penerbangan.
  const cobaKirim = useCallback(async () => {
    setMengirim(true);
    try {
      const s = await sinkronisasiSekarang();
      /* ⛔ Kembali DIAM-DIAM adalah bentuk cacat tersendiri: kasir menekan
         tombol, tidak ada yang berubah, dan tidak ada yang menjelaskan kenapa. */
      if (!s) {
        setPesan('Pengiriman tidak dapat dijalankan: sinkronisasi belum aktif di perangkat ini.');
        return;
      }
      await s.penjadwal.picu('manual');
      setPesan('Pengiriman dijalankan.');
    } finally {
      setMengirim(false);
    }
  }, []);

  /* ⛔ `perangkatTerdaftar` diteruskan, sama seperti `ShellKasir` melakukannya.
     Tanpanya `keadaanIndikator` memakai bawaan "dianggap terdaftar", dan
     perangkat yang belum didaftarkan mendapat state `ok` → badge "Tersinkron"
     pada antrean yang kosong karena tidak pernah ada yang MASUK ke sana.
     `status.ts:81` menulis kelas cacat itu panjang lebar dan menyebut layar ini
     dengan namanya sebagai pemanggil yang belum disesuaikan. */
  const indikator = keadaanIndikator(ringkasan, { perangkatTerdaftar: terdaftar });
  const sekarang = Date.now();

  /* ⛔ Kegagalan baca MENANG atas apa pun yang `keadaanIndikator` simpulkan.
     Urutannya bukan selera: angka yang dipakainya adalah 0/0 yang berasal dari
     pembacaan yang menolak, dan nol yang tidak diketahui tidak boleh dilaporkan
     sebagai nol yang sehat. Arah yang sama dengan `failed` menang atas
     `queued` di `status.ts`. */
  const keadaanBadge = gagalMuat ? 'tak-terbaca' : indikator.state;

  useEffect(() => {
    let hidup = true;
    daftarGagal(db, halaman).then(
      (h) => {
        if (!hidup) return;
        setGagal(h);
        setGagalMuat(null);
      },
      (e: Error) => {
        /* ⛔ Sampai 1 September 2026 baris ini berbunyi `setGagal(KOSONG)`.
           Pembacaan yang MENOLAK karena itu terlihat persis seperti "tidak ada
           satu pun item gagal" — di layar yang seluruh tugasnya memberi tahu
           merchant penjualan mana yang belum sampai ke server. Daftar kosong
           yang sebenarnya kegagalan baca adalah kebohongan paling mahal yang
           dapat ditampilkan produk ini. */
        if (!hidup) return;
        setGagal(KOSONG);
        setGagalMuat(e.message);
      }
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

  /* Alat koreksi F6 — ekspor yang dapat DIPUTAR ULANG ke server.

     ⛔ Ekspor darurat di atas adalah TEKS, dan `spec-h:263` menuntut itu: yang
     membacanya orang support, bukan parser. Konsekuensinya baru terasa saat
     perangkat benar-benar mati — teks itu tidak dapat dikirim ulang, dan
     satu-satunya jalan memasukkan penjualannya kembali adalah mengetiknya
     ulang dari kertas.

     Berkas ini membawa payload dan idempotency key APA ADANYA, jadi
     `tools/pulihkan-antrean.mjs` dapat mengirimkannya lewat endpoint yang SAMA
     yang dipakai relay — dan menjalankannya dua kali aman. */
  const eksporPemulihan = useCallback(async () => {
    const konfig = await bacaKonfigPerangkat(db);
    const data = await buatEksporPemulihan(db, {
      deviceCode: konfig?.deviceCode ?? 'belum-dihubungkan',
      sekarang: Date.now(),
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `lumi-pemulihan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setPesan('Ekspor pemulihan diunduh. Berikan berkas ini ke dukungan Lumi — ia dapat dikirim ulang ke server.');
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
    <div className="kasir-sync">
      <div className="row" style={{ gap: 'var(--space-3)' }}>
        <span className="t-title">Status Sinkronisasi</span>
        {/* ⛔ EMPAT keadaan, dan sebelumnya hanya tiga cabang yang ditulis:
            `offline-only` jatuh ke "Mengantre", yang menyatakan ada yang
            menunggu dikirim pada perangkat yang antreannya justru kosong.

            "Butuh koneksi" bukan kata yang dikarang di sini — ia teks yang
            `SyncIndicator` bundle render untuk `offline-only` tanpa `reason`,
            dan itu persis yang topbar tampilkan. Dua badge untuk satu keadaan
            harus berbunyi sama; yang berbeda kalimat membuat kasir memutuskan
            mana yang ia percaya. */}
        <Badge tone={NADA_BADGE[keadaanBadge]}>{LABEL_BADGE[keadaanBadge]}</Badge>
      </div>

      <p className="t-body">
        Terakhir terkirim ke server: {umurRelatif(ringkasan.terakhirTerkirimPada, sekarang)}.
        {' '}Angka ini untuk transaksi yang naik; katalog yang turun punya jadwalnya sendiri.
      </p>

      {/* ⛔ BERDAMPINGAN, bukan bertumpuk, dan itu diukur bukan dipilih.

          Dua kartu bertumpuk memakan 168 px dari tinggi yang tersedia untuk
          tabel. Setelah wilayah gulir tabel lahir, ruang yang tersisa untuknya
          tinggal 39 px di panggung galeri — kurang dari satu baris, jadi
          "wilayah yang menggulir" itu benar secara struktur dan tidak berguna
          bagi siapa pun. Berdampingan mengembalikan 92 px kepadanya.

          Bentuknya bukan desain baru: satu baris kartu angka adalah pola yang
          sama dengan deretan `StatCard` di dasbor B-01. Ukuran angkanya TIDAK
          berubah — `t-title` 20px, dan `--t-metric` tetap dilarang di layar
          kasir (§ Skala teks final). */}
      <div className="row kasir-sync-angka" style={{ gap: 'var(--space-4)', alignItems: 'stretch' }}>
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
      </div>

      {/* ⛔ DUA aksi pindah ke slot bilah nav, 21 September 2026, dan yang
          memutuskan mana yang ikut adalah GULIR — bukan kerapian.

          Tabel item gagal memuat sampai 50 baris (`PER_HALAMAN`), dan sebelum
          ini seluruh layar yang menggulir: diukur, "Coba kirim sekarang"
          terdorong 3.272 px ke atas begitu kasir menggulir untuk membaca
          tabelnya. `spec-h:256` menyebut ekspor darurat jaring pengaman yang
          "selalu tersedia", dan jaring pengaman yang menuntut gulir tiga ribu
          piksel bukan "selalu tersedia" dalam arti apa pun. Keduanya karena itu
          ikut; keduanya juga yang ditekan saat ada masalah.

          ⛔ Yang TIDAK ikut ada alasannya, dan alasannya lebar: slot menyisakan
          734 px setelah lima tab, dan keempat tombol berjumlah ~747 px — ia
          MEMBUNGKUS, dan bilah yang membungkus memakan isi layar. Dua yang
          tinggal adalah yang paling jarang ditekan kasir: ekspor pemulihan
          dibaca petugas dukungan, dan "Muat ulang angka" diagnostik yang
          tempatnya memang di bawah bersama baris skema lokal. */}
      <PortalAksi>
        <Tombol
          varian="primary"
          disabled={!siapKirim || mengirim}
          title={siapKirim ? undefined : ALASAN_TAK_SIAP(terdaftar, jangkauan)}
          onClick={cobaKirim}
        >
          {mengirim ? 'Mengirim…' : 'Coba kirim sekarang'}
        </Tombol>
        <Tombol varian="secondary" onClick={ekspor}>
          Ekspor darurat
        </Tombol>
      </PortalAksi>

      <div className="row" style={{ gap: 'var(--space-3)' }}>
        {/* ⛔ DUA ekspor, bukan satu yang serba bisa. Yang pertama dibaca
            manusia (`spec-h:263`); yang kedua dibaca mesin dan dapat dikirim
            ulang. Satu berkas yang mencoba keduanya akan buruk di keduanya. */}
        <Tombol varian="secondary" onClick={eksporPemulihan}>
          Ekspor pemulihan (JSON)
        </Tombol>
      </div>
      {!siapKirim && <p className="t-caption">{ALASAN_TAK_SIAP(terdaftar, jangkauan)}</p>}

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

      {/* ⛔ Bagian inilah yang MENGGULIR, dan hanya bagian ini.

          Sebelum 21 September 2026 yang menggulir `.kasir-konten` — pembungkus
          milik shell yang melayani enam layar — jadi tabel 50 baris
          menggulirkan SELURUH K-14. Terukur: "Coba kirim sekarang" dan kartu
          Penyimpanan bergeser 3.272 px ke atas begitu kasir menggulir untuk
          membaca tabelnya.

          Bentuknya disalin dari `.kasir-baris-daftar` di keranjang K-03,
          termasuk penanda batas gulungnya: label "Detail item gagal" dan
          paginasi tinggal di luar penggulir, dan hanya tabelnya yang bergerak. */}
      <div className="kasir-sync-bagian">
        <span className="t-body-md">Detail item gagal</span>
        <div className="kasir-sync-daftar">
        <Table
          columns={kolom}
          rows={gagal.baris}
          keyField="id"
          caption="Item yang gagal terkirim"
          empty={
            /* ⛔ Dua kalimat untuk dua keadaan yang tabelnya tampilkan sama.
               Tabel kosong karena tidak ada yang gagal, dan tabel kosong karena
               daftarnya tidak dapat dibaca, adalah kabar yang berlawanan —
               yang pertama menenangkan, yang kedua menuntut tindakan. Satu
               kalimat untuk keduanya membuat kegagalan baca terbaca sebagai
               jaminan. */
            gagalMuat ? (
              <EmptyState
                title="Daftar item gagal tidak dapat dibaca"
                body={`Ini BUKAN berarti semuanya terkirim — perangkat tidak dapat menjawab. Jangan tutup shift sebelum masalahnya selesai. (${gagalMuat})`}
              />
            ) : (
              <EmptyState
                title="Tidak ada yang gagal"
                body="Semua transaksi di perangkat ini terkirim atau masih dalam antrean."
              />
            )
          }
        />
        </div>
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
