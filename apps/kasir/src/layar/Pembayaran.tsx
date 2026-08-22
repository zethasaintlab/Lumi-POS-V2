import { useEffect, useState } from 'react';
import { EmptyState } from 'ds';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { shiftAktif, type ShiftAktif } from '../kas/shift.ts';
import { muatHlc } from '../lokal/hlc.ts';
import type { Hlc } from '../../../../packages/domain/src/hlc.ts';
import {
  simpanPenjualan,
  type HasilPenjualan,
  type MetodeBayar,
  type Pembayaran,
} from '../kasir/penjualan.ts';
import { MIN_PANJANG_REFERENSI } from '../../../../packages/domain/src/pembayaran-manual.ts';
import { Bidang } from '../Bidang.tsx';
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

   Metode online-only dinonaktifkan saat offline (FR-C3) — belum di sini:
   hanya tunai yang dibangun, dan tunai justru yang berfungsi offline. QRIS
   dan EDC menunggu K-06 penuh. */

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
const NAMA_METODE: Record<MetodeBayar, string> = {
  cash: 'Tunai',
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
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [selesai, setSelesai] = useState<Extract<HasilPenjualan, { status: 'tersimpan' }> | null>(null);

  const keranjang = keranjangSekarang();
  const subtotal = subtotalKeranjang(keranjang);

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const k = await bacaKonfigPerangkat(db);
      if (!hidup) return;
      setKonfig(k);
      if (k) setShift(await shiftAktif(db, k.deviceId));
      // HLC melanjutkan dari keadaan tersimpan — bukan instance baru tiap
      // boot, yang akan membuat setiap order berikutnya ber-HLC lebih kecil
      // daripada yang sudah ada.
      const h = await muatHlc(db, () => Date.now());
      if (!hidup) return;
      setHlc(h);
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

  const susunPembayaran = (): Pembayaran => {
    if (metode === 'qris_static') return { metode, referensi };
    if (metode === 'card_edc') {
      return { metode, approvalCode, cardLast4: cardLast4 || null };
    }
    return { metode: 'cash', tendered };
  };

  /* Tombol simpan hidup hanya bila masukan metode ini sudah lengkap.
     ⛔ Ia BUKAN validasi — validasinya milik `simpanPenjualan`, yang memakai
     aturan server. Yang di sini hanya mencegah ketukan yang pasti ditolak;
     dua tempat yang memvalidasi akan menyimpang, dan yang menyimpang membuat
     tombol mati tanpa pesan. */
  const masukanLengkap =
    metode === 'cash'
      ? tendered > 0
      : metode === 'qris_static'
        ? referensi.trim().length >= MIN_PANJANG_REFERENSI
        : approvalCode.trim().length > 0;

  const bayar = () => {
    setMenyimpan(true);
    setGalat(null);
    void simpanPenjualan({
      db,
      konfig,
      sesi,
      shift,
      keranjang,
      pembayaran: susunPembayaran(),
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
        {(['cash', 'qris_static', 'card_edc'] as const).map((m) => (
          <Tombol
            key={m}
            varian={metode === m ? 'primary' : 'secondary'}
            kritis
            disabled={menyimpan}
            onClick={() => {
              setMetode(m);
              setGalat(null);
            }}
          >
            {NAMA_METODE[m]}
          </Tombol>
        ))}
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

      {metode === 'cash' && (
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
      {metode === 'qris_static' && (
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
      {metode === 'card_edc' && (
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
        <Tombol varian="ghost" kritis disabled={menyimpan} onClick={onKembali}>
          Kembali
        </Tombol>
      </div>

      {galat && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galat}
        </p>
      )}

      <Tombol varian="primary" kritis disabled={menyimpan || !masukanLengkap} onClick={bayar}>
        {menyimpan ? 'Menyimpan…' : 'Simpan Penjualan'}
      </Tombol>
    </div>
  );
}
