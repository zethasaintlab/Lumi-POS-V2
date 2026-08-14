import type { Rute } from '../rute/tabel.ts';
import { BelumDibangun } from './BelumDibangun.tsx';
import { BukaShift } from './BukaShift.tsx';
import { Kasir } from './Kasir.tsx';
import { DetailTransaksi } from './DetailTransaksi.tsx';
import { Perangkat } from './Perangkat.tsx';
import { Riwayat } from './Riwayat.tsx';
import { StatusSinkronisasi } from './StatusSinkronisasi.tsx';
import { TutupKas } from './TutupKas.tsx';

/* Pemetaan kode layar IA §2.2 ke komponennya.

   Layar yang belum dibangun jatuh ke `BelumDibangun` -- satu komponen untuk
   semuanya, bukan tujuh berkas kosong. Yang sudah dibangun didaftarkan di
   sini, dan tidak ada tempat lain yang perlu tahu. */
/* Komponen menerima `params` rute. Hanya K-09 memakainya hari ini, tapi
   bentuknya seragam: layar yang butuh parameter tidak boleh menuntut
   perubahan di pemetaan ini setiap kali satu ditambahkan. */
const LAYAR: Record<string, (p: { params: Record<string, string> }) => React.ReactElement> = {
  'K-02': BukaShift,
  'K-03': Kasir,
  'K-08': Riwayat,
  'K-09': ({ params }) => <DetailTransaksi orderId={params.orderId} />,
  'K-12': TutupKas,
  'K-14': StatusSinkronisasi,
  'K-15': Perangkat,
};

export function Layar({ rute, params = {} }: { rute: Rute | null; params?: Record<string, string> }) {
  const Komponen = rute ? LAYAR[rute.layar] : undefined;
  if (Komponen) return <Komponen params={params} />;
  return <BelumDibangun rute={rute} />;
}
