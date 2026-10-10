import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from 'ds';
import { Tombol } from '../Tombol.tsx';
import { Memuat } from './Memuat.tsx';
import { GagalBaca } from './GagalBaca.tsx';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { bacaKonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { bangunUlangStruk } from '../cetak/ulang.ts';
import { cetakUlangOrder, kalimatCetak } from '../cetak/cetak-ulang.ts';
import { tataLetakStruk, type ReceiptDocument } from '../cetak/escpos.ts';
import { bacaProfilPrinter, PROFIL_58MM, PROFIL_80MM } from '../cetak/profil.ts';
import { bacaPilihanProfil } from '../cetak/pilihan.ts';
import { profilBerlaku } from '../cetak/berlaku.ts';
import type { PrinterProfile } from '../cetak/escpos.ts';

/* Pratinjau struk (spec § 8) — MODE, bukan rute.

   ⛔ Satu formatter: dokumennya dari `bangunUlangStruk` (jalur cetak ulang
   K-09), barisnya dari `tataLetakStruk` — fungsi yang SAMA dengan
   `renderEscPos`. Tidak ada tata letak kedua di berkas ini. Perataan tengah
   dirender dengan `text-align`, bukan spasi (printer: `ESC a`). */

type Lebar = 'berlaku' | '58' | '80';

export function PratinjauStruk({ orderId, onTutup }: { orderId: string; onTutup: () => void }) {
  const { db } = useDbLokal();
  const [dok, setDok] = useState<ReceiptDocument | null | undefined>(undefined);
  const [berlaku, setBerlaku] = useState<PrinterProfile | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [gagal, setGagal] = useState<string | null>(null);
  const [pilih, setPilih] = useState<Lebar>('berlaku');
  const [mencetak, setMencetak] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const konfig = await bacaKonfigPerangkat(db);
      const [outlet] = konfig
        ? await db.getAll<{ name: string }>('SELECT name FROM outlet WHERE id = ?', [konfig.outletId])
        : [];
      const [daftar, dipilih] = await Promise.all([bacaProfilPrinter(db), bacaPilihanProfil(db)]);
      const d = await bangunUlangStruk(db, orderId, { namaMerchant: outlet?.name ?? '' });
      if (!hidup) return;
      setOutletId(konfig?.outletId ?? '');
      setBerlaku(profilBerlaku(daftar, dipilih).profil ?? PROFIL_58MM);
      setDok(d);
    })().catch((e: Error) => {
      if (hidup) setGagal(e.message);
    });
    return () => {
      hidup = false;
    };
  }, [db, orderId]);

  const profil = pilih === '58' ? PROFIL_58MM : pilih === '80' ? PROFIL_80MM : berlaku;
  const baris = useMemo(() => (dok && profil ? tataLetakStruk(dok, profil) : []), [dok, profil]);
  const lebarAktif = profil ? (profil.paperWidthMm >= 80 ? '80' : '58') : null;

  if (gagal) {
    return <GagalBaca akibat="Struk ini tidak dapat dibangun untuk pratinjau; transaksinya tetap tersimpan." pesan={gagal} />;
  }
  if (dok === undefined || !profil) return <Memuat judul="Menyusun struk…" bentuk="baris" jumlah={5} />;

  async function cetak() {
    setMencetak(true);
    setPesan(null);
    try {
      setPesan(kalimatCetak(await cetakUlangOrder(db, orderId, outletId ?? ''), true));
    } catch (e) {
      setPesan(`Gagal mencetak: ${(e as Error).message}`);
    } finally {
      setMencetak(false);
    }
  }

  const tutup = (
    <Tombol varian="ghost" kritis onClick={onTutup}>
      Tutup
    </Tombol>
  );

  if (dok === null) {
    return (
      <div className="kasir-pratinjau" data-pratinjau="struk-kosong">
        <h2 className="t-title">Pratinjau struk</h2>
        <EmptyState title="Struk tidak tersedia" body="Transaksi ini tidak dapat dibangun ulang menjadi struk." />
        {tutup}
      </div>
    );
  }

  return (
    <div
      className="kasir-pratinjau"
      data-pratinjau="struk"
      data-lebar={profil.charsPerLine}
      data-dokumen={JSON.stringify(dok, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}
    >
      <h2 className="t-title">Pratinjau struk</h2>
      <div className="kasir-pratinjau-toggle" role="group" aria-label="Lebar kertas">
        {(['58', '80'] as const).map((w) => (
          <button
            key={w}
            type="button"
            className="btn btn-secondary"
            aria-pressed={lebarAktif === w}
            onClick={() => setPilih(w)}
          >
            {w}mm
          </button>
        ))}
      </div>

      <p className="t-caption kasir-login-sub">
        Lebar ini hanya untuk pratinjau. Struk dicetak sesuai printer yang terpasang.
      </p>

      <div className="kasir-kertas" aria-label="Pratinjau struk">
        {baris.map((b, i) => (
          <div
            key={i}
            className="kasir-kertas-baris"
            data-struk-baris=""
            data-rata={'garis' in b ? 'kiri' : b.rata}
            data-tebal={'garis' in b ? 'tidak' : b.tebal ? 'ya' : 'tidak'}
          >
            {b.teks}
          </div>
        ))}
      </div>

      {pesan && (
        <p className="t-caption" role="status" data-cetak="ulang">
          {pesan}
        </p>
      )}
      <div className="kasir-bayar-baris">
        {tutup}
        <Tombol varian="primary" kritis disabled={mencetak} onClick={() => void cetak()}>
          Cetak
        </Tombol>
      </div>
    </div>
  );
}
