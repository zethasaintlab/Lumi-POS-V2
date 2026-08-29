import { useState } from 'react';
import { batalkan, rencanaPembatalan, type HasilPembatalan } from '../kasir/pembatalan.ts';
import { nilaiRefundBaris } from '../../../../packages/domain/src/pilihan-refund.ts';
import { tampilkanKuantitas } from '../../../../packages/domain/src/kuantitas.ts';
import type { BarisDetail } from '../riwayat/baca.ts';
import { ALASAN_REFUND, ALASAN_VOID, validasiAlasan } from '../identitas/otorisasi.ts';
import { DialogOtorisasi } from './DialogOtorisasi.tsx';
import { Tombol } from '../Tombol.tsx';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import type { Sesi } from '../identitas/login.ts';
import { muatHlc } from '../lokal/hlc.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* K-10 — Batalkan transaksi (IA §2.2, FR-B7).

   ⛔ Satu tombol, dan kasir TIDAK memilih operasinya (`spec-b:235`). Dialog
   ini membaca status order, memberi tahu kasir apa yang AKAN terjadi, lalu
   meminta hal yang sesuai:

     void   → alasan saja (keputusan user 1 Agustus 2026: tanpa PIN manajer)
     refund → alasan + nominal + PIN manajer lewat K-11

   Judulnya menyebut operasinya karena kasir harus tahu konsekuensinya —
   "batalkan" yang mengembalikan uang dan "batalkan" yang hanya membuang
   keranjang adalah dua hal berbeda bagi orang di depan mesin. */

interface Props {
  orderId: string;
  statusOrder: string;
  sisaDapatDirefund: number;
  /** Baris order, untuk pemilihan refund parsial (FR-B7). */
  baris: readonly BarisDetail[];
  /** `order.total` — bobot alokasi nilai refund per baris. */
  orderTotal: number;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  onBatal: () => void;
  onSelesai: (hasil: Extract<HasilPembatalan, { status: 'tersimpan' }>) => void;
}

