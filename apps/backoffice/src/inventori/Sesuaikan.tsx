import { useEffect, useMemo, useState } from 'react';
import { Modal } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import {
  ALASAN_PENYESUAIAN,
  bacaKuantitas,
  kuantitasTampil,
  periksaIsian,
  susunBadan,
  type Isian,
  type TipeGerak,
} from './b12.ts';

/**
 * B-13 — Penyesuaian Stok, sebagai Modal di atas B-12.
 *
 * ## ⛔ Dua tipe yang perilakunya berbeda, dan bedanya harus terlihat
 *
 * **Barang masuk** tidak boleh negatif; **penyesuaian** wajib beralasan.
 * Keduanya ditegakkan server, dan diperiksa lagi di sini — bukan karena server
 * kurang dipercaya, melainkan karena merchant tidak boleh mengisi seluruh
 * formulir untuk mengetahui kesalahannya setelah perjalanan bolak-balik.
 *
 * ## ⛔ Kuantitas ditampilkan UTUH, dikirim ×1000
 *
 * Merchant mengetik `2,5`; API menerima `2500`. Konversinya di `b12.ts`,
 * seluruhnya manipulasi string, dengan test property yang menuntut
 * pembacaan dan penampilan saling membalik.
 */

interface Varian {
  id: string;
  itemName: string;
  variationName: string;
  trackStock: boolean;
}

interface Props {
  terbuka: boolean;
  outletId: string;
  namaOutlet: string;
  /** Varian yang sudah dipilih dari baris tabel, bila ada. */
  varianAwal?: string | null;
  varian: readonly Varian[];
  onTutup: () => void;
  /** Dipanggil setelah simpan berhasil — B-12 memuat ulang saldonya. */
  onSelesai: () => void;
}

const KOSONG = (outletId: string, variationId: string): Isian => ({
  outletId,
  variationId,
  tipe: 'receipt',
  kuantitas: '',
  alasan: '',
  catatan: '',
});

