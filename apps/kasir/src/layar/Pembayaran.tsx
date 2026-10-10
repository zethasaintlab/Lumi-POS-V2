import { useCallback, useEffect, useRef, useState } from 'react';
import { pantauJangkauan, type KeadaanJangkauan } from '../lokal/keterjangkauan.ts';
import { alasanNonaktif, periksaTransfer, PROVIDER_TRANSFER } from '../../../../packages/domain/src/pembayaran-manual.ts';
import { labelMetode } from '../../../../packages/domain/src/metode-tampilan.ts';
import { setelKunciNav } from '../rute/kunci-nav.ts';
import { PanelQris } from '../komponen/PanelQris.tsx';
import { KerangkaQr } from '../komponen/GambarQr.tsx';
import { buatPemanggilApi } from '../lokal/api.ts';
import {
  cadangkanNomor,
  bersihkanDraf,
  drafCocokKeranjang,
  mintaQr,
  nominalDraf,
  pulihkanDraf,
  type DrafTersimpan,
} from '../kasir/qris-dinamis.ts';
import type { DrafTerkirim } from '../kasir/penjualan.ts';
import { EmptyState, Icon } from 'ds';
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
  rencanaBayarKeranjang,
  simpanPenjualan,
  type HasilPenjualan,
  type MetodeBayar,
  type Pembayaran,
} from '../kasir/penjualan.ts';
import { MIN_PANJANG_REFERENSI } from '../../../../packages/domain/src/pembayaran-manual.ts';
import {
  sisaTagihan,
  type BagianBayar,
  type HasilRencanaBayar,
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

   Hanya QRIS dinamis yang online-only (FR-C3): ia dinonaktifkan bersama
   alasannya saat server tak terjangkau; tunai, kartu, transfer, dan QRIS
   statis berfungsi tanpa jaringan. */

/** Bentuk layar → bentuk domain. Tunai tidak pernah masuk daftar `bagian`. */
/* `rencanaBayarKeranjang` jalan saat render: increment ≤ 0 atau mode tak dikenal MELEMPAR
   (`money.ts`), dan render yang melempar mematikan seluruh aplikasi kasir. Dijadikan galat. */
function hitungRencanaAman(
  hitungan: HitunganKeranjang,
  bagian: readonly Pembayaran[]
): HasilRencanaBayar {
  try {
    return rencanaBayarKeranjang(hitungan, bagian);
  } catch {
    return { ok: false, kode: 'NOMINAL_TIDAK_SAH', pesan: 'Pengaturan pembulatan outlet tidak valid. Hubungi pemilik.' };
  }
}

/* Kalimat tunggal untuk galat rencana — dipakai kotak Kembalian DAN alasan tombol (satu kalimat). */
function kalimatRencana(r: Extract<HasilRencanaBayar, { ok: false }>): string {
  return r.kode === 'KURANG_BAYAR' ? 'Uang diterima kurang dari tagihan tunai.' : r.pesan;
}

function keBagianDomain(p: Pembayaran): BagianBayar {
  return {
    metode: p.metode,
    nominal: p.metode === 'cash' ? undefined : p.nominal,
    tendered: p.metode === 'cash' ? BigInt(p.tendered) : undefined,
  };
}

/* ⛔ Empat tab mockup, dikunci per TAB, bukan per kode metode (G-LABEL):
   "QRIS" memuat dua metode (dinamis/statis) dan "Transfer" bukan kode metode
   sama sekali (`other` + `bank_transfer`). Nama bagian di daftar campuran
   datang dari SATU peta domain (`labelMetode`), bukan dari sini. */
export const TAB_BAYAR = [
  { tab: 'tunai', label: 'Tunai' },
  { tab: 'qris', label: 'QRIS' },
  { tab: 'kartu', label: 'Kartu' },
  { tab: 'transfer', label: 'Transfer' },
] as const;
type TabBayar = (typeof TAB_BAYAR)[number]['tab'];

/* Tiga pintasan persis mockup. Menekannya MENETAPKAN kolom "Nominal diterima"
   (keputusan user 28 September 2026, menggantikan enam pecahan yang menambah:
   salah ketuk menambah 50.000 ke 20.000 menghasilkan uang yang tidak pernah
   diserahkan pelanggan). */
export const PINTASAN_TUNAI = [20_000, 50_000, 100_000] as const;

/* Nama bagian di daftar campuran — dari peta domain, `provider` ikut supaya
   Transfer tidak terbaca "Lainnya". */
const namaBagian = (b: Pembayaran): string => labelMetode(b.metode, b.metode === 'other' ? b.provider : null);

/* `20000` → `20.000` untuk kolom nominal. Memakai pemformat tunggal dan
   membuang awalannya; kolom sudah punya awalan "Rp" sendiri. */
const teksNominal = (n: number): string => rupiah(BigInt(n)).replace(/^Rp\s*/, '');

/* Panel dari draf yang dipulihkan: nominal dari muatan DRAF (yang ditagih gateway), bukan keranjang saat ini. */
function panelDari(d: DrafTersimpan) {
  return {
    qrString: d.qrString ?? '',
    paymentId: d.paymentId,
    orderId: d.orderId,
    draf: d.draf,
    nominal: nominalDraf(d) ?? 0n,
  };
}

export function Pembayaran({ onKembali }: { onKembali: () => void }) {
  const { db, pemberitahu } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  const [hlc, setHlc] = useState<Hlc | null>(null);
  const [siap, setSiap] = useState(false);
  const [gagalMuat, setGagalMuat] = useState<string | null>(null);
  /* "Nominal diterima" menyimpan TEKS; nilainya dibaca `bacaRupiah`, yang
     mengembalikan `null` untuk kosong/cacat — bukan 0, karena 0 yang lahir
     dari kolom kosong adalah uang yang tidak pernah diserahkan. */
  const [nominalTeks, setNominalTeks] = useState('');
  /* FR-C1 — empat tab: Tunai, QRIS, Kartu, Transfer. QRIS dinamis (`subQris`)
     online-only: gateway harus menjawab sebelum lunas (`spec-c:320`), jadi
     ordernya sudah ada di server; yang lain menulis lokal lebih dulu. */
  const [tab, setTab] = useState<TabBayar>('tunai');
  const [subQris, setSubQris] = useState<'qris_dynamic' | 'qris_static'>('qris_dynamic');
  const [bank, setBank] = useState('');
  /* Tautan "Bayar dengan lebih dari satu metode" (keputusan bawaan #4). */
  const [campuran, setCampuran] = useState(false);
  /* ⛔ Pagar ketukan ganda (Review Focus 1). `menyimpan` adalah state — render
     ulang belum tentu sempat menonaktifkan tombol sebelum ketukan kedua, dan
     dua baris `order` untuk satu pembayaran adalah uang tercatat dua kali. */
  const sibuk = useRef(false);
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
  /* ⛔ Hitungan LENGKAP, untuk baris pajak dan Total di blok ATAS kartu. `total` di
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

  /* FR-C14 (`spec-c:328`) — draf QRIS yang tertinggal DIPULIHKAN saat layar dibuka.
     "Aplikasi mati di tengah polling → setelah restart, payment masih
     `pending_confirmation` dan polling dilanjutkan."

     ⛔ Draf ber-QR yang MASIH HIDUP (`drafTertunda`) adalah satu-satunya jejak lokal uang
     yang pelanggannya mungkin sudah bayar. Selama ia ada kartu TIDAK menawarkan "Tampilkan
     kode QR" (QR kedua = tagih ganda, `spec-c:291`); yang ditawarkan membuka kembali panel
     draf itu. Tombol meminta QR juga mati sampai pembacaan draf selesai (`pemulihanSelesai`),
     dan `mintaQr` menolak sendiri bila draf lain masih hidup (pagar kedua, di domain). */
  const [drafTertunda, setDrafTertunda] = useState<DrafTersimpan | null>(null);
  const [pemulihanSelesai, setPemulihanSelesai] = useState(false);
  const sudahBuka = useRef(false);
  const muatDraf = useCallback(async () => {
    if (!shift) return;
    setPemulihanSelesai(false);
    try {
      const d = await pulihkanDraf(db, shift.id);
      setDrafTertunda(d !== null && d.qrString !== null ? d : null);
      setPemulihanSelesai(true);
    } catch (e) {
      // Gagal baca = draf TIDAK DIKETAHUI: tombol meminta QR tetap mati, bukan dianggap kosong.
      setGalat(`Pembayaran QRIS tertunda tidak dapat diperiksa: ${(e as Error).message}`);
    }
  }, [db, shift]);
  useEffect(() => {
    void muatDraf();
  }, [muatDraf]);

  /* ⛔ Kunci tab metode dan tab nav header selama QRIS menunggu atau penjualan
     disimpan. Diturunkan dari state, bukan dipanggil di tiap jalur: yang lupa
     membukanya di satu cabang mengunci aplikasi, dan cleanup unmount menutup
     jalur itu juga. */
  const alasanKunci = panelQris
    ? 'Pembayaran QRIS sedang menunggu pelanggan; metode dan navigasi terkunci sampai selesai.'
    : menyimpan
      ? 'Penjualan sedang disimpan; metode dan navigasi terkunci sebentar.'
      : null;
  useEffect(() => {
    setelKunciNav(alasanKunci);
    return () => setelKunciNav(null);
  }, [alasanKunci]);

  const keranjang = keranjangSekarang();
  const subtotal = subtotalKeranjang(keranjang);
  /* Draf yang tertunda ditagih dengan total dan isi KERANJANG LAMA. Penjualan lokal hanya
     boleh ditulis dari keranjang yang cocok dengannya. */
  const drafCocok = drafTertunda === null || drafCocokKeranjang(drafTertunda, keranjang, total);

  /* Sekali per pemasangan layar, sesudah draf dibaca dan keranjang dihitung: cocok → panel
     dibuka seketika; berbeda → kartu QRIS menampilkan peringatan, panel TIDAK dibuka. */
  useEffect(() => {
    if (!pemulihanSelesai || !siap || sudahBuka.current) return;
    sudahBuka.current = true;
    if (drafTertunda === null) return;
    setTab('qris');
    setSubQris('qris_dynamic');
    if (drafCocok) setPanelQris(panelDari(drafTertunda));
  }, [pemulihanSelesai, siap, drafTertunda, drafCocok]);

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
  if (selesai) {
    /* K-07 TETAP overlay penuh (`kasir-overlay-bayar`/`kasir-overlay-lebar`,
       kartu 536 px): perombakannya milik PR 2D. Wadah ini dulu dipasang
       `Kasir.tsx` untuk K-06 dan K-07 sekaligus; K-06 kini halaman, jadi K-07
       membawa wadahnya sendiri. */
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

  /* Tab dan metode EFEKTIF. Panel QRIS yang menunggu (juga yang dipulihkan dari
     draf) memaksa tab QRIS dinamis; Transfer yang dimatikan kill switch di
     tengah jalan jatuh ke Tunai; QRIS dinamis yang tak terjangkau jatuh ke
     statis bila statis menyala. */
  const statisAktif = fiturAktif(fitur, 'pembayaran_qris_statis');
  const transferAktif = fiturAktif(fitur, 'pembayaran_transfer');
  const alasanDinamis = alasanNonaktif('qris_dynamic', jangkauan);
  const tabAktif: TabBayar = panelQris ? 'qris' : tab === 'transfer' && !transferAktif ? 'tunai' : tab;
  const subAktif: 'qris_dynamic' | 'qris_static' = panelQris
    ? 'qris_dynamic'
    : subQris === 'qris_dynamic' && alasanDinamis !== null && statisAktif
      ? 'qris_static'
      : subQris;
  const metodeDariTab = (): MetodeBayar => {
    if (tabAktif === 'tunai') return 'cash';
    if (tabAktif === 'qris') return subAktif;
    if (tabAktif === 'kartu') return 'card_edc';
    return 'other';
  };
  const metode = metodeDariTab();
  const campuranTerbuka = campuran || bagian.length > 0;

  /* `null` untuk kosong/cacat (`25.5`, `100.000,00`) — bukan 0. */
  const tenderedBaca = bacaRupiah(nominalTeks);

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
    // Transfer: `other` + `bank_transfer`. Validasinya milik `simpanPenjualan`.
    if (metode === 'other') {
      return { metode, provider: PROVIDER_TRANSFER, referensi, bank: bank.trim() === '' ? null : bank, nominal };
    }
    return { metode, approvalCode, cardLast4: cardLast4 || null, nominal };
  };

  const kosongkanForm = () => {
    setReferensi('');
    setApprovalCode('');
    setCardLast4('');
    setNominalBagian('');
    setNominalTeks('');
    setBank('');
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
     tombol mati tanpa pesan.

     ⛔ Transfer SENGAJA selalu "lengkap": aturannya tiga (panjang minimal,
     nomor kartu di referensi, nomor kartu di bank), dan menyalin sebagian ke
     sini membuat tombol mati tanpa pesan untuk kasus yang `periksaTransfer`
     jelaskan. Penolakannya tampil lewat pesan domain yang sama dengan server. */
  const formLengkap =
    metode === 'cash'
      ? tenderedBaca !== null && tenderedBaca > 0
      : metode === 'qris_static'
        ? referensi.trim().length >= MIN_PANJANG_REFERENSI
        : metode === 'other' || metode === 'qris_dynamic'
          ? true
          : approvalCode.trim().length > 0;
  /* "Tambah pembayaran lain" lebih ketat untuk Transfer: bagian yang ditolak
     `periksaTransfer` tidak boleh masuk daftar. Aturannya tetap SATU, dipanggil. */
  const galatTambahTransfer = metode === 'other' ? periksaTransfer(referensi, bank) : null;
  const bisaTambah = metode === 'other' ? galatTambahTransfer === null : formLengkap;

  /* Lunas tanpa tunai: seluruh tagihan sudah tertutup bagian non-tunai. */
  const lunasTanpaTunai = sisa !== null && sisa === 0n && bagian.length > 0;
  const masukanLengkap = lunasTanpaTunai || formLengkap;

  /* ⛔ Kembalian K-06 = `rencana.kembalian` dari `rencanaBayarKeranjang` — fungsi
     yang SAMA dengan `simpanPenjualan`, dengan bagian non-tunai yang sudah
     dimasukkan + bagian tunai dari kolom (keputusan user 28 September 2026).
     Tidak ada aritmetika di layar: kolom kosong/cacat/0 → `null` → `Rp —` (0 sejajar `formLengkap`: alasan tombol "Isi nominal", bukan "kurang"), bukan
     kembalian dari Rp 0; `KURANG_BAYAR` dan galat lain memakai kodenya, tanpa
     angka kurang yang dihitung sendiri. */
  const rencanaTunai: HasilRencanaBayar | null =
    tabAktif === 'tunai' && !lunasTanpaTunai && hitungan !== null && tenderedBaca !== null && tenderedBaca > 0
      ? hitungRencanaAman(hitungan, [...bagian, { metode: 'cash', tendered: tenderedBaca }])
      : null;
  /* Rencana yang menolak (kurang bayar, galat lain) menonaktifkan tombol utama dengan
     kalimatnya — tanpa angka kurang kedua, dan tanpa order ditulis (I-1, 2 Okt 2026). */
  const alasanRencana: string | null =
    rencanaTunai !== null && !rencanaTunai.ok ? kalimatRencana(rencanaTunai) : null;

  const terkunci = alasanKunci !== null;

  /* ⛔ Alasan tombol utama nonaktif — satu kalimat, dirujuk `aria-describedby`.
     Tombol mati tanpa penjelasan adalah tombol yang kasir simpulkan rusak. */
  const alasanAksi: string | null = panelQris
    ? 'Menunggu pelanggan membayar lewat QRIS.'
    : menyimpan
      ? 'Sedang menyimpan penjualan.'
      : metode === 'qris_dynamic'
        ? ((drafTertunda !== null
            ? 'Ada pembayaran QRIS tertunda; tekan Lanjutkan pembayaran QRIS tertunda.'
            : !pemulihanSelesai
              ? 'Memeriksa pembayaran QRIS yang tertunda…'
              : alasanDinamis) ??
          (bagian.length > 0
            ? 'QRIS dinamis tidak dapat digabung dengan bagian pembayaran lain.'
            : 'Tekan Tampilkan kode QR; penjualan lunas hanya setelah gateway mengonfirmasi.'))
        : masukanLengkap
          ? alasanRencana
          : metode === 'cash'
            ? 'Isi nominal yang diterima.'
            : metode === 'qris_static'
              ? `Isi referensi pembayaran QRIS (minimal ${MIN_PANJANG_REFERENSI} karakter).`
              : 'Isi kode approval dari struk mesin EDC.';

  /* Alasan "Tambah pembayaran lain" nonaktif: pesan `periksaTransfer` apa adanya (Transfer
     "selalu lengkap" untuk tombol utama, jadi `alasanAksi` null di sana); metode lain sudah
     punya `alasanAksi`. Tanpa elemen ini `aria-describedby` menunjuk ke ketiadaan. */
  const alasanTambah = !bisaTambah ? (galatTambahTransfer?.pesan ?? alasanAksi) : null;

  /* FR-C3 — jalur ONLINE-FIRST untuk QRIS dinamis.

     ⛔ Terbalik dari setiap jalur lain di produk ini, dan bukan karena pilihan
     rancangan: `spec-c:320` melarang sistem menandai lunas tanpa konfirmasi
     GATEWAY, dan gateway hanya dapat dihubungi server kami. Perangkat tidak
     punya cara mengetahui pelanggan sudah membayar. */
  const mulaiQris = () => {
    if (!konfig || !shift || !sesi || total === null) return;
    // ⛔ Pagar UI: draf belum dibaca, atau masih ada draf ber-QR — tidak ada QR kedua.
    if (!pemulihanSelesai || drafTertunda !== null) return;
    if (sibuk.current) return;
    sibuk.current = true;
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
          channel: keranjang.kanal,
          total,
          idBaru: () => crypto.randomUUID(),
          sekarang: d.occurredAt,
        });
        if (hasil.status === 'tertunda') {
          setGalat(hasil.pesan);
          await muatDraf();
          return;
        }
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
        sibuk.current = false;
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
        setDrafTertunda(null);
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
    if (sibuk.current) return;
    // Bagian tunai/kartu/... dari form; `null` hanya bila masukannya cacat — tombolnya
    // sudah mati saat itu, ini pagar kedua (nominal cacat tidak pernah jadi tendered 0).
    const baru = lunasTanpaTunai ? null : bagianBaru();
    if (!lunasTanpaTunai && baru === null) return;
    sibuk.current = true;
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
          // Tombol sudah nonaktif untuk tunai kurang; jalur ini cadangan, TANPA angka kurang (satu sumber: rencana).
          setGalat('Uang diterima kurang dari tagihan tunai. Penjualan belum tersimpan.');
          return;
        }
        // Status ini juga pagar KEDUA data pesanan (nama, meja, catatan) dari
        // `simpanPenjualan`; dialog K-03 sudah menolaknya lebih dulu, jadi
        // ke sini hanya sampai keranjang tersimpan yang tak lagi sah.
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
        sibuk.current = false;
        setMenyimpan(false);
      });
  };

  const idKunci = 'bayar-kunci-alasan';
  const idAlasanAksi = 'bayar-alasan';
  const idAlasanTambah = 'bayar-tambah-alasan';
  const idAlasanDinamis = 'bayar-dinamis-alasan';

  /* ⛔ Pagar kedua di handler, bukan hanya `disabled`: klik yang dipaksa
     (R3, `dispatchEvent`) tidak boleh mengganti metode selagi terkunci. */
  const pilihTab = (t: TabBayar) => {
    if (terkunci) return;
    setTab(t);
    setGalat(null);
  };
  const pilihSub = (m: 'qris_dynamic' | 'qris_static') => {
    if (terkunci) return;
    setSubQris(m);
    setGalat(null);
  };

  const labelUtama = panelQris
    ? 'Menunggu pembayaran…'
    : menyimpan
      ? metode === 'qris_dynamic'
        ? 'Meminta QR…'
        : 'Menyimpan…'
      : 'Konfirmasi bayar';

  return (
    <div className="kasir-bayar-halaman">
      <h1 className="sr-only">Pembayaran</h1>

      {/* "Kembali ke kasir" di ATAS kartu (mockup). Tidak ada selagi QRIS
          menunggu: meninggalkan layar di tengah QR yang dipindai pelanggan
          membuang jejaknya (P1). */}
      {!panelQris && (
        <div className="kasir-bayar-kembali">
          <Tombol
            varian="ghost"
            disabled={menyimpan}
            keterangan={menyimpan ? idKunci : undefined}
            onClick={onKembali}
          >
            <Icon name="chevron-left" size={18} />
            Kembali ke kasir
          </Tombol>
        </div>
      )}

      <section className="kasir-bayar-kartu" aria-label="Pembayaran">
        {/* ⛔ Blok ATAS (mockup `Payment`): TOTAL BELANJA 13 px kapital, nilai
            32/700 dari `hitungan.totals.total` — fungsi yang SAMA yang
            `simpanPenjualan` pakai, dan sumber yang sama dengan K-03.
            Menjumlahkan butir di bawahnya adalah aritmetika KEDUA, dan pajak
            INKLUSIF membuatnya tidak sama dengan total yang tersimpan.

            ⛔ Total TIDAK PERNAH dibulatkan. FR-C9 membulatkan hanya SISA TUNAI
            sesudah bagian non-tunai, dan hasilnya tampil di kotak Kembalian di
            bawah — dari `rencanaBayarKeranjang`, bukan dihitung di sini (P2). */}
        <div className="kasir-bayar-atas">
          {hitungan !== null ? (
            <div className="kasir-bayar-total">
              <span className="t-caption kasir-bayar-total-label">Total belanja</span>
              <span className="t-display num">{rupiah(hitungan.totals.total)}</span>
            </div>
          ) : (
            <p className="t-body-md">Total belum terbaca.</p>
          )}

          {/* AC FR-C1 kedua menuntut sisa tagihan TERLIHAT; kasir yang tidak
              melihatnya harus menghitung sendiri di depan pelanggan. */}
          {sisa !== null && (
            <div className="kasir-subtotal">
              <span className="t-caption">{sisa === 0n ? 'Lunas' : 'Sisa tagihan'}</span>
              <span className="t-title num">{rupiah(sisa)}</span>
            </div>
          )}

          {/* ⛔ Butir pajak memakai NAMA TARIF, bukan kata "Pajak" — konvensi
              struk (`spec-c:404`) dan K-03. Butir bernilai NOL tetap tampil
              (`spec-c:405`): pajak 0% adalah keputusan merchant yang auditor
              perlu lihat. Potongan ikut terlihat (FR-B8), nominalnya dari
              permintaan yang sama yang akan disimpan (`nilaiDiskon`). */}
          <p className="t-caption kasir-bayar-ringkas">
            <span className="kasir-ringkas-butir">
              <span>Subtotal</span> <span className="num">{rupiah(subtotal)}</span>
            </span>
            {keranjang.diskon !== null && (
              <span className="kasir-ringkas-butir">
                <span>Diskon</span>{' '}
                <span className="num">− {rupiah(nilaiDiskon(subtotal, keranjang.diskon.minta))}</span>
              </span>
            )}
            {hitungan?.pajak.lines.map((t) => (
              <span className="kasir-ringkas-butir" key={t.taxRateId}>
                <span>{t.name}</span> <span className="num">+ {rupiah(t.amount)}</span>
              </span>
            ))}
          </p>
        </div>

        {/* Segmented empat tab. Terkunci (`disabled` + alasan) selagi QRIS
            menunggu atau penjualan disimpan; tidak pernah HILANG. Tampil 40 px
            persis mockup, area tekan 56 px (`.sentuh-uang`, aksi uang) dengan
            sisi kiri/kanan dipotong 0 supaya area tetangga tidak bertumpuk. */}
        <div className="kasir-bayar-tab" role="group" aria-label="Metode pembayaran">
          {TAB_BAYAR.filter((t) => t.tab !== 'transfer' || transferAktif).map((t) => (
            <button
              key={t.tab}
              type="button"
              className="sentuh-uang"
              aria-pressed={tabAktif === t.tab}
              disabled={terkunci}
              aria-describedby={terkunci ? idKunci : undefined}
              onClick={() => pilihTab(t.tab)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ⛔ Isi yang MENGGULIR. Semua yang kasir baca dan ketik ada di sini;
            yang ia tekan untuk menyelesaikan transaksi ada di blok aksi di
            bawah, yang tidak pernah ikut bergerak. Pembayaran campuran berisi
            beberapa bagian membuat isi ini lebih tinggi daripada kartunya. */}
        <div className="kasir-bayar-isi">
          {terkunci && (
            <p id={idKunci} className="t-caption kasir-bayar-kunci" role="status">
              {alasanKunci}
            </p>
          )}

          {/* FR-C1 — bagian yang sudah dimasukkan (pembayaran campuran), di
              dalam kartu yang SAMA (P7). Sisa tagihannya di blok atas. */}
          {bagian.length > 0 && (
            <div className="kasir-baris-daftar">
              {bagian.map((b, i) => (
                <div key={`${b.metode}-${i}`} className="kasir-subtotal">
                  <span className="t-body-md">{namaBagian(b)}</span>
                  <span className="t-body-md num">
                    {rupiah(b.metode === 'cash' ? b.tendered : (b.nominal ?? 0n))}
                  </span>
                  <Tombol
                    varian="ghost"
                    disabled={terkunci}
                    keterangan={terkunci ? idKunci : undefined}
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

          {tabAktif === 'tunai' && !lunasTanpaTunai && (
            <>
              <Bidang
                label="Nominal diterima"
                ukuran="lg"
                awalan="Rp"
                inputMode="numeric"
                value={nominalTeks}
                onChange={(v) => {
                  setNominalTeks(v);
                  setGalat(null);
                }}
              />
              {/* Tiga pintasan MENETAPKAN kolom (keputusan user). Tampil 44 px
                  persis mockup; area tekan 56 px lewat `.sentuh-uang`. */}
              <div className="kasir-bayar-pintasan">
                {PINTASAN_TUNAI.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="btn btn-secondary sentuh-uang"
                    disabled={terkunci}
                    aria-describedby={terkunci ? idKunci : undefined}
                    onClick={() => {
                      setNominalTeks(teksNominal(p));
                      setGalat(null);
                    }}
                  >
                    {rupiah(BigInt(p))}
                  </button>
                ))}
              </div>
              {/* Kotak Kembalian (mockup): 32/700 aksen di panel `--accent-subtle`.
                  `rupiah('')` = `Rp —`, jalur nilai-hilang pemformat tunggal. */}
              <div className="kasir-bayar-kembalian">
                <p className="t-caption">Kembalian</p>
                <p className="t-display num" role="status" aria-live="polite">
                  {rencanaTunai !== null && rencanaTunai.ok ? rupiah(rencanaTunai.rencana.kembalian) : rupiah('')}
                </p>
                {rencanaTunai !== null && !rencanaTunai.ok && (
                  <p className="t-caption">
                    {kalimatRencana(rencanaTunai)}
                  </p>
                )}
                {rencanaTunai !== null && rencanaTunai.ok && rencanaTunai.rencana.roundingAdjustment !== 0n && (
                  <p className="t-caption">
                    Tagihan tunai dibulatkan menjadi <span className="num">{rupiah(rencanaTunai.rencana.tunaiDitagih)}</span>
                  </p>
                )}
              </div>
            </>
          )}

          {tabAktif === 'qris' && (
            <>
              {/* ⛔ `qris_dynamic` ADA meski ia satu-satunya yang tidak dapat
                  dipakai offline. `spec-c:272`: metode online-only "TIDAK
                  disembunyikan — kasir harus tahu metode itu ada dan mengapa
                  tidak bisa dipakai". Status TIDAK PERNAH warna saja (DS #5):
                  alasannya tertulis. */}
              <div className="segmented kasir-bayar-sub" role="group" aria-label="Jenis QRIS">
                <button
                  type="button"
                  className="sentuh-uang"
                  aria-pressed={subAktif === 'qris_dynamic'}
                  disabled={terkunci || alasanDinamis !== null}
                  aria-describedby={terkunci ? idKunci : alasanDinamis !== null ? idAlasanDinamis : undefined}
                  onClick={() => pilihSub('qris_dynamic')}
                >
                  QRIS dinamis
                </button>
                {statisAktif && (
                  <button
                    type="button"
                    className="sentuh-uang"
                    aria-pressed={subAktif === 'qris_static'}
                    disabled={terkunci}
                    aria-describedby={terkunci ? idKunci : undefined}
                    onClick={() => pilihSub('qris_static')}
                  >
                    QRIS statis
                  </button>
                )}
              </div>
              {alasanDinamis !== null && !terkunci && (
                <span id={idAlasanDinamis} className="t-caption">
                  QRIS dinamis: {alasanDinamis}
                </span>
              )}
            </>
          )}

          {/* FR-C14 — panel tunggu QRIS dinamis di DALAM kartu (Task 9
              menggarap QR-nya). Kontrol metode di atasnya terkunci. */}
          {panelQris && konfig && sesi && (
            <PanelQris
              kirim={buatPemanggilApi(konfig, sesi.userId)}
              qrString={panelQris.qrString}
              paymentId={panelQris.paymentId}
              orderId={panelQris.orderId}
              nominal={panelQris.nominal}
              onSelesai={(h) => {
                if (h.status === 'lunas') {
                  /* ⛔ Gateway menagih total DRAF. Keranjang yang berubah sejak itu tidak boleh
                     menjadi penjualan lokal: uang dan barang tidak akan cocok. Drafnya tetap
                     hidup; mengembalikan keranjang membuat pemulihan berikutnya menulisnya. */
                  if (drafTertunda !== null && drafTertunda.paymentId === panelQris.paymentId && !drafCocok) {
                    setPanelQris(null);
                    setGalat(
                      `Pembayaran QRIS ${rupiah(panelQris.nominal)} sudah LUNAS di server, tetapi isi keranjang berbeda dari ` +
                        'yang ditagih. Penjualan TIDAK ditulis. Kembalikan keranjang ke isi semula, lalu buka Pembayaran lagi.'
                    );
                    return;
                  }
                  selesaikanQris(panelQris.draf);
                  return;
                }
                if (h.status === 'batal') {
                  void bersihkanDraf(db);
                  setDrafTertunda(null);
                  setPanelQris(null);
                  setGalat(
                    h.baru
                      ? 'Kode lama dibatalkan dan stok dikembalikan. Tekan Tampilkan kode QR untuk membuat kode baru.'
                      : 'Transaksi dibatalkan. Stok sudah dikembalikan.'
                  );
                  return;
                }
                /* ⛔ "Ditunda" TIDAK membersihkan draf lokal. Ia satu-satunya
                   jejak perangkat bahwa QR pernah diminta, dan pelanggan
                   mungkin sedang memindainya. Menghapusnya berarti kasir
                   kehilangan tombol "Cek status" untuk uang yang mungkin sudah
                   masuk. */
                setPanelQris(null);
                void muatDraf();
                setGalat(
                  'Pembayaran QRIS masih menunggu konfirmasi. Ia tetap tercatat di server; tekan ' +
                    '"Lanjutkan pembayaran QRIS tertunda" untuk mengeceknya lagi.'
                );
              }}
            />
          )}

          {/* P3(b): QR baru diminta saat "Tampilkan kode QR" ditekan, bukan saat tab dipilih.
              ⛔ Selama draf ber-QR masih hidup tombol itu TIDAK ADA (fix round Task 9, C1):
              yang ditawarkan membuka kembali panel draf yang sama. */}
          {!panelQris && metode === 'qris_dynamic' && (
            <div className="kasir-qris">
              {drafTertunda !== null ? (
                <>
                  <p className="t-title num">{rupiah(nominalDraf(drafTertunda) ?? 0n)}</p>
                  <p className="t-body-md">
                    {drafCocok
                      ? 'Ada pembayaran QRIS yang tertunda. Pelanggan mungkin sudah membayar; periksa statusnya sebelum menagih ulang.'
                      : 'Ada pembayaran QRIS tertunda yang isinya berbeda dari keranjang ini. Penjualan tidak ditulis dari keranjang yang berbeda; kembalikan keranjang ke isi semula atau periksa statusnya.'}
                  </p>
                  <Tombol varian="secondary" kritis onClick={() => setPanelQris(panelDari(drafTertunda))}>
                    Lanjutkan pembayaran QRIS tertunda
                  </Tombol>
                </>
              ) : (
                <>
                  {menyimpan ? (
                    <KerangkaQr />
                  ) : (
                    <>
                      {total !== null && <p className="t-title num">{rupiah(total)}</p>}
                      <p className="t-body-md">
                        Pelanggan memindai kode QR dari layar ini. Pembayaran lunas hanya setelah gateway
                        mengonfirmasi.
                      </p>
                    </>
                  )}
                  <Tombol
                    varian="secondary"
                    kritis
                    disabled={menyimpan || !pemulihanSelesai || alasanDinamis !== null || bagian.length > 0}
                    keterangan={menyimpan || !pemulihanSelesai || alasanDinamis !== null || bagian.length > 0 ? idAlasanAksi : undefined}
                    onClick={mulaiQris}
                  >
                    {menyimpan ? 'Meminta kode QR…' : 'Tampilkan kode QR'}
                  </Tombol>
                </>
              )}
            </div>
          )}

          {/* Nominal bagian — hanya di pembayaran campuran; kosong berarti
              SELURUH sisa. Ia hanya muncul untuk non-tunai: nominal tunai
              diturunkan dari sisa dan dibulatkan (`spec-c:181`). */}
          {campuranTerbuka && !panelQris && metode !== 'cash' && metode !== 'qris_dynamic' && !lunasTanpaTunai && (
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

          {/* FR-C2 — QRIS statis. Referensi WAJIB, dan layar mengatakan kenapa:
              tidak ada sistem yang memverifikasi pembayaran ini, jadi tanpa
              referensi "sudah dibayar" hanyalah pernyataan kasir tanpa jejak. */}
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
          {tabAktif === 'kartu' && !lunasTanpaTunai && (
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

          {/* Transfer (keputusan user P1/P2): bank + referensi. Referensi
              WAJIB — satu-satunya jejak yang dapat dicocokkan dengan mutasi
              rekening; nomor kartu ditolak di KEDUA field. */}
          {tabAktif === 'transfer' && !lunasTanpaTunai && (
            <>
              <Bidang
                label="Bank tujuan"
                value={bank}
                onChange={(v) => {
                  setBank(v);
                  setGalat(null);
                }}
                placeholder="Mis. BCA"
                hint="Opsional."
              />
              <Bidang
                label="Nomor referensi"
                value={referensi}
                onChange={(v) => {
                  setReferensi(v);
                  setGalat(null);
                }}
                placeholder="Dari bukti transfer"
                hint="Wajib. Tidak ada sistem yang memverifikasi transfer — referensi ini satu-satunya jejaknya."
              />
            </>
          )}

          {/* Pembayaran campuran (keputusan bawaan #4). Membukanya menampilkan
              daftar bagian dan "Nominal bagian ini". QRIS dinamis tidak dapat
              digabung (ia dimulai online-first), dan selama QRIS menunggu
              tautannya tidak ada. */}
          {!campuranTerbuka && !panelQris && metode !== 'qris_dynamic' && (
            <div className="kasir-bayar-campuran">
              <Tombol varian="ghost" disabled={menyimpan} onClick={() => setCampuran(true)}>
                Bayar dengan lebih dari satu metode
              </Tombol>
            </div>
          )}
        </div>

        {/* ⛔ Blok aksi yang MENEMPEL, di dasar kartu. Galat dan alasan di ATAS
            baris tombol (P8), supaya kalimat yang muncul tidak menggeser
            tombol ke arah yang berbeda dari tempat mata kasir menunggu. */}
        <div className="kasir-bayar-aksi">
          {galat && (
            <p className="t-body-md kasir-login-galat" role="alert">
              {galat}
            </p>
          )}
          {alasanAksi !== null && (
            <p id={idAlasanAksi} className="t-caption kasir-bayar-alasan">
              {alasanAksi}
            </p>
          )}
          {alasanTambah !== null && alasanTambah !== alasanAksi && (
            <p id={idAlasanTambah} className="t-caption kasir-bayar-alasan">
              {alasanTambah}
            </p>
          )}
          <div className="kasir-bayar-baris">
            {/* ⛔ `ghost`: aksi utama layar ini tetap Konfirmasi bayar.
                Menambah bagian adalah langkah antara, bukan tujuannya. */}
            {campuranTerbuka && !panelQris && metode !== 'cash' && metode !== 'qris_dynamic' && !lunasTanpaTunai && (
              <Tombol
                varian="ghost"
                kritis
                disabled={menyimpan || !bisaTambah}
                keterangan={alasanTambah === null ? undefined : alasanTambah === alasanAksi ? idAlasanAksi : idAlasanTambah}
                onClick={tambahBagian}
              >
                Tambah pembayaran lain
              </Tombol>
            )}
            <Tombol
              varian="primary"
              kritis
              disabled={alasanAksi !== null}
              keterangan={alasanAksi !== null ? idAlasanAksi : undefined}
              onClick={bayar}
            >
              <Icon name="check" size={19} />
              {labelUtama}
            </Tombol>
          </div>
        </div>
      </section>
    </div>
  );
}
