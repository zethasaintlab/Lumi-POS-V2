import { useCallback, useEffect, useState } from 'react';
import { Tombol } from './Tombol.tsx';
import { Ringkasan } from './ringkasan/Ringkasan.tsx';
import { PerluDiperiksa } from './perlu/PerluDiperiksa.tsx';
import { Laporan } from './laporan/Laporan.tsx';
import { ITEM_NAV, navAktif, type Rute } from './navigasi.ts';
import { useSesi } from '../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../packages/klien-api/src/http.ts';
import type { KeadaanLayar, RingkasanHarian } from './ringkasan/m01.ts';
import type { KeadaanPerlu, PerluPerhatian } from './perlu/m02.ts';

/**
 * Induk ketiga layar Owner mobile.
 *
 * ## ⛔ Pengambilan data ada DI SINI, bukan di tiap layar
 *
 * M-01 meringkas daftar yang M-02 tampilkan penuh, dan M-03 menghitung
 * rentangnya dari tanggal yang M-01 terima. Tiga layar yang memintanya
 * sendiri-sendiri menghasilkan tiga jawaban yang dapat berbeda — owner yang
 * membuka daftar dari "3 hal perlu diperiksa" lalu melihat empat baris tidak
 * punya cara memahami selisihnya.
 *
 * ## ⛔ Rute disimpan di state, bukan di URL
 *
 * Berbeda dari `apps/kasir` dan `apps/backoffice`, yang punya router sendiri.
 * Di sini ia tiga layar tanpa satu pun yang berguna di-bookmark: M-02 adalah
 * drill-down dari peringatan yang mungkin sudah tidak ada besok, dan M-03
 * bergantung pada tanggal yang M-01 ambil. URL yang dapat disalin ke tab lain
 * akan mendarat di layar yang datanya belum ada.
 */

interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

export function Beranda() {
  const { api, keluar } = useSesi();
  const [rute, setRute] = useState<Rute>('M-01');
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [outletId, setOutletId] = useState('');

  const [data, setData] = useState<RingkasanHarian | null>(null);
  const [keadaan, setKeadaan] = useState<KeadaanLayar>('memuat');

  const [perlu, setPerlu] = useState<PerluPerhatian | null>(null);
  const [keadaanPerlu, setKeadaanPerlu] = useState<KeadaanPerlu>('memuat');

  // Daftar outlet dimuat sekali. Kegagalannya TIDAK menghentikan ringkasan:
  // tanpa daftar, permintaan lintas-outlet tetap sah selama seluruh outlet
  // sepakat zona waktunya.
  useEffect(() => {
    let batal = false;
    api
      .minta<Outlet[]>('/outlets')
      .then((hasil) => {
        if (!batal) setOutlets(hasil.filter((o) => o.archivedAt === null));
      })
      .catch(() => {
        if (!batal) setOutlets([]);
      });
    return () => {
      batal = true;
    };
  }, [api]);

  const muatRingkasan = useCallback(async () => {
    setKeadaan('memuat');
    try {
      // ⛔ TANPA `date`. Server yang menghitung tanggal bisnisnya.
      const q = outletId === '' ? '' : `?outlet_id=${encodeURIComponent(outletId)}`;
      setData(await api.minta<RingkasanHarian>(`/reports/daily-summary${q}`));
      setKeadaan('siap');
    } catch (err) {
      setData(null);
      // ⛔ Ketiga sebab dibedakan. "Tidak berhak" dan "hari ini ambigu" punya
      // tindakan yang sangat berbeda dari "coba lagi", dan menyatukannya
      // membuat owner menekan tombol yang tidak akan pernah menolongnya.
      if (err instanceof GalatHttp && err.status === 403) setKeadaan('tidak-berhak');
      else if (err instanceof GalatHttp && err.kode === 'BUSINESS_DATE_AMBIGUOUS')
        setKeadaan('ambigu');
      else setKeadaan('gagal');
    }
  }, [api, outletId]);

  const muatPerlu = useCallback(async () => {
    setKeadaanPerlu('memuat');
    try {
      const q = outletId === '' ? '' : `?outlet_id=${encodeURIComponent(outletId)}`;
      setPerlu(await api.minta<PerluPerhatian>(`/reports/needs-attention${q}`));
      setKeadaanPerlu('siap');
    } catch (err) {
      // ⛔ `null`, bukan daftar kosong. Nol temuan dan "belum tahu" adalah dua
      // keadaan yang berbeda, dan yang kedua tidak boleh terbaca sebagai yang
      // pertama.
      setPerlu(null);
      setKeadaanPerlu(err instanceof GalatHttp && err.status === 403 ? 'tidak-berhak' : 'gagal');
    }
  }, [api, outletId]);

  useEffect(() => {
    void muatRingkasan();
    void muatPerlu();
  }, [muatRingkasan, muatPerlu]);

  const aktif = navAktif(rute);

  return (
    <div className="stack" style={{ gap: 0, minHeight: '100dvh' }}>
      <div style={{ flex: 1 }}>
        {rute === 'M-01' && (
          <Ringkasan
            data={data}
            keadaan={keadaan}
            outlets={outlets}
            outletId={outletId}
            onOutlet={setOutletId}
            onCobaLagi={() => void muatRingkasan()}
            perlu={perlu}
            onBukaPerlu={() => setRute('M-02')}
          />
        )}
        {rute === 'M-02' && (
          <PerluDiperiksa
            data={perlu}
            keadaan={keadaanPerlu}
            onKembali={() => setRute('M-01')}
            onCobaLagi={() => void muatPerlu()}
          />
        )}
        {rute === 'M-03' && <Laporan dasar={data?.tanggal ?? null} outletId={outletId} />}
      </div>

      {/* ⛔ Dua item, dan penambahan ketiga adalah perubahan IA (`IA:253`).
          Dirender dari `ITEM_NAV`, bukan sebagai dua tombol yang ditulis
          tangan — daftar yang hidup di JSX tidak dapat dijaga test. */}
      <nav
        className="row nav-bawah"
        style={{ gap: 'var(--space-2)', padding: 'var(--space-3)' }}
      >
        {ITEM_NAV.map((item) => (
          <span key={item.id} style={{ flex: 1 }}>
            <Tombol
              varian={item.id === aktif ? 'primary' : 'ghost'}
              penuh
              onClick={() => setRute(item.rute)}
            >
              {item.label}
            </Tombol>
          </span>
        ))}
      </nav>

      <div style={{ padding: 'var(--space-4)' }}>
        <Tombol varian="ghost" penuh onClick={() => void keluar()}>
          Keluar
        </Tombol>
      </div>
    </div>
  );
}