export function DialogPembatalan({
  orderId,
  statusOrder,
  sisaDapatDirefund,
  baris,
  orderTotal,
  konfig,
  sesi,
  onBatal,
  onSelesai,
}: Props) {
  const { db, pemberitahu } = useDbLokal();
  const [kode, setKode] = useState('');
  const [catatan, setCatatan] = useState('');
  const [jumlah, setJumlah] = useState(sisaDapatDirefund);
  /* FR-B7 — kuantitas per baris yang dipilih kasir (×1000), lineId → milli.

     ⛔ Bermula KOSONG, bukan penuh. `lines: []` berarti "uang kembali tanpa
     barang kembali", dan itu keadaan yang SAH — pelanggan yang kopinya tumpah
     tidak mengembalikan kopinya. Memulai dengan seluruh baris terpilih
     membuat restock menjadi bawaan diam-diam, dan stok yang mengembang baru
     ketahuan saat opname. */
  const [pilihan, setPilihan] = useState<Record<string, number>>({});
  const [mintaOtorisasi, setMintaOtorisasi] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);

  let rencana;
  try {
    rencana = rencanaPembatalan(statusOrder);
  } catch {
    return (
      <div className="kasir-dialog-latar" role="dialog" aria-modal="true">
        <div className="kasir-dialog">
          <h2 className="t-title">Tidak dapat dibatalkan</h2>
          <p className="t-body-md">Transaksi ini sudah dibatalkan sebelumnya.</p>
          <div className="kasir-dialog-aksi">
            <Tombol varian="primary" kritis onClick={onBatal}>
              Tutup
            </Tombol>
          </div>
        </div>
      </div>
    );
  }

  // Bentuk yang `batalkan` terima. Kuantitas nol dibuang di sini, bukan
  // dikirim — `periksaPilihan` MENOLAKNYA, dan sengaja: baris ber-kuantitas
  // nol terbaca sebagai "baris ini kembali" oleh mata dan "tidak ada yang
  // kembali" oleh server.
  const terpilih = Object.entries(pilihan)
    .filter(([, q]) => q > 0)
    .map(([lineId, quantityMilli]) => ({ lineId, quantityMilli }));

  /* Nilai yang SEPADAN dengan baris terpilih.

     ⛔ Dihitung `packages/domain/src/pilihan-refund.ts`, bukan dijumlahkan
     dari `lineTotal` di sini: `line_total` belum kena pajak eksklusif, jadi
     penjumlahannya mengembalikan uang lebih sedikit daripada yang pelanggan
     bayar — dan salahnya diam. */
  const nilaiSepadan = nilaiRefundBaris(
    baris.map((b) => ({
      lineId: b.id,
      variationId: b.variationId,
      quantityMilli: BigInt(b.quantityMilli),
      lineTotal: BigInt(b.lineTotal),
    })),
    BigInt(orderTotal),
    terpilih.map((t) => ({ lineId: t.lineId, quantityMilli: BigInt(t.quantityMilli) }))
  );

  const ubahBaris = (lineId: string, milli: number) =>
    setPilihan((p) => {
      const berikut = { ...p };
      if (milli <= 0) delete berikut[lineId];
      else berikut[lineId] = milli;
      return berikut;
    });

  const daftarAlasan = rencana.operasi === 'void' ? ALASAN_VOID : ALASAN_REFUND;
  const galatAlasan = kode === '' ? null : validasiAlasan(daftarAlasan, kode, catatan || null);
  const siap = kode !== '' && galatAlasan === null && (rencana.operasi === 'void' || jumlah > 0);

  const jalankan = (approverId: string | null) => {
    setMenyimpan(true);
    setGalat(null);
    void muatHlc(db, () => Date.now())
      .then((hlc) =>
        batalkan({
          db,
          konfig,
          sesi,
          orderId,
          alasan: { kode, catatan: catatan || null },
          approverId,
          jumlah: rencana.operasi === 'refund' ? jumlah : undefined,
          // ⛔ Baris yang benar-benar DIPILIH kasir. Daftar kosong tetap sah
          // dan berarti "uang kembali tanpa barang kembali"; layar
          // menyatakannya alih-alih menebak.
          lines: terpilih,
          waktu: () => new Date(),
          idBaru: () => crypto.randomUUID(),
          hlc: () => hlc.tick(),
        })
      )
      .then((hasil) => {
        if (hasil.status === 'tersimpan') {
          pemberitahu.beritahu();
          onSelesai(hasil);
          return;
        }
        setGalat(pesanGagal(hasil));
      })
      .catch((e: Error) => setGalat(`Pembatalan TIDAK tersimpan: ${e.message}`))
      .finally(() => {
        setMenyimpan(false);
        setMintaOtorisasi(false);
      });
  };

  if (mintaOtorisasi) {
    return (
      <DialogOtorisasi
        aktorId={sesi.userId}
        // ⛔ TANPA `daftarAlasan`: kasir sudah memilihnya di langkah
        // sebelumnya. Memintanya lagi berarti manajer mengulang pilihan kasir
        // di depan pelanggan — dan pilihan keduanya dibuang, karena yang
        // ditulis adalah `kode` dari dialog ini.
        judul={`Otorisasi ${rupiah(jumlah)}`}
        onBatal={() => setMintaOtorisasi(false)}
        onSetuju={({ approverId }) => jalankan(approverId)}
      />
    );
  }

  return (
    <div className="kasir-dialog-latar" role="dialog" aria-modal="true" aria-label="Batalkan transaksi">
      <div className="kasir-dialog">
        <h2 className="t-title">
          {rencana.operasi === 'void' ? 'Batalkan transaksi' : 'Kembalikan dana'}
        </h2>
        <p className="t-caption kasir-login-sub">
          {rencana.operasi === 'void'
            ? 'Transaksi belum dibayar. Stok akan dikembalikan.'
            : `Transaksi sudah dibayar. Maksimal ${rupiah(sisaDapatDirefund)}.`}
        </p>

        {rencana.operasi === 'refund' && baris.length > 0 && (
          <fieldset className="kasir-alasan">
            <legend className="t-body-md">Barang yang kembali</legend>
            {/* ⛔ Terpisah dari nominal, dan sengaja. Uang yang kembali dan
                barang yang kembali adalah dua keputusan berbeda: pelanggan
                yang kopinya tumpah menerima uangnya tanpa mengembalikan
                kopinya. Menggabungkannya jadi satu tombol "refund penuh" akan
                menambah stok yang tidak pernah kembali ke rak. */}
            {baris.map((b) => {
              const dipilih = pilihan[b.id] ?? 0;
              const habis = b.sisaKembaliMilli <= 0;
              return (
                <div key={b.id} className="kasir-alasan-opsi t-body-md">
                  <label>
                    <input
                      type="checkbox"
                      checked={dipilih > 0}
                      disabled={habis || menyimpan}
                      onChange={() => ubahBaris(b.id, dipilih > 0 ? 0 : b.sisaKembaliMilli)}
                    />
                    {b.itemName}
                    {b.variationName ? ` — ${b.variationName}` : ''}
                  </label>{' '}
                  <span className="t-caption num">
                    {habis
                      ? 'sudah dikembalikan'
                      : `maks ${tampilkanKuantitas(String(b.sisaKembaliMilli))}`}
                  </span>
                </div>
              );
            })}
            <p className="t-caption">
              {terpilih.length === 0
                ? 'Tidak ada barang yang kembali ke rak. Uang tetap dikembalikan.'
                : `Nilai barang terpilih: ${rupiah(Number(nilaiSepadan))}.`}
            </p>
          </fieldset>
        )}

        {rencana.operasi === 'refund' && (
          <>
            <p className="t-body-md">Jumlah dikembalikan</p>
            <p className="t-display num">{rupiah(jumlah)}</p>
            <div className="kasir-pecahan">
              <Tombol kritis disabled={menyimpan} onClick={() => setJumlah(sisaDapatDirefund)}>
                Seluruhnya
              </Tombol>
              {/* ⛔ Menyalin nilai barang terpilih ke nominal, bukan mengunci
                  keduanya. Kasir tetap boleh mengembalikan uang tanpa barang,
                  dan barang tanpa seluruh uangnya (potongan ongkos kirim,
                  misalnya) — keduanya keadaan nyata. */}
              <Tombol
                varian="ghost"
                kritis
                disabled={menyimpan || terpilih.length === 0}
                onClick={() => setJumlah(Math.min(sisaDapatDirefund, Number(nilaiSepadan)))}
              >
                Sesuai barang
              </Tombol>
              <Tombol
                varian="ghost"
                kritis
                disabled={menyimpan || jumlah < 10000}
                onClick={() => setJumlah((j) => Math.max(0, j - 10000))}
              >
                − {rupiah(10000)}
              </Tombol>
            </div>
          </>
        )}

        <fieldset className="kasir-alasan">
          <legend className="t-body-md">Alasan</legend>
          {daftarAlasan.map((a) => (
            <label key={a.kode} className="kasir-alasan-opsi t-body-md">
              <input
                type="radio"
                name="alasan-batal"
                checked={kode === a.kode}
                onChange={() => setKode(a.kode)}
              />
              {a.label}
            </label>
          ))}
        </fieldset>

        {kode === 'lainnya' && (
          <textarea
            className="kasir-catatan"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="Jelaskan alasannya (minimal 10 karakter)"
            rows={2}
          />
        )}

        {(galatAlasan || galat) && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galatAlasan ?? galat}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis disabled={menyimpan} onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol
            varian="danger"
            kritis
            disabled={!siap || menyimpan}
            onClick={() => {
              // Refund menuntut PIN manajer; void tidak. Yang menentukan
              // adalah `rencana`, bukan pilihan kasir.
              if (rencana.butuhPenyetuju) setMintaOtorisasi(true);
              else jalankan(null);
            }}
          >
            {menyimpan ? 'Menyimpan…' : rencana.operasi === 'void' ? 'Batalkan' : 'Kembalikan dana'}
          </Tombol>
        </div>
      </div>
    </div>
  );
}

function pesanGagal(hasil: HasilPembatalan): string {
  switch (hasil.status) {
    case 'tidak_ditemukan':
      return 'Transaksi tidak ditemukan di perangkat ini.';
    case 'tidak_dapat_dibatalkan':
      return hasil.pesan;
    case 'butuh_penyetuju':
      return 'Pengembalian dana menuntut persetujuan manajer.';
    case 'penyetuju_sama_dengan_aktor':
      return 'Anda tidak dapat menyetujui pembatalan Anda sendiri.';
    case 'alasan_tidak_berlaku':
      return hasil.pesan;
    case 'melebihi_sisa':
      return `Melebihi sisa yang dapat dikembalikan (${rupiah(hasil.sisa)}).`;
    default:
      return 'Pembatalan gagal.';
  }
}
