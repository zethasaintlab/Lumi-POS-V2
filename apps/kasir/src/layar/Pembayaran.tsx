import { useEffect, useState } from 'react';
import { EmptyState } from 'ds';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { shiftAktif, type ShiftAktif } from '../kas/shift.ts';
import { muatHlc } from '../lokal/hlc.ts';
import type { Hlc } from '../../../../packages/domain/src/hlc.ts';
import { simpanPenjualan, type HasilPenjualan } from '../kasir/penjualan.ts';
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

export function Pembayaran({ onKembali }: { onKembali: () => void }) {
  const { db, pemberitahu } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  const [hlc, setHlc] = useState<Hlc | null>(null);
  const [siap, setSiap] = useState(false);
  const [tendered, setTendered] = useState(0);
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

  const bayar = () => {
    setMenyimpan(true);
    setGalat(null);
    void simpanPenjualan({
      db,
      konfig,
      sesi,
      shift,
      keranjang,
      pembayaran: { metode: 'cash', tendered },
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
      <h1 className="t-title">Pembayaran tunai</h1>
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

      <p className="t-body-md">Uang diterima</p>
      <p className="t-display num">{rupiah(tendered)}</p>

      <div className="kasir-pecahan">
        {PECAHAN.map((p) => (
          <Tombol key={p} kritis disabled={menyimpan} onClick={() => setTendered((t) => t + p)}>
            + {rupiah(p)}
          </Tombol>
        ))}
        <Tombol varian="ghost" kritis disabled={menyimpan || tendered === 0} onClick={() => setTendered(0)}>
          Hapus
        </Tombol>
        <Tombol varian="ghost" kritis disabled={menyimpan} onClick={onKembali}>
          Kembali
        </Tombol>
      </div>

      {galat && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galat}
        </p>
      )}

      <Tombol varian="primary" kritis disabled={menyimpan || tendered === 0} onClick={bayar}>
        {menyimpan ? 'Menyimpan…' : 'Simpan Penjualan'}
      </Tombol>
    </div>
  );
}
