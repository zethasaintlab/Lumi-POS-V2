import { useEffect, useState } from 'react';
import { pantauJangkauan, type KeadaanJangkauan } from '../lokal/keterjangkauan.ts';
import { alasanNonaktif } from '../../../../packages/domain/src/pembayaran-manual.ts';
import { PanelQris } from '../komponen/PanelQris.tsx';
import { buatPemanggilApi } from '../lokal/api.ts';
import {
  cadangkanNomor,
  bersihkanDraf,
  mintaQr,
  pulihkanDraf,
} from '../kasir/qris-dinamis.ts';
import type { DrafTerkirim } from '../kasir/penjualan.ts';
import { EmptyState } from 'ds';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { shiftAktif, type ShiftAktif } from '../kas/shift.ts';
import { muatHlc } from '../lokal/hlc.ts';
import type { Hlc } from '../../../../packages/domain/src/hlc.ts';
import {
  hitungKeranjang,
  simpanPenjualan,
  type HasilPenjualan,
  type MetodeBayar,
  type Pembayaran,
} from '../kasir/penjualan.ts';
import { MIN_PANJANG_REFERENSI } from '../../../../packages/domain/src/pembayaran-manual.ts';
import {
  sisaTagihan,
  type BagianBayar,
} from '../../../../packages/domain/src/pembayaran-campuran.ts';
import { Bidang } from '../Bidang.tsx';
import { bacaFitur, fiturAktif, type PetaFitur } from '../fitur/baca.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { useSesi } from '../konteks/useSesi.ts';
import { keranjangSekarang, setelKeranjang } from '../kasir/simpanan.ts';
import { keranjangKosong, subtotalKeranjang } from '../kasir/keranjang.ts';
import { nilaiDiskon } from '../../../../packages/domain/src/diskon.ts';
import { Tombol } from '../Tombol.tsx';

/* K-06 Pembayaran + K-07 Konfirmasi & Kembalian (IA §2.2).

   ⛔ SIMPAN SEBELUM CETAK (invariant #3). Layar ini menyimpan penjualan ke
   SQLite lokal lebih dulu; cetak struk dan buka laci adalah efek samping yang
   boleh gagal. Struk bisa dicetak ulang; penjualan yang hilang tidak bisa
   dipulihkan.

   ⛔ FR-C1 — satu order, banyak payment. Bagian NON-TUNAI dikumpulkan lebih
   dulu; tunai selalu menyelesaikan sisanya, karena hanya tunai yang punya
   kembalian. Penjualan baru ditulis saat seluruh tagihan tertutup: order
   `open` yang tidak pernah dibayar akan muncul di laporan dan belum punya
   jalan penutupan (KEP-21, belum dibangun).

   Metode online-only dinonaktifkan saat offline (FR-C3) — belum relevan:
   ketiga metode yang ada semuanya berfungsi tanpa jaringan. */

/** Bentuk layar → bentuk domain. Tunai tidak pernah masuk daftar `bagian`. */
function keBagianDomain(p: Pembayaran): BagianBayar {
  return {
    metode: p.metode,
    nominal: p.metode === 'cash' ? undefined : p.nominal,
    tendered: p.metode === 'cash' ? BigInt(p.tendered) : undefined,
  };
}

function rupiah(n: number | bigint): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

/* Pecahan uang kertas Indonesia yang benar-benar dipakai.

   Kasir menerima uang lalu menekan pecahannya, bukan mengetik nominal.
   Itu menghilangkan salah ketik nol pada angka yang menentukan kembalian. */
const PECAHAN = [2000, 5000, 10000, 20000, 50000, 100000];

/* Nama metode di LAYAR — bukan di struk. Struk memakai `labelMetode`
   (`cetak/metode.ts`), yang namanya sengaja lebih pendek karena berbagi baris
   32 kolom dengan nominalnya. */