export function SesuaikanModal({
  terbuka,
  outletId,
  namaOutlet,
  varianAwal,
  varian,
  onTutup,
  onSelesai,
}: Props) {
  const { api } = useSesi();
  const [isian, setIsian] = useState<Isian>(() => KOSONG(outletId, varianAwal ?? ''));
  const [galatKirim, setGalatKirim] = useState<string | null>(null);
  const [mengirim, setMengirim] = useState(false);
  const [disentuh, setDisentuh] = useState(false);

  // Formulir diatur ulang setiap kali panel dibuka. Tanpa ini, penyesuaian
  // berikutnya mewarisi angka dan alasan yang sebelumnya — dan merchant yang
  // menekan simpan dua kali mencatat koreksi yang tidak ia maksudkan.
  useEffect(() => {
    if (!terbuka) return;
    setIsian(KOSONG(outletId, varianAwal ?? ''));
    setGalatKirim(null);
    setDisentuh(false);
  }, [terbuka, outletId, varianAwal]);

  const galat = useMemo(() => periksaIsian(isian), [isian]);
  const adaGalat = Object.keys(galat).length > 0;

  // Pratinjau: apa yang benar-benar dikirim. Merchant melihat 2,5 menjadi 2500
  // sebelum menekan simpan, bukan sesudahnya.
  const milli = bacaKuantitas(isian.kuantitas);

  const ubah = (bagian: Partial<Isian>) => setIsian((k) => ({ ...k, ...bagian }));

  const simpan = async () => {
    setDisentuh(true);
    if (adaGalat) return;
    setMengirim(true);
    setGalatKirim(null);
    try {
      await api.minta('/inventory/movements', { metode: 'POST', body: susunBadan(isian) });
      onSelesai();
      onTutup();
    } catch (err) {
      setGalatKirim(
        err instanceof GalatHttp
          ? err.message
          : 'Tidak dapat menghubungi server. Penyesuaian belum tersimpan.'
      );
    } finally {
      setMengirim(false);
    }
  };

  const tampilkanGalat = (kunci: keyof Isian) => (disentuh ? galat[kunci] : undefined);

  return (
    <Modal
      open={terbuka}
      title={isian.tipe === 'receipt' ? 'Barang masuk' : 'Penyesuaian stok'}
      onClose={onTutup}
      width={560}
      footer={
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <Tombol varian="primary" disabled={mengirim} onClick={() => void simpan()}>
            {mengirim ? 'Menyimpan…' : 'Simpan'}
          </Tombol>
          <Tombol onClick={onTutup}>Batal</Tombol>
        </div>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <span className="t-caption">
          Outlet: <strong>{namaOutlet}</strong>
        </span>

        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          <span className="label">Jenis</span>
          <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {(
              [
                ['receipt', 'Barang masuk'],
                ['adjustment', 'Penyesuaian / koreksi'],
              ] as [TipeGerak, string][]
            ).map(([kode, label]) => (
              <Tombol
                key={kode}
                varian={isian.tipe === kode ? 'primary' : 'secondary'}
                onClick={() => ubah({ tipe: kode })}
              >
                {label}
              </Tombol>
            ))}
          </div>
          <span className="t-caption">
            {isian.tipe === 'receipt'
              ? 'Barang masuk hanya menambah stok. Untuk mengurangi, pilih Penyesuaian.'
              : 'Penyesuaian boleh menambah atau mengurangi, dan wajib menyebut alasan.'}
          </span>
        </div>

        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          <label className="label" htmlFor="varian">
            Produk &amp; varian
          </label>
          <select
            id="varian"
            className="input"
            value={isian.variationId}
            onChange={(e) => ubah({ variationId: e.target.value })}
          >
            <option value="">— pilih —</option>
            {varian.map((v) => (
              <option key={v.id} value={v.id}>
                {v.itemName} — {v.variationName}
                {v.trackStock ? '' : ' (stok tidak dilacak)'}
              </option>
            ))}
          </select>
          {tampilkanGalat('variationId') ? (
            <span className="t-caption" role="alert">
              {galat.variationId}
            </span>
          ) : null}
        </div>

        <div className="stack" style={{ gap: 'var(--space-2)', maxWidth: '24ch' }}>
          <Bidang
            id="kuantitas"
            label="Jumlah"
            value={isian.kuantitas}
            required
            onChange={(v) => ubah({ kuantitas: v })}
            error={tampilkanGalat('kuantitas')}
          />
          {/* ⛔ Pratinjau nilai yang BENAR-BENAR dikirim. Konversi ×1000 adalah
              tempat cacat 10×/100× lahir di repo ini; menampilkannya membuat
              kesalahan terlihat sebelum tersimpan, bukan sesudah. */}
          {milli !== null ? (
            <span className="t-caption">
              Tercatat sebagai <span className="num">{kuantitasTampil(BigInt(milli))}</span> satuan.
            </span>
          ) : null}
        </div>

        {isian.tipe === 'adjustment' ? (
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <label className="label" htmlFor="alasan">
              Alasan
            </label>
            <select
              id="alasan"
              className="input"
              value={isian.alasan}
              onChange={(e) => ubah({ alasan: e.target.value })}
            >
              <option value="">— pilih —</option>
              {ALASAN_PENYESUAIAN.map((a) => (
                <option key={a.kode} value={a.kode}>
                  {a.label}
                </option>
              ))}
            </select>
            {tampilkanGalat('alasan') ? (
              <span className="t-caption" role="alert">
                {galat.alasan}
              </span>
            ) : null}
          </div>
        ) : null}

        <Bidang
          id="catatan"
          label="Catatan (opsional)"
          value={isian.catatan}
          onChange={(v) => ubah({ catatan: v })}
        />

        {galatKirim !== null ? (
          <span className="t-caption" role="alert">
            {galatKirim}
          </span>
        ) : null}

        <span className="t-caption">
          Setiap pergerakan stok dicatat permanen dan tidak dapat dihapus — koreksi berikutnya
          adalah baris baru, bukan perubahan atas baris ini.
        </span>
      </div>
    </Modal>
  );
}
