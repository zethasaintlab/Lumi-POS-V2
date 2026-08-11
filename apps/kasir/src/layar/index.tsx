import type { Rute } from '../rute/tabel.ts';
import { BelumDibangun } from './BelumDibangun.tsx';
import { BukaShift } from './BukaShift.tsx';
import { Perangkat } from './Perangkat.tsx';
import { StatusSinkronisasi } from './StatusSinkronisasi.tsx';

/* Pemetaan kode layar IA §2.2 ke komponennya.

   Layar yang belum dibangun jatuh ke `BelumDibangun` -- satu komponen untuk
   semuanya, bukan tujuh berkas kosong. Yang sudah dibangun didaftarkan di
   sini, dan tidak ada tempat lain yang perlu tahu. */
const LAYAR: Record<string, () => React.ReactElement> = {
  'K-02': BukaShift,
  'K-14': StatusSinkronisasi,
  'K-15': Perangkat,
};

export function Layar({ rute }: { rute: Rute | null }) {
  const Komponen = rute ? LAYAR[rute.layar] : undefined;
  if (Komponen) return <Komponen />;
  return <BelumDibangun rute={rute} />;
}
