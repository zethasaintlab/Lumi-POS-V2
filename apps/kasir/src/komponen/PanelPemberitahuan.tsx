import { useEffect, useState } from 'react';
import { Icon } from 'ds';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { bacaPemberitahuan, type Pemberitahuan } from '../kasir/pemberitahuan.ts';
import { navigasi } from '../rute/navigasi.ts';

/**
 * P7(a), lonceng header — panel "Pemberitahuan perangkat" (spec § 3).
 *
 * ⛔ Popover, bukan dialog modal: ia tidak mengambil fokus dan tidak
 * menutupi layar — sama alasannya dengan `PitaAntrean` (FR-H8), meski di
 * sini bentuknya bukan banner karena isinya butuh ditutup secara eksplisit
 * (bukan menghilang sendiri saat antrean terkuras).
 *
 * `db` boleh `null` (database lokal belum siap saat shell dirender — lihat
 * `ShellKasir.tsx`); itu keadaan ERROR panel ini, bukan alasan untuk tidak
 * merender apa pun (aturan design system #7).
 */
export function PanelPemberitahuan({ db, onClose }: { db: DbLokal | null; onClose: () => void }) {
  const [keadaan, setKeadaan] = useState<'memuat' | 'siap' | 'error'>('memuat');
  const [daftar, setDaftar] = useState<Pemberitahuan[]>([]);
  const [pesanGalat, setPesanGalat] = useState('');

  useEffect(() => {
    if (!db) {
      setKeadaan('error');
      setPesanGalat('Database lokal belum siap.');
      return;
    }
    let hidup = true;
    setKeadaan('memuat');
    void bacaPemberitahuan(db, new Date())
      .then((hasil) => {
        if (!hidup) return;
        setDaftar(hasil);
        setKeadaan('siap');
      })
      .catch((e: Error) => {
        if (!hidup) return;
        setPesanGalat(e.message);
        setKeadaan('error');
      });
    return () => {
      hidup = false;
    };
  }, [db]);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const tuju = (jalur: string) => {
    onClose();
    navigasi(jalur);
  };

  return (
    <div className="kasir-panel-pemberitahuan card" role="dialog" aria-label="Pemberitahuan perangkat">
      <div className="kasir-panel-pemberitahuan-kepala">
        <h2 className="t-title">Pemberitahuan perangkat</h2>
        <button type="button" className="kasir-panel-pemberitahuan-tutup" aria-label="Tutup" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </div>

      {keadaan === 'memuat' && <p className="t-caption">Memuat…</p>}

      {keadaan === 'error' && (
        <p className="t-caption kasir-login-galat" role="alert">
          Pemberitahuan tidak dapat dibaca dari perangkat ini. {pesanGalat}
        </p>
      )}

      {keadaan === 'siap' && daftar.length === 0 && (
        <p className="t-caption">Tidak ada pemberitahuan. Semua antrean dan cetakan sudah terkirim.</p>
      )}

      {keadaan === 'siap' && daftar.length > 0 && (
        <ul className="kasir-baris-daftar">
          {daftar.map((p) => (
            <li key={p.jenis} className="kasir-baris">
              <span className="grow t-body-md">{p.kalimat}</span>
              {/* Angka SEBAGAI TEKS (aturan design system #5) — statusnya
                  tidak pernah sebuah titik berwarna saja. */}
              <span className="t-body-md num">{p.jumlah}</span>
              {p.tujuan !== null && (
                <button type="button" className="btn btn-ghost" onClick={() => tuju(p.tujuan!)}>
                  Lihat
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