/* ⛔ `qris_dynamic` ADA di daftar ini meski ia satu-satunya yang tidak dapat
   dipakai offline. `spec-c:272`: metode online-only "TIDAK disembunyikan —
   kasir harus tahu metode itu ada dan mengapa tidak bisa dipakai". Daftar yang
   memendek diam-diam terbaca seperti merchant yang tidak menerima QRIS sama
   sekali, dan kasir tidak punya cara membedakannya. */
const METODE_TERLIHAT = ['cash', 'qris_dynamic', 'qris_static', 'card_edc'] as const;

const NAMA_METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS',
  qris_static: 'QRIS statis',
  card_edc: 'Kartu (EDC)',
};

export function Pembayaran({ onKembali }: { onKembali: () => void }) {
  const { db, pemberitahu } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  const [hlc, setHlc] = useState<Hlc | null>(null);
  const [siap, setSiap] = useState(false);
  const [tendered, setTendered] = useState(0);
  /* FR-C1 — metode pembayaran. Ketiganya BERFUNGSI OFFLINE, dan itu yang
     membuat daftarnya berhenti di sini: QRIS dinamis menuntut gateway
     menjawab sebelum lunas (`spec-c:320`), jadi ordernya harus sudah ada di
     server — sementara jalur penjualan ini menulis lokal lebih dulu. */
  const [metode, setMetode] = useState<MetodeBayar>('cash');
  const [referensi, setReferensi] = useState('');
  const [approvalCode, setApprovalCode] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [nominalBagian, setNominalBagian] = useState('');
  /* Bagian NON-TUNAI yang sudah dimasukkan. Tunai tidak pernah masuk daftar
     ini: ia dihitung dari sisa, dan dua bagian tunai tidak menambah informasi
     apa pun (`packages/domain/src/pembayaran-campuran.ts`). */
  const [bagian, setBagian] = useState<Pembayaran[]>([]);
  /* Total yang benar-benar akan tersimpan — dari `hitungKeranjang`, fungsi
     yang SAMA yang `simpanPenjualan` pakai. Menghitungnya sendiri di layar
     berarti kasir membagi angka yang berbeda dari angka yang tersimpan. */
  const [total, setTotal] = useState<bigint | null>(null);
  /* `ARCH:358` — QRIS statis adalah satu-satunya metode digital yang berfungsi
     offline dan satu-satunya yang tidak diverifikasi sistem mana pun. Ia
     permukaan fraud yang paling mungkin perlu dimatikan untuk satu merchant
     tanpa menunggu rilis. */
  const [fitur, setFitur] = useState<PetaFitur>(() => ({}));
  /* FR-C3 — keadaan jangkauan SERVER, bukan `navigator.onLine`. Browser
     melaporkan antarmuka, bukan keterjangkauan: kafe yang Wi-Fi-nya menyala
     dengan uplink mati melaporkan `true`, dan metode online-only yang tampil
     aktif di sana gagal tepat di depan pelanggan. */
  const [jangkauan, setJangkauan] = useState<KeadaanJangkauan>('memeriksa');
  /* FR-C14 — panel tunggu QRIS dinamis, bila sedang berjalan. */
  const [panelQris, setPanelQris] = useState<{
    qrString: string;
    paymentId: string;
    orderId: string;
    draf: DrafTerkirim;
    nominal: bigint;
  } | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [selesai, setSelesai] = useState<Extract<HasilPenjualan, { status: 'tersimpan' }> | null>(null);

  /* ⛔ Pemantau hidup selama layar ini terbuka dan DIHENTIKAN saat ditutup.
     `spec-c:277` menuntut metode aktif kembali tanpa perlu menutup layar —
     itu yang membuat probe berkala ada, bukan sekadar pembacaan sekali. */
  useEffect(() => {
    if (!konfig) return;
    const pantau = pantauJangkauan({
      baseUrl: konfig.baseUrl,
      pasangPendengar: (nama, fn) => {
        window.addEventListener(nama, fn);
        return () => window.removeEventListener(nama, fn);
      },
    });
    setJangkauan(pantau.keadaan());
    const lepas = pantau.langgan(setJangkauan);
    return () => {
      lepas();
      pantau.hentikan();
    };
  }, [konfig]);

  /* FR-C14 (`spec-c:328`) — draf yang tertinggal DIPULIHKAN saat layar dibuka.
     "Aplikasi mati di tengah polling → setelah restart, payment masih
     `pending_confirmation` dan polling dilanjutkan."

     ⛔ Tanpa ini, tab yang ter-refresh membuat kasir kehilangan seluruh jejak
     transaksi yang pelanggannya mungkin SUDAH bayar — dan satu-satunya yang
     tahu adalah server. */
  useEffect(() => {
    if (!shift || panelQris !== null || total === null) return;
    let hidup = true;
    void pulihkanDraf(db, shift.id).then((d) => {
      if (!hidup || d === null || d.qrString === null) return;
      setPanelQris({
        qrString: d.qrString,
        paymentId: d.paymentId,
        orderId: d.orderId,
        draf: d.draf,
        nominal: total,
      });
    });
    return () => {
      hidup = false;
    };
  }, [db, shift, total, panelQris]);

  const keranjang = keranjangSekarang();
  const subtotal = subtotalKeranjang(keranjang);

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const k = await bacaKonfigPerangkat(db);
      if (!hidup) return;
      setKonfig(k);
      const s = k ? await shiftAktif(db, k.deviceId) : null;
      if (!hidup) return;
      setShift(s);
      // HLC melanjutkan dari keadaan tersimpan — bukan instance baru tiap
      // boot, yang akan membuat setiap order berikutnya ber-HLC lebih kecil
      // daripada yang sudah ada.
      const h = await muatHlc(db, () => Date.now());
      if (!hidup) return;
      setHlc(h);
      setFitur(await bacaFitur(db));
      if (!hidup) return;
      if (k && s && keranjangSekarang().baris.length > 0) {
        const hitung = await hitungKeranjang({
          db,
          konfig: k,
          keranjang: keranjangSekarang(),
          shift: s,
          waktu: () => new Date(),
        });
        if (!hidup) return;
        setTotal(hitung.totals.total);
      }
      setSiap(true);
    })();
    return () => {
      hidup = false;
    };
  }, [db]);

  if (!siap) return <EmptyState title="Menyiapkan pembayaran" body="Membaca data perangkat." />;

  /* K-07 — konfirmasi & kembalian.

     Angka kembalian memakai `--text-display` (aturan design system: angka
     terbesar di layar), karena itu satu-satunya angka yang kasir dan
     pelanggan baca bersamaan. */
  /* FR-C14 — panel tunggu menggantikan seluruh layar. Kasir tidak boleh dapat
     mengubah keranjang atau metode sementara pelanggan sedang memindai QR
     untuk nominal yang sudah dikirim ke gateway. */
  if (panelQris && konfig && sesi) {
    return (
      <PanelQris
        kirim={buatPemanggilApi(konfig, sesi.userId)}
        qrString={panelQris.qrString}
        paymentId={panelQris.paymentId}
        orderId={panelQris.orderId}
        nominal={panelQris.nominal}
        onSelesai={(h) => {
          if (h.status === 'lunas') {
            selesaikanQris(panelQris.draf);
            return;
          }
          if (h.status === 'batal') {
            void bersihkanDraf(db);
            setPanelQris(null);
            setGalat('Transaksi dibatalkan. Stok sudah dikembalikan.');
            return;
          }
          /* ⛔ "Ditunda" TIDAK membersihkan draf lokal. Ia satu-satunya jejak
             perangkat bahwa QR pernah diminta, dan pelanggan mungkin sedang
             memindainya. Menghapusnya berarti kasir kehilangan tombol
             "Cek status" untuk uang yang mungkin sudah masuk. */
          setPanelQris(null);
          setGalat(
            'Pembayaran QRIS masih menunggu konfirmasi. Ia tetap tercatat di server dan ' +
              'dapat dicek lagi.'
          );
        }}
      />
    );
  }

  if (selesai) {
    return (
      <div className="kasir-shift">
        <p className="t-body-md kasir-login-sub">Kembalian</p>
        <p className="t-display num">{rupiah(selesai.kembalian)}</p>

        <p className="t-body-md">
          {selesai.receiptNumber} · dibayar <span className="num">{rupiah(selesai.amountDue)}</span>
        </p>
        {selesai.roundingAdjustment !== 0n && (
          <p className="t-caption kasir-login-sub num">
            Pembulatan {selesai.roundingAdjustment > 0n ? '+' : '−'}
            {rupiah(
              selesai.roundingAdjustment > 0n ? selesai.roundingAdjustment : -selesai.roundingAdjustment
            )}
          </p>
        )}

        <p className="t-caption kasir-login-sub">
          Penjualan tersimpan di perangkat ini dan terkirim sendiri saat internet kembali.
        </p>

        <Tombol
          varian="primary"
          kritis
          onClick={() => {
            // ⛔ `keranjangKosong()`, bukan `{ baris: [] }`: transaksi baru
            // tidak boleh mewarisi diskon — apalagi persetujuan manajer —
            // milik pelanggan sebelumnya.
            setelKeranjang(keranjangKosong());
            onKembali();
          }}
        >
          Transaksi Baru
        </Tombol>
      </div>
    );
  }

  if (!konfig || !shift || !sesi || !hlc) {
    return (
      <EmptyState
        title="Belum siap menerima pembayaran"
        body="Perangkat, shift, atau sesi kasir belum lengkap."
      />
    );
  }

  if (keranjang.baris.length === 0) {
    return (
      <div className="kasir-shift">
        <h1 className="t-title">Keranjang kosong</h1>
        <Tombol varian="primary" kritis onClick={onKembali}>
          Kembali ke kasir
        </Tombol>
      </div>
    );
  }

  /* Sisa tagihan sesudah bagian yang sudah dimasukkan (AC FR-C1 kedua).
     `null` selama total belum terbaca — layar TIDAK menebaknya dari subtotal:
     subtotal belum kena pajak, dan angka yang dibagi kasir harus angka yang
     benar-benar akan ditagihkan. */
  const sisa = total === null ? null : sisaTagihan(total, bagian.map(keBagianDomain));

  const nominalKetik = nominalBagian.trim() === '' ? null : BigInt(nominalBagian.replace(/\D/g, '') || '0');

  const bagianBaru = (): Pembayaran | null => {
    if (metode === 'cash') return { metode: 'cash', tendered };
    // Nominal kosong berarti SELURUH sisa — bentuk yang dipakai pembayaran
    // metode tunggal, dan yang paling sering ditekan.
    const nominal = nominalKetik !== null && nominalKetik > 0n ? nominalKetik : (sisa ?? undefined);
    if (metode === 'qris_static') return { metode, referensi, nominal };
    // ⛔ QRIS dinamis tidak pernah lewat sini: ia dimulai `mulaiQris` dan
    // ditulis `selesaikanQris` dengan `paymentId` dari server. Cabang ini ada
    // supaya tipenya lengkap, bukan supaya ia dapat dipakai.
    if (metode === 'qris_dynamic') return null;
    return { metode, approvalCode, cardLast4: cardLast4 || null, nominal };
  };

  const kosongkanForm = () => {
    setReferensi('');
    setApprovalCode('');
    setCardLast4('');
    setNominalBagian('');
    setTendered(0);
  };

  const tambahBagian = () => {
    const b = bagianBaru();
    if (b === null || b.metode === 'cash') return;
    setBagian((d) => [...d, b]);
    kosongkanForm();
    setGalat(null);
  };

  /* Tombol simpan hidup hanya bila masukan metode ini sudah lengkap.
     ⛔ Ia BUKAN validasi — validasinya milik `simpanPenjualan`, yang memakai
     aturan server. Yang di sini hanya mencegah ketukan yang pasti ditolak;
     dua tempat yang memvalidasi akan menyimpang, dan yang menyimpang membuat
     tombol mati tanpa pesan. */
  const formLengkap =
    metode === 'cash'
      ? tendered > 0
      : metode === 'qris_static'
        ? referensi.trim().length >= MIN_PANJANG_REFERENSI
        : approvalCode.trim().length > 0;

  /* Lunas tanpa tunai: seluruh tagihan sudah tertutup bagian non-tunai. */
  const lunasTanpaTunai = sisa !== null && sisa === 0n && bagian.length > 0;
  const masukanLengkap = lunasTanpaTunai || formLengkap;

  /* FR-C3 — jalur ONLINE-FIRST untuk QRIS dinamis.

     ⛔ Terbalik dari setiap jalur lain di produk ini, dan bukan karena pilihan
     rancangan: `spec-c:320` melarang sistem menandai lunas tanpa konfirmasi
     GATEWAY, dan gateway hanya dapat dihubungi server kami. Perangkat tidak
     punya cara mengetahui pelanggan sudah membayar. */
  const mulaiQris = () => {
    if (!konfig || !shift || !sesi || total === null) return;
    setMenyimpan(true);
    setGalat(null);
    const kirim = buatPemanggilApi(konfig, sesi.userId);
    void (async () => {
      try {
        const { sequence, receiptNumber } = await cadangkanNomor(
          db,
          shift.businessDate,
          konfig.deviceCode
        );
        const d: DrafTerkirim = {
          orderId: crypto.randomUUID(),
          checkId: crypto.randomUUID(),
          receiptNumber,
          sequence,
          businessDate: shift.businessDate,
          paymentIds: [crypto.randomUUID()],
          occurredAt: new Date().toISOString(),
          /* ⛔ HLC di-tick SEKARANG dan dibekukan di draf. Penjualan ini
             TERJADI saat kasir menekan Bayar, bukan saat pelanggan selesai
             memindai — dan dua stempel berbeda untuk satu penjualan membuat
             urutan kausalnya berbeda antara server dan perangkat. */
          hlc: hlc!.tick(),
        };
        const hasil = await mintaQr({
          db,
          kirim,
          konfig,
          shiftId: shift.id,
          keranjang,
          draf: d,
          channel: 'takeaway',
          total,
          idBaru: () => crypto.randomUUID(),
          sekarang: d.occurredAt,
        });
        if (hasil.status !== 'qr') {
          setGalat(
            `${hasil.pesan} Penjualan BELUM tersimpan; nomor struk ${receiptNumber} sudah ` +
              'dicadangkan dan tercatat sebagai dibatalkan.'
          );
          if (hasil.paymentId === null) await bersihkanDraf(db);
          return;
        }
        setPanelQris({
          qrString: hasil.qrString,
          paymentId: hasil.paymentId,
          orderId: d.orderId,
          draf: d,
          nominal: total,
        });
      } catch (e) {
        setGalat(`QRIS tidak dapat dimulai: ${(e as Error).message}`);
      } finally {
        setMenyimpan(false);
      }
    })();
  };

  /* Dipanggil saat gateway mengonfirmasi. Penjualan ditulis LOKAL di sini —
     satu transaksi, invariant #1 utuh — dengan identitas draf yang server
     sudah pegang, dan TANPA mengisi outbox. */
  const selesaikanQris = (draf: DrafTerkirim) => {
    setMenyimpan(true);
    void simpanPenjualan({
      db,
      konfig: konfig!,
      sesi: sesi!,
      shift: shift!,
      keranjang,
      // ⛔ `qris_dynamic`, BUKAN `qris_static`. Keduanya "QRIS" di mata kasir
      // dan sangat berbeda di mata laporan: `qris_static` menandai
      // `confirmed_manually`, dan FR-G5 memakainya sebagai sinyal exception.
      // Menulis pembayaran yang GATEWAY konfirmasi sebagai dikonfirmasi-manual
      // menuduh kasir atas kontrol yang justru berjalan.
      pembayaran: [{ metode: 'qris_dynamic', paymentId: draf.paymentIds[0] }],
      waktu: () => new Date(),
      idBaru: () => crypto.randomUUID(),
      hlc: () => hlc!.tick(),
      draf,
    })
      .then(async (hasil) => {
        await bersihkanDraf(db);
        pemberitahu.beritahu();
        if (hasil.status === 'tersimpan') {
          setPanelQris(null);
          setSelesai(hasil);
          return;
        }
        setGalat('Pembayaran lunas di server, tetapi penjualan gagal ditulis di perangkat.');
      })
      .catch((e: Error) => setGalat(`Penjualan TIDAK tersimpan: ${e.message}`))
      .finally(() => setMenyimpan(false));
  };

  const bayar = () => {
    setMenyimpan(true);
    setGalat(null);
    void simpanPenjualan({
      db,
      konfig,
      sesi,
      shift,
      keranjang,
      // ⛔ Bagian tunai IKUT hanya bila kasir benar-benar memasukkannya.
      // Bagian tunai ber-`tendered: 0` pada transaksi yang sudah lunas lewat
      // QRIS akan ditulis sebagai baris payment bernilai nol — baris yang
      // mengaku ada dan tidak memindahkan apa pun.
      pembayaran: lunasTanpaTunai ? bagian : [...bagian, bagianBaru()!],
      waktu: () => new Date(),
      idBaru: () => crypto.randomUUID(),
      // I10 dijamin: HLC melanjutkan dari `device_config.hlc_state`, tidak
      // turun saat jam perangkat mundur, dan keadaannya disimpan di dalam
      // transaksi penjualan yang sama.
      hlc: () => hlc!.tick(),
    })
      .then((hasil) => {
        if (hasil.status === 'tersimpan') {
          setSelesai(hasil);
          // Indikator sinkronisasi harus bergerak SEKARANG, bukan setelah
          // `watch()` PowerSync menyadarinya ~1.000 ms kemudian (`spec-h:224`).
          pemberitahu.beritahu();
          return;
        }
        if (hasil.status === 'kurang_bayar') {
          setGalat(`Kurang ${rupiah(hasil.kurang)}. Total ${rupiah(hasil.amountDue)}.`);
          return;
        }
        if (hasil.status === 'pembayaran_tidak_sah') {
          /* ⛔ Pesan SERVER, kata demi kata — aturannya satu sumber
             (`packages/domain/src/pembayaran-manual.ts`). Menulis ulang
             kalimatnya di sini berarti kasir membaca dua penjelasan berbeda
             untuk penolakan yang sama, tergantung apakah ia sedang online. */
          setGalat(`${hasil.pesan} Penjualan belum tersimpan.`);
          return;
        }
        if (hasil.status === 'butuh_penyetuju_diskon') {
          /* ⛔ Penjualan TIDAK ditulis, dan layar mengatakannya. Kasir yang
             hanya membaca "gagal" akan menekan Bayar lagi; yang membaca
             kalimat ini tahu bahwa yang harus terjadi berikutnya ada di K-03,
             bukan di sini. */
          setGalat(
            `Diskon ${rupiah(hasil.nominal)} melewati batas dan belum disetujui manajer. ` +
              'Penjualan belum tersimpan — kembali ke kasir untuk meminta persetujuan.'
          );
          return;
        }
        setGalat('Keranjang kosong.');
      })
      .catch((e: Error) => setGalat(`Penjualan TIDAK tersimpan: ${e.message}`))
      .finally(() => setMenyimpan(false));
  };

  return (
    <div className="kasir-shift">
      <h1 className="t-title">Pembayaran</h1>

      {/* FR-C1 — pemilih metode. `IA:65` menempatkannya di K-06.

          ⛔ TIDAK ada QRIS dinamis di sini, dan ketiadaannya disengaja: ia
          online-only, dan menampilkannya lalu menonaktifkannya saat offline
          (FR-C3) menuntut metode itu ADA lebih dulu. */}
      <div className="kasir-pecahan">
        {METODE_TERLIHAT.filter(
          (m) => m !== 'qris_static' || fiturAktif(fitur, 'pembayaran_qris_statis')
        ).map((m) => {
          const alasan = alasanNonaktif(m, jangkauan);
          return (
            <div key={m} className="stack" style={{ gap: 'var(--space-1)' }}>
              <Tombol
                varian={metode === m ? 'primary' : 'secondary'}
                kritis
                disabled={menyimpan || alasan !== null}
                onClick={() => {
                  setMetode(m);
                  setGalat(null);
                }}
              >
                {NAMA_METODE[m]}
              </Tombol>
              {/* ⛔ Status TIDAK PERNAH warna saja (aturan design system #5),
                  dan `spec-c:271` menuntut teksnya secara eksplisit. Tombol
                  yang mati tanpa penjelasan adalah tombol yang kasir simpulkan
                  rusak — lalu ia berhenti mempercayai layar ini. */}
              {alasan !== null && <span className="t-caption">{alasan}</span>}
            </div>
          );
        })}
      </div>
      <p className="t-body-md kasir-login-sub">
        Subtotal <span className="num">{rupiah(subtotal)}</span> · pajak dan pembulatan dihitung saat
        disimpan
      </p>

      {/* FR-B8 — potongan ikut terlihat di layar yang menyebut uang diterima.
          Nominalnya diturunkan dari permintaan yang sama yang akan disimpan
          (`nilaiDiskon`), bukan diketik ulang di sini. */}
      {keranjang.diskon !== null && (
        <p className="t-body-md kasir-login-sub">
          Diskon <span className="num">− {rupiah(nilaiDiskon(subtotal, keranjang.diskon.minta))}</span>
        </p>
      )}

      {/* FR-C1 — bagian yang sudah dimasukkan, dan sisa tagihannya.
          AC kedua menuntut sisa tagihan TERLIHAT; kasir yang tidak melihatnya
          harus menghitung sendiri di depan pelanggan. */}
      {bagian.length > 0 && (
        <div className="kasir-baris-daftar">
          {bagian.map((b, i) => (
            <div key={`${b.metode}-${i}`} className="kasir-subtotal">
              <span className="t-body-md">{NAMA_METODE[b.metode]}</span>
              <span className="t-body-md num">
                {rupiah(b.metode === 'cash' ? b.tendered : (b.nominal ?? 0n))}
              </span>
              <Tombol
                varian="ghost"
                disabled={menyimpan}
                onClick={() => {
                  setBagian((d) => d.filter((_, j) => j !== i));
                  setGalat(null);
                }}
              >
                Hapus
              </Tombol>
            </div>
          ))}
        </div>
      )}

      {sisa !== null && (
        <div className="kasir-subtotal">
          <span className="t-body-md">{sisa === 0n ? 'Lunas' : 'Sisa tagihan'}</span>
          <span className="t-title num">{rupiah(sisa)}</span>
        </div>
      )}

      {metode === 'cash' && !lunasTanpaTunai && (
        <>
          <p className="t-body-md">Uang diterima</p>
          <p className="t-display num">{rupiah(tendered)}</p>

          <div className="kasir-pecahan">
            {PECAHAN.map((p) => (
              <Tombol key={p} kritis disabled={menyimpan} onClick={() => setTendered((t) => t + p)}>
                + {rupiah(p)}
              </Tombol>
            ))}
            <Tombol
              varian="ghost"
              kritis
              disabled={menyimpan || tendered === 0}
              onClick={() => setTendered(0)}
            >
              Hapus
            </Tombol>
          </div>
        </>
      )}

      {/* FR-C2 — QRIS statis. Referensi WAJIB, dan layar mengatakan kenapa:
          tidak ada sistem yang memverifikasi pembayaran ini, jadi tanpa
          referensi "sudah dibayar" hanyalah pernyataan kasir tanpa jejak yang
          dapat dicocokkan dengan mutasi bank. */}
      {/* Nominal bagian — kosong berarti SELURUH sisa, bentuk yang paling
          sering ditekan. Ia hanya muncul untuk non-tunai: nominal tunai
          diturunkan dari sisa dan dibulatkan (`spec-c:181`), jadi mengetiknya
          akan memberi kasir dua angka yang harus dijaga sepakat. */}
      {metode !== 'cash' && !lunasTanpaTunai && (
        <Bidang
          label="Nominal bagian ini (kosongkan untuk seluruh sisa)"
          inputMode="numeric"
          value={nominalBagian}
          onChange={(v) => {
            setNominalBagian(v.replace(/\D/g, ''));
            setGalat(null);
          }}
          placeholder={sisa === null ? '' : String(sisa)}
        />
      )}

      {metode === 'qris_static' && !lunasTanpaTunai && (
        <>
          <p className="t-body-md">
            Tagihan <span className="num">{rupiah(subtotal)}</span> + pajak. Pelanggan memindai QR
            cetak di meja kasir.
          </p>
          <Bidang
            label="Referensi pembayaran"
            value={referensi}
            onChange={(v) => {
              setReferensi(v);
              setGalat(null);
            }}
            placeholder="Nominal + 4 digit terakhir nomor referensi"
            hint="Wajib. Tidak ada sistem yang memverifikasi QRIS statis — referensi ini satu-satunya jejaknya."
          />
        </>
      )}

      {/* FR-C4 — EDC. Mesinnya terpisah; yang mengonfirmasi struk terminal. */}
      {metode === 'card_edc' && !lunasTanpaTunai && (
        <>
          <Bidang
            label="Kode approval"
            value={approvalCode}
            onChange={(v) => {
              setApprovalCode(v);
              setGalat(null);
            }}
            placeholder="Dari struk mesin EDC"
            hint="Wajib. Tanpa kode approval, pembayaran kartu tidak dapat dicocokkan dengan settlement acquirer."
          />
          <Bidang
            label="4 digit terakhir kartu (opsional)"
            inputMode="numeric"
            value={cardLast4}
            onChange={(v) => {
              // ⛔ Dipotong DI SINI, di titik masuknya. Kolomnya bernama
              // `card_last4` dan larangan nomor kartu di repo ini permanen —
              // membiarkan digit kelima masuk state, meski nanti ditolak,
              // berarti nomor kartu sempat ada di dalam aplikasi.
              setCardLast4(v.replace(/\D/g, '').slice(0, 4));
              setGalat(null);
            }}
            placeholder="1234"
          />
        </>
      )}

      <div className="kasir-pecahan">
        {/* ⛔ `ghost`: aksi utama layar ini tetap Simpan Penjualan. Menambah
            bagian adalah langkah antara, bukan tujuannya. */}
        {metode !== 'cash' && !lunasTanpaTunai && (
          <Tombol varian="ghost" kritis disabled={menyimpan || !formLengkap} onClick={tambahBagian}>
            Tambah pembayaran lain
          </Tombol>
        )}
        <Tombol varian="ghost" kritis disabled={menyimpan} onClick={onKembali}>
          Kembali
        </Tombol>
      </div>

      {galat && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galat}
        </p>
      )}

      <Tombol
        varian="primary"
        kritis
        disabled={menyimpan || (metode === 'qris_dynamic' ? bagian.length > 0 : !masukanLengkap)}
        onClick={metode === 'qris_dynamic' ? mulaiQris : bayar}
      >
        {menyimpan ? 'Menyimpan…' : 'Simpan Penjualan'}
      </Tombol>
    </div>
  );
}
