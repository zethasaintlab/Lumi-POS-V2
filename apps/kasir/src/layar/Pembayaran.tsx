import { useEffect, useRef, useState } from 'react';
import { pantauJangkauan, type KeadaanJangkauan } from '../lokal/keterjangkauan.ts';
import {
  alasanNonaktif,
  PROVIDER_TRANSFER,
  periksaTransfer,
} from '../../../../packages/domain/src/pembayaran-manual.ts';
import { labelMetode } from '../../../../packages/domain/src/metode-tampilan.ts';
import { setelKunciNav } from '../rute/kunci-nav.ts';
import { PanelQris } from '../komponen/PanelQris.tsx';
import { buatPemanggilApi } from '../lokal/api.ts';
import {
  cadangkanNomor,
  bersihkanDraf,
  mintaQr,
  pulihkanDraf,
} from '../kasir/qris-dinamis.ts';
import type { DrafTerkirim } from '../kasir/penjualan.ts';
import { EmptyState, Icon, potongSentuh } from 'ds';
import { cetakUlangOrder, kalimatCetak } from '../cetak/cetak-ulang.ts';
import { Memuat } from '../komponen/Memuat.tsx';
import { GagalBaca } from '../komponen/GagalBaca.tsx';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { shiftAktif, type ShiftAktif } from '../kas/shift.ts';
import { muatHlc } from '../lokal/hlc.ts';
import type { Hlc } from '../../../../packages/domain/src/hlc.ts';
import {
  hitungKeranjang,
  type HitunganKeranjang,
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
import { bacaRupiah, rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

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

/* ⛔ Tab pemilih metode, dikunci per TAB — bukan per kode metode (G-LABEL).
   Empat tab mockup `Payment`; "Transfer" bukan metode kolom `payment.method`
   melainkan `other` + `provider='bank_transfer'` (keputusan user P1), jadi
   satu tab tidak sama dengan satu kode. Nama metode di DAFTAR BAGIAN datang
   dari `labelMetode` domain, bukan peta di berkas ini. */
export const TAB_BAYAR = [
  { tab: 'tunai', label: 'Tunai' },
  { tab: 'qris', label: 'QRIS' },
  { tab: 'kartu', label: 'Kartu' },
  { tab: 'transfer', label: 'Transfer' },
] as const;
type TabBayar = (typeof TAB_BAYAR)[number]['tab'];

/* Sub-pilihan di dalam tab QRIS. ⛔ `qris_dynamic` TETAP terlihat saat tak
   terjangkau, nonaktif dengan alasannya (`spec-c:272`): daftar yang memendek
   diam-diam terbaca seperti merchant yang tidak menerima QRIS. */
const SUB_QRIS = [
  { metode: 'qris_dynamic', label: 'QRIS dinamis' },
  { metode: 'qris_static', label: 'QRIS statis' },
] as const;

/* Pintasan tunai persis mockup (keputusan user 28 September 2026): tiga
   nominal yang MENETAPKAN kolom "Nominal diterima", bukan enam pecahan yang
   menambah. Dengan kolom nominal bebas di atasnya, ini cukup. */
export const PINTASAN_TUNAI = [20_000, 50_000, 100_000] as const;

export function Pembayaran({ onKembali }: { onKembali: () => void }) {
  const { db, pemberitahu } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  const [hlc, setHlc] = useState<Hlc | null>(null);
  const [siap, setSiap] = useState(false);
  const [gagalMuat, setGagalMuat] = useState<string | null>(null);
  /* ⛔ "Nominal diterima" menyimpan TEKS, dibaca `bacaRupiah` (`null` untuk
     kosong/cacat) — pola K-12. Menyimpan angka mengubah kolom kosong menjadi
     0, dan 0 yang lahir dari kolom kosong adalah penjualan yang menyimpan
     tendered 0. */
  const [nominalTunai, setNominalTunai] = useState('');
  /* FR-C1 — metode pembayaran. Ketiganya BERFUNGSI OFFLINE, dan itu yang
     membuat daftarnya berhenti di sini: QRIS dinamis menuntut gateway
     menjawab sebelum lunas (`spec-c:320`), jadi ordernya harus sudah ada di
     server — sementara jalur penjualan ini menulis lokal lebih dulu. */
  const [tab, setTab] = useState<TabBayar>('tunai');
  const [subQris, setSubQris] = useState<'qris_dynamic' | 'qris_static' | null>(null);
  const [bankTujuan, setBankTujuan] = useState('');
  /* Pembayaran campuran dibuka lewat tautan kecil di kartu (keputusan bawaan
     #4), tidak ada di tampilan bawaan. */
  const [campuran, setCampuran] = useState(false);
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
  /* ⛔ Hitungan LENGKAP, untuk baris pajak dan Total di blok aksi. `total` di
     atas sengaja dibiarkan apa adanya: ia dibaca jalur pembayaran, dan
     menurunkannya dari state kedua berarti dua tempat yang memutuskan angka
     yang ditagihkan. Yang di bawah ini hanya dibaca layar. */
  const [hitungan, setHitungan] = useState<HitunganKeranjang | null>(null);
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
  /* ⛔ Penjaga ketukan ganda yang SINKRON. `menyimpan` adalah state — ia baru
     terbaca setelah render, dan dua ketukan yang jatuh sebelum render itu
     menyimpan DUA penjualan. Ref dibaca di titik masuk `bayar`. */
  const sedangMenyimpan = useRef(false);
  // K-07 — cetak ulang dari layar konfirmasi (FR-B11).
  const [mencetakUlang, setMencetakUlang] = useState(false);
  const [pesanCetakUlang, setPesanCetakUlang] = useState<string | null>(null);
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

  /* ⛔ Kunci tab nav header + tab metode selama QRIS menunggu atau penjualan
     disimpan: meninggalkan layar di tengahnya menghapus nominal yang sudah
     diketik, dan untuk QRIS melepas layar yang sedang ditunggu pelanggan.
     Dilepas saat layar ini dilepas — kunci yang tertinggal membekukan seluruh
     navigasi kasir. Hook ini di ATAS return awal, aturan hook. */
  const alasanKunci: string | null =
    panelQris !== null
      ? 'Pembayaran QRIS sedang menunggu. Metode tidak dapat diganti dan layar tidak dapat ditinggalkan sampai pelanggan membayar atau transaksi dibatalkan.'
      : menyimpan
        ? 'Penjualan sedang disimpan. Tunggu sampai selesai.'
        : null;
  useEffect(() => {
    setelKunciNav(alasanKunci);
  }, [alasanKunci]);
  useEffect(() => () => setelKunciNav(null), []);

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
        setHitungan(hitung);
      }
      setSiap(true);
    })().catch((e: Error) => {
      /* ⛔ Layar ini berdiri di depan pelanggan yang sedang menunggu membayar.
         Penanda memuat yang tidak pernah berubah membuat kasir menutup
         aplikasi — dan keranjang yang sudah dihitung ikut hilang bersamanya. */
      if (!hidup) return;
      setGagalMuat(e.message);
      setSiap(true);
    });
    return () => {
      hidup = false;
    };
  }, [db]);

  if (!siap) return <Memuat judul="Menyiapkan pembayaran…" bentuk="blok" jumlah={4} />;

  if (gagalMuat) {
    return <GagalBaca akibat="Pembayaran tidak dapat diselesaikan di perangkat ini; jangan terima uang sebelum masalahnya selesai." pesan={gagalMuat} />;
  }

  /* K-07 — konfirmasi & kembalian.

     Angka kembalian memakai `--text-display` (aturan design system: angka
     terbesar di layar), karena itu satu-satunya angka yang kasir dan
     pelanggan baca bersamaan. */
  /* Tab yang tampil. Kill switch mematikan tab SEKALIAN (bukan menonaktifkan):
     `pembayaran_transfer` mati → tab Transfer hilang, tunai tetap ada. QRIS
     statis yang mati hanya menghilangkan sub-pilihannya (`ARCH:358`). */
  const tabTampil: readonly TabBayar[] = TAB_BAYAR.filter(
    (t) => t.tab !== 'transfer' || fiturAktif(fitur, 'pembayaran_transfer')
  ).map((t) => t.tab);

  /* FR-C14 — panel tunggu QRIS di DALAM kartu. ⛔ Keputusan kampanye Hidupkan
     desain (26 September 2026, spec § 7): menggantikan "panel mengganti layar
     penuh" — pemilih metode TETAP ada tetapi setiap tab terkunci dengan
     alasan; "Kembali ke kasir" dan tautan campuran TIDAK dirender; tombol
     utama tampil di tempat yang sama, nonaktif, "Menunggu pembayaran…" —
     konfirmasi hanya datang dari gateway (`spec-c:320`), tidak ada jalur
     ketukan yang menandai lunas. Kasir tidak boleh dapat mengubah keranjang
     atau metode sementara pelanggan memindai QR untuk nominal yang sudah
     dikirim ke gateway. */
  if (panelQris && konfig && sesi) {
    return (
      <HalamanBayar terkunci onKembali={onKembali}>
        <div className="kasir-bayar-isi">
          <BlokTotal total={hitungan?.totals.total ?? panelQris.nominal} />
          <PemilihTab tab="qris" tabTampil={tabTampil} terkunci onPilih={() => undefined} />
          <p id="bayar-kunci-alasan" className="t-caption kasir-login-sub">
            {alasanKunci}
          </p>
          <div className="kasir-bayar-metode">
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
                /* ⛔ "Ditunda" TIDAK membersihkan draf lokal. Ia satu-satunya
                   jejak perangkat bahwa QR pernah diminta, dan pelanggan
                   mungkin sedang memindainya. Menghapusnya berarti kasir
                   kehilangan tombol "Cek status" untuk uang yang mungkin sudah
                   masuk. */
                setPanelQris(null);
                setGalat(
                  'Pembayaran QRIS masih menunggu konfirmasi. Ia tetap tercatat di server dan ' +
                    'dapat dicek lagi.'
                );
              }}
            />
          </div>
        </div>
        <div className="kasir-bayar-aksi">
          <div className="kasir-bayar-baris">
            <Tombol varian="primary" kritis disabled>
              Menunggu pembayaran…
            </Tombol>
          </div>
        </div>
      </HalamanBayar>
    );
  }

  if (selesai) {
    /* K-07 tetap overlay 536 px sampai PR 2D (spec § 8) — hanya K-06 yang
       berpindah ke halaman di dalam shell. */
    return (
      <div className="overlay kasir-overlay-bayar" role="dialog" aria-modal="true" aria-label="Pembayaran">
        <div className="dialog kasir-overlay-lebar">
      <div className="kasir-shift kasir-k07">
        {/* Rebuild UI Fase 3.3, mengikuti mockup: ikon + judul di atas angka.
            Ikonnya berlatar `--success-soft` dan disertai judul (DS #5: status
            tidak pernah warna saja). */}
        <span className="kasir-k07-ikon" aria-hidden="true">
          <Icon name="check" size={28} />
        </span>
        <h2 className="t-title">Transaksi selesai</h2>

        {/* ⛔ Angka kembalian TETAP warna teks. Mockup mewarnainya aksen, dan
            aksen adalah warna AKSI (DS #2) — ia bersaing dengan Transaksi Baru.
            Yang dikejar panelnya, dari token yang sudah ada. */}
        <div className="kasir-k07-kembalian">
          <p className="t-body-md">Kembalian</p>
          <p className="t-display num">{rupiah(selesai.kembalian)}</p>
        </div>

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

        {/* ⛔ Hasil cetak pertama DIBACA di sini. `simpanPenjualan`
            mengembalikannya justru supaya layar dapat berkata "struk gagal
            dicetak, transaksi tersimpan" (invariant #3) — sampai Fase 3.3 K-07
            tidak pernah merendernya, jadi kertas habis tidak terlihat di mana
            pun. Teks, bukan hanya warna, dan tidak menghilang sendiri. */}
        <p className="t-caption" role="status" data-cetak="pertama">
          {kalimatCetak(selesai.cetak, false)}
        </p>
        {pesanCetakUlang && (
          <p className="t-caption" role="status" data-cetak="ulang">
            {pesanCetakUlang}
          </p>
        )}

        <div className="kasir-bayar-baris">
          {/* FR-B11 — jalur cetak ulang yang SAMA dengan K-09. */}
          <Tombol
            kritis
            disabled={mencetakUlang || !konfig}
            onClick={() => {
              if (!konfig) return;
              setMencetakUlang(true);
              void cetakUlangOrder(db, selesai.orderId, konfig.outletId)
                .then((h) => setPesanCetakUlang(kalimatCetak(h, true)))
                .catch((e: Error) => setPesanCetakUlang(`Gagal mencetak: ${e.message}`))
                .finally(() => setMencetakUlang(false));
            }}
          >
            {mencetakUlang ? 'Mencetak…' : 'Cetak ulang struk'}
          </Tombol>
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
      </div>
        </div>
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

  /* Metode yang AKTIF diturunkan dari tab (+ sub-pilihan QRIS), bukan state
     ketiga yang harus dijaga sepakat dengan keduanya. QRIS statis yang
     dimatikan kill switch jatuh ke dinamis. */
  const statisAktif = fiturAktif(fitur, 'pembayaran_qris_statis');
  const dinamisTersedia = alasanNonaktif('qris_dynamic', jangkauan) === null;
  const subAktif: 'qris_dynamic' | 'qris_static' =
    subQris === 'qris_static' && !statisAktif
      ? 'qris_dynamic'
      : (subQris ?? (dinamisTersedia || !statisAktif ? 'qris_dynamic' : 'qris_static'));
  const metode: MetodeBayar =
    tab === 'tunai' ? 'cash' : tab === 'qris' ? subAktif : tab === 'kartu' ? 'card_edc' : 'other';

  /* ⛔ `bacaRupiah`, bukan `Number()`/`replace(/\D/g, '')`: kosong atau cacat
     (`25.5`) adalah `null`, bukan 0 — dan nominal diterima 0 yang lahir dari
     kolom kosong adalah penjualan yang menyimpan tendered 0. */
  const tenderedBaca = bacaRupiah(nominalTunai);
  const nominalKetik = nominalBagian.trim() === '' ? null : BigInt(nominalBagian.replace(/\D/g, '') || '0');

  const bagianBaru = (): Pembayaran | null => {
    if (metode === 'cash') return tenderedBaca === null ? null : { metode: 'cash', tendered: tenderedBaca };
    // Nominal kosong berarti SELURUH sisa — bentuk yang dipakai pembayaran
    // metode tunggal, dan yang paling sering ditekan.
    const nominal = nominalKetik !== null && nominalKetik > 0n ? nominalKetik : (sisa ?? undefined);
    if (metode === 'qris_static') return { metode, referensi, nominal };
    // ⛔ QRIS dinamis tidak pernah lewat sini: ia dimulai `mulaiQris` dan
    // ditulis `selesaikanQris` dengan `paymentId` dari server. Cabang ini ada
    // supaya tipenya lengkap, bukan supaya ia dapat dipakai.
    if (metode === 'qris_dynamic') return null;
    // Transfer: other + bank_transfer (keputusan user P1); validasinya
    // `periksaTransfer` domain, dipakai juga `simpanPenjualan` dan server.
    if (metode === 'other') {
      return { metode, provider: PROVIDER_TRANSFER, referensi, bank: bankTujuan.trim() || null, nominal };
    }
    return { metode, approvalCode, cardLast4: cardLast4 || null, nominal };
  };

  const kosongkanForm = () => {
    setReferensi('');
    setApprovalCode('');
    setCardLast4('');
    setBankTujuan('');
    setNominalBagian('');
    setNominalTunai('');
  };

  const tambahBagian = () => {
    const b = bagianBaru();
    if (b === null || b.metode === 'cash') return;
    setBagian((d) => [...d, b]);
    kosongkanForm();
    setGalat(null);
  };

  /* Lunas tanpa tunai: seluruh tagihan sudah tertutup bagian non-tunai. */
  const lunasTanpaTunai = sisa !== null && sisa === 0n && bagian.length > 0;

  /* ⛔ Alasan "belum dapat dikonfirmasi" DITULIS di layar, dan
     `aria-describedby` tombol menunjuk ke sana. Tombol mati tanpa penjelasan
     membuat kasir menyimpulkan aplikasinya rusak. Yang di sini BUKAN validasi
     — validasinya milik `simpanPenjualan`, yang memakai aturan server; ia
     hanya mencegah ketukan yang pasti ditolak. Transfer memakai kalimat
     `periksaTransfer` apa adanya (satu sumber dengan server). */
  const alasanBelumLengkap: string | null = (() => {
    if (metode === 'cash') {
      if (nominalTunai.trim() === '') return 'Isi nominal yang diterima.';
      if (tenderedBaca === null) return 'Nominal harus rupiah utuh, tanpa desimal (mis. 50.000).';
      if (tenderedBaca <= 0) return 'Nominal yang diterima harus lebih dari nol.';
      return null;
    }
    if (metode === 'qris_static') {
      return referensi.trim().length >= MIN_PANJANG_REFERENSI
        ? null
        : `Isi referensi pembayaran (minimal ${MIN_PANJANG_REFERENSI} karakter).`;
    }
    if (metode === 'other') return periksaTransfer(referensi, bankTujuan)?.pesan ?? null;
    if (metode === 'card_edc') return approvalCode.trim().length > 0 ? null : 'Isi kode approval dari struk mesin EDC.';
    return null;
  })();
  const formLengkap = alasanBelumLengkap === null;

  const masukanLengkap = lunasTanpaTunai || formLengkap;

  /* Aksi utama: nonaktif dengan alasan tertulis. QRIS dinamis tidak pernah
     "Konfirmasi bayar" — ia meminta kode QR, dan lunasnya hanya dari gateway. */
  const alasanAksi: string | null = menyimpan
    ? null
    : metode === 'qris_dynamic'
      ? bagian.length > 0
        ? 'QRIS dinamis tidak dapat digabung dengan bagian pembayaran lain.'
        : alasanNonaktif('qris_dynamic', jangkauan)
      : masukanLengkap
        ? null
        : alasanBelumLengkap;

  /* FR-C3 — jalur ONLINE-FIRST untuk QRIS dinamis.

     ⛔ Terbalik dari setiap jalur lain di produk ini, dan bukan karena pilihan
     rancangan: `spec-c:320` melarang sistem menandai lunas tanpa konfirmasi
     GATEWAY, dan gateway hanya dapat dihubungi server kami. Perangkat tidak
     punya cara mengetahui pelanggan sudah membayar. */
  const mulaiQris = () => {
    if (!konfig || !shift || !sesi || total === null) return;
    if (sedangMenyimpan.current) return;
    sedangMenyimpan.current = true;
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
        sedangMenyimpan.current = false;
        setMenyimpan(false);
      }
    })();
  };

  /* Dipanggil saat gateway mengonfirmasi. Penjualan ditulis LOKAL di sini —
     satu transaksi, invariant #1 utuh — dengan identitas draf yang server
     sudah pegang, dan TANPA mengisi outbox. */
  const selesaikanQris = (draf: DrafTerkirim) => {
    if (sedangMenyimpan.current) return;
    sedangMenyimpan.current = true;
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
      .finally(() => {
        sedangMenyimpan.current = false;
        setMenyimpan(false);
      });
  };

  const bayar = () => {
    /* ⛔ Ketukan ganda "Konfirmasi bayar" (Review Focus 1): kasir yang
       terburu-buru menekannya dua kali, dan state `menyimpan` baru terbaca
       sesudah render. Penjaga sinkronnya `sedangMenyimpan` — tanpanya dua
       penjualan tersimpan untuk satu pelanggan. */
    if (sedangMenyimpan.current) return;
    const baru = lunasTanpaTunai ? null : bagianBaru();
    if (!lunasTanpaTunai && baru === null) return;
    sedangMenyimpan.current = true;
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
      pembayaran: baru === null ? bagian : [...bagian, baru],
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
      .finally(() => {
        sedangMenyimpan.current = false;
        setMenyimpan(false);
      });
  };

  const terkunciMetode = menyimpan;
  const pilihTab = (t: TabBayar) => {
    /* ⛔ Penjaga di HANDLER, bukan hanya atribut `aria-disabled`. Tab terkunci
       dapat dibuka oleh cacat keadaan React yang tidak akan pernah terjadi pada
       kontrol yang tidak dirender (spec § 14 R3); P1 mengirim klik buatan
       yang melewati atributnya. */
    if (terkunciMetode) return;
    setTab(t);
    setGalat(null);
  };

  return (
    <HalamanBayar terkunci={terkunciMetode} onKembali={onKembali}>
      {/* ⛔ Isi yang MENGGULIR. Semua yang kasir baca dan ketik ada di sini;
          yang ia tekan untuk menyelesaikan transaksi ada di blok aksi di
          bawah, yang tidak pernah ikut bergerak. Pembayaran campuran berisi
          beberapa bagian membuat layar ini lebih tinggi daripada kartunya, dan
          sebelum pembagian ini tombol Bayar terdorong keluar layar tepat pada
          transaksi yang paling rumit. */}
      <div className="kasir-bayar-isi">
        {/* Total dari `hitungan.totals.total` — `hitungKeranjang`, fungsi yang
            SAMA yang `simpanPenjualan` pakai. Tidak pernah dibulatkan. */}
        <BlokTotal total={hitungan?.totals.total ?? null} />

        <PemilihTab tab={tab} tabTampil={tabTampil} terkunci={terkunciMetode} onPilih={pilihTab} />
        {terkunciMetode && (
          <p id="bayar-kunci-alasan" className="t-caption kasir-login-sub">
            {alasanKunci}
          </p>
        )}
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

        {/* FR-C1 — bagian yang sudah dimasukkan, di DALAM kartu yang sama.
            AC kedua menuntut sisa tagihan TERLIHAT (di blok aksi). */}
        {bagian.length > 0 && (
          <div className="kasir-baris-daftar">
            {bagian.map((b, i) => (
              <div key={`${b.metode}-${i}`} className="kasir-subtotal">
                <span className="t-body-md">
                  {labelMetode(b.metode, b.metode === 'other' ? b.provider : null)}
                </span>
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

        <div className="kasir-bayar-metode">
          {tab === 'tunai' && !lunasTanpaTunai && (
            <>
              {/* "Nominal diterima": awalan Rp, rata kanan, dibaca `bacaRupiah`
                  (pola K-12). Tiga pintasan MENETAPKAN nilainya (keputusan
                  user 28 September 2026). Kembalian dan pembulatan TIDAK
                  dirender di sini — Task 8B. */}
              <Bidang
                label="Nominal diterima"
                ukuran="lg"
                awalan="Rp"
                inputMode="numeric"
                value={nominalTunai}
                onChange={(v) => {
                  setNominalTunai(v);
                  setGalat(null);
                }}
                placeholder="mis. 50.000"
              />
              <div className="kasir-pintasan">
                {PINTASAN_TUNAI.map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    className="btn btn-secondary sentuh-uang"
                    style={potongSentuh(
                      [...(i > 0 ? (['kiri'] as const) : []), ...(i < PINTASAN_TUNAI.length - 1 ? (['kanan'] as const) : [])],
                      'var(--space-3)'
                    )}
                    disabled={menyimpan}
                    onClick={() => {
                      /* ⛔ MENETAPKAN, bukan `t + p`: pintasan yang menambah
                         membuat dua ketukan meleset menjadi nominal yang tidak
                         diserahkan pelanggan. */
                      setNominalTunai(rupiah(p).replace(/^Rp\s*/, ''));
                      setGalat(null);
                    }}
                  >
                    {rupiah(p)}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'qris' && (
            <>
              <div className="segmented kasir-sub-qris" role="group" aria-label="Jenis QRIS">
                {SUB_QRIS.filter((q) => q.metode !== 'qris_static' || statisAktif).map((q) => {
                  const alasan = alasanNonaktif(q.metode, jangkauan);
                  return (
                    <button
                      key={q.metode}
                      type="button"
                      aria-pressed={subAktif === q.metode}
                      disabled={menyimpan || alasan !== null}
                      onClick={() => {
                        setSubQris(q.metode);
                        setGalat(null);
                      }}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
              {/* ⛔ Status TIDAK PERNAH warna saja (aturan design system #5),
                  dan `spec-c:271` menuntut teksnya secara eksplisit. Sub-pilihan
                  yang mati tanpa penjelasan adalah yang kasir simpulkan rusak. */}
              {alasanNonaktif('qris_dynamic', jangkauan) !== null && (
                <p className="t-caption kasir-login-sub">
                  QRIS dinamis: {alasanNonaktif('qris_dynamic', jangkauan)}
                </p>
              )}
              {subAktif === 'qris_dynamic' && (
                <p className="t-body-md">
                  Kode QR dibuat saat Anda menekan tombol di bawah, dan pembayaran baru dianggap lunas
                  setelah gateway mengonfirmasi.
                </p>
              )}
              {/* FR-C2 — QRIS statis. Referensi WAJIB, dan layar mengatakan
                  kenapa: tidak ada sistem yang memverifikasi pembayaran ini,
                  jadi tanpa referensi "sudah dibayar" hanyalah pernyataan kasir
                  tanpa jejak yang dapat dicocokkan dengan mutasi bank. */}
              {subAktif === 'qris_static' && !lunasTanpaTunai && (
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
            </>
          )}

          {/* FR-C4 — EDC. Mesinnya terpisah; yang mengonfirmasi struk terminal. */}
          {tab === 'kartu' && !lunasTanpaTunai && (
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

          {/* Transfer (other + bank_transfer, spec-c:244): referensi dari bukti
              transfer WAJIB, bank tujuan opsional. Keduanya diperiksa terhadap
              nomor kartu oleh `periksaTransfer` (`POSSIBLE_CARD_NUMBER`). */}
          {tab === 'transfer' && !lunasTanpaTunai && (
            <>
              <Bidang
                label="Bank tujuan"
                value={bankTujuan}
                onChange={(v) => {
                  setBankTujuan(v);
                  setGalat(null);
                }}
                placeholder="mis. BCA (opsional)"
              />
              <Bidang
                label="Nomor referensi"
                value={referensi}
                onChange={(v) => {
                  setReferensi(v);
                  setGalat(null);
                }}
                placeholder="Dari bukti transfer di ponsel pelanggan"
                hint="Wajib. Tidak ada sistem yang memverifikasi transfer — referensi ini satu-satunya jejaknya."
              />
            </>
          )}

          {/* Nominal bagian — hanya di pembayaran campuran, dan hanya untuk
              non-tunai: nominal tunai diturunkan dari sisa dan dibulatkan
              (`spec-c:181`). Kosong berarti SELURUH sisa. */}
          {campuran && tab !== 'tunai' && !lunasTanpaTunai && metode !== 'qris_dynamic' && (
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
        </div>

        {/* Pembayaran campuran (keputusan bawaan #4): tautan kecil, bukan
            tampilan bawaan. Hilang bila sudah ada bagian — membukanya kembali
            tidak bermakna dan menutupnya menyembunyikan bagian yang ada. */}
        {!campuran ? (
          <button type="button" className="btn btn-ghost kasir-tautan-campuran" onClick={() => setCampuran(true)}>
            Bayar dengan lebih dari satu metode
          </button>
        ) : bagian.length === 0 ? (
          <button type="button" className="btn btn-ghost kasir-tautan-campuran" onClick={() => setCampuran(false)}>
            Bayar dengan satu metode saja
          </button>
        ) : null}
      </div>

      {/* ⛔ Blok aksi yang MENEMPEL. Angka yang ditagih dan tombol yang
          menagihnya duduk bersama, dan keduanya tidak pernah ikut bergulir. */}
      <div className="kasir-bayar-aksi">
        {/* ⛔ Baris pajak memakai NAMA TARIF, bukan kata "Pajak" — konvensi
            yang sama dengan struk (`spec-c:404`) dan dengan K-03. Layar yang
            menyebutnya berbeda dari struk membuat kasir yang mencocokkan
            keduanya menyimpulkan salah satunya salah.

            ⛔ Baris bernilai NOL tetap tampil (`spec-c:405`): pajak 0% adalah
            keputusan merchant yang auditor perlu lihat, bukan ketiadaan.

            ⛔ PEMBULATAN TIDAK ADA DI SINI (sampai Task 8B). FR-C9 membulatkan
            `amount_due`, bukan `total`, dan hanya pada SISA TUNAI sesudah
            bagian non-tunai — perhitungan yang baru lengkap di dalam
            `simpanPenjualan`. Penjaga P2 menolak kebocorannya ke sini. */}
        {hitungan?.pajak.lines.map((t) => (
          <div className="kasir-subtotal" key={t.taxRateId}>
            <span className="t-body-md">{t.name}</span>
            <span className="t-body-md num">+ {rupiah(t.amount)}</span>
          </div>
        ))}

        {/* AC FR-C1 kedua menuntut sisa tagihan TERLIHAT; kasir yang tidak
            melihatnya harus menghitung sendiri di depan pelanggan. */}
        {sisa !== null && (
          <div className="kasir-subtotal">
            <span className="t-body-md">{sisa === 0n ? 'Lunas' : 'Sisa tagihan'}</span>
            <span className="t-title num">{rupiah(sisa)}</span>
          </div>
        )}

        {galat && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galat}
          </p>
        )}

        {alasanAksi !== null && (
          <p className="t-caption kasir-login-sub" id="bayar-alasan">
            {alasanAksi}
          </p>
        )}

        {/* Satu baris: aksi sekunder di kiri, aksi utama di kanan. Galat di
            ATAS baris ini, supaya kalimat yang muncul tidak menggeser tombol ke
            arah yang berbeda dari tempat mata kasir sudah menunggu. */}
        <div className="kasir-bayar-baris">
          {campuran && tab !== 'tunai' && metode !== 'qris_dynamic' && !lunasTanpaTunai && (
            <Tombol
              varian="ghost"
              kritis
              disabled={menyimpan || !formLengkap}
              keterangan={!formLengkap && !menyimpan ? 'bayar-alasan' : undefined}
              onClick={tambahBagian}
            >
              Tambah pembayaran lain
            </Tombol>
          )}
          <Tombol
            varian="primary"
            kritis
            disabled={menyimpan || alasanAksi !== null}
            keterangan={alasanAksi !== null ? 'bayar-alasan' : undefined}
            onClick={metode === 'qris_dynamic' ? mulaiQris : bayar}
          >
            {menyimpan ? 'Menyimpan…' : metode === 'qris_dynamic' ? 'Tampilkan kode QR' : 'Konfirmasi bayar'}
          </Tombol>
        </div>
      </div>
    </HalamanBayar>
  );
}

/* Halaman K-06 di DALAM `kasir-konten` (keputusan kampanye Hidupkan desain,
   spec § 7 "Wadah"): "Kembali ke kasir" di atas kartu, bukan overlay. K-03
   tetap di-unmount di baliknya (`Kasir.tsx`), jadi `usePemindaiGlobal` mati
   selama pembayaran. Selama terkunci (QRIS menunggu / menyimpan) jalan keluar
   itu TIDAK dirender. */
function HalamanBayar({
  terkunci,
  onKembali,
  children,
}: {
  terkunci: boolean;
  onKembali: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="kasir-bayar-halaman">
      <div className="kasir-bayar-kolom">
        {!terkunci && (
          <div className="kasir-bayar-atas">
            <Tombol varian="ghost" kritis onClick={onKembali}>
              <Icon name="chevron-left" size={18} /> Kembali ke kasir
            </Tombol>
          </div>
        )}
        <div className="card kasir-bayar">{children}</div>
      </div>
    </div>
  );
}

/* Blok total di ATAS kartu: "TOTAL BELANJA" 13 px kapital, nilai 32/700. */
function BlokTotal({ total }: { total: bigint | null }) {
  return (
    <div className="kasir-bayar-total">
      <p className="t-caption kasir-bayar-total-label">Total belanja</p>
      <p className="t-display num">{total === null ? 'Rp —' : rupiah(total)}</p>
    </div>
  );
}

/* Segmented empat tab, tinggi 40 px dalam wadah `--secondary`. `aria-disabled`
   (bukan atribut `disabled`) selama terkunci: `disabled` membuat peramban
   membuang klik bahkan yang dikirim lewat `dispatchEvent`, dan penjaga P1 (R3)
   justru ingin membuktikan handler-nya sendiri yang menolak. */
function PemilihTab({
  tab,
  tabTampil,
  terkunci,
  onPilih,
}: {
  tab: TabBayar;
  tabTampil: readonly TabBayar[];
  terkunci: boolean;
  onPilih: (t: TabBayar) => void;
}) {
  const daftar = TAB_BAYAR.filter((t) => tabTampil.includes(t.tab));
  return (
    <div className="kasir-tab-bayar" role="tablist" aria-label="Metode pembayaran">
      {daftar.map((t, i) => (
        <button
          key={t.tab}
          type="button"
          role="tab"
          className="sentuh"
          style={potongSentuh(
            [...(i > 0 ? (['kiri'] as const) : []), ...(i < daftar.length - 1 ? (['kanan'] as const) : [])],
            'var(--space-1)'
          )}
          aria-selected={tab === t.tab}
          aria-disabled={terkunci ? true : undefined}
          aria-describedby={terkunci ? 'bayar-kunci-alasan' : undefined}
          onClick={() => onPilih(t.tab)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
