import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, Icon } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { RentangTanggal, hariIni, type Outlet } from './RentangTanggal.tsx';
import { rentangSiap, type Rentang } from './b16.ts';

/**
 * B-20 — Ekspor (`IA:§3.3`, akses minimum Akuntan).
 *
 * ## ⛔ Unduhan tidak dapat memakai `<a href>` biasa
 *
 * Endpointnya menuntut `Authorization: Bearer` dan `X-Tenant-Id`; sebuah tautan
 * mengirim permintaan TANPA header apa pun dan mendarat di 401. Berkas karena
 * itu diambil lewat `fetch` bersama header sesi, lalu disodorkan sebagai blob.
 *
 * Konsekuensinya nyata dan dicatat: seluruh CSV dimuat ke memori lebih dulu.
 * Untuk laporan yang bentuknya ringkasan — empat sampai beberapa ratus baris —
 * itu tidak menjadi soal. Ekspor transaksi mentah, kalau kelak dibangun, akan
 * membutuhkan jalur lain.
 *
 * ## Nama berkas datang dari server
 *
 * `content-disposition` sudah memuat jenis dan rentangnya. Menyusunnya lagi di
 * klien berarti dua tempat menamai satu berkas, dan yang menyimpang
 * menghasilkan folder unduhan berisi nama yang tidak cocok dengan isinya.
 */

const JENIS = [
  { nilai: 'sales', judul: 'Penjualan', catatan: 'Omzet, pembatalan, refund, pajak.' },
  { nilai: 'products', judul: 'Produk', catatan: 'Barang keluar per varian.' },
  { nilai: 'cashiers', judul: 'Kasir', catatan: 'Posisi penjualan per orang.' },
  {
    nilai: 'payments',
    judul: 'Pembayaran',
    catatan: 'Uang diterima per metode, beserta perkiraan potongan penyelenggara.',
  },
  {
    nilai: 'recap',
    judul: 'Rekapitulasi pajak',
    catatan:
      'Untuk akuntan: pajak dipisah per jenis dan yurisdiksi, plus diskon, service charge, ' +
      'dan pembulatan. Periode dan tanggal dibuat ikut di dalam berkas.',
  },
] as const;

type Keadaan =
  | { jenis: 'siap' }
  | { jenis: 'mengunduh' }
  | { jenis: 'selesai'; nama: string }
  | { jenis: 'galat'; pesan: string };

export function EksporLayar() {
  const { api: _api, sesi, baseUrl } = useSesi();
  const [rentang, setRentang] = useState<Rentang>(() => ({ dari: hariIni(), sampai: hariIni() }));
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [jenis, setJenis] = useState<string>('sales');
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'siap' });

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await _api.minta<Outlet[]>('/outlets');
        if (!batal) setOutlet(o);
      } catch {
        // Penyaring outlet hilang; ekspor seluruh tenant tetap dapat dijalankan.
      }
    })();
    return () => {
      batal = true;
    };
  }, [_api]);

  const unduh = useCallback(async () => {
    if (!rentangSiap(rentang) || !sesi) return;
    setKeadaan({ jenis: 'mengunduh' });

    const kueri = new URLSearchParams({ type: jenis, from: rentang.dari, to: rentang.sampai });
    if (outletId.length > 0) kueri.set('outlet_id', outletId);

    try {
      // ⛔ Header sesi WAJIB ikut — lihat catatan kepala berkas.
      const res = await fetch(`${baseUrl}/reports/export?${kueri.toString()}`, {
        headers: {
          authorization: `Bearer ${sesi.token}`,
          'x-tenant-id': sesi.tenantId,
          'x-actor-id': sesi.userId,
        },
      });

      if (!res.ok) {
        // Server menjawab JSON pada kegagalan, CSV pada keberhasilan.
        const teks = await res.text();
        let pesan = `Ekspor gagal (${res.status}).`;
        try {
          pesan = JSON.parse(teks)?.error?.message ?? pesan;
        } catch {
          // Bukan JSON — pakai pesan bawaan.
        }
        throw new GalatHttp(res.status, 'EXPORT_FAILED', pesan);
      }

      // Nama berkas dari `content-disposition` server, bukan disusun ulang.
      const disposisi = res.headers.get('content-disposition') ?? '';
      const cocok = /filename="([^"]+)"/.exec(disposisi);
      const nama = cocok?.[1] ?? `lumi-${jenis}-${rentang.dari}_${rentang.sampai}.csv`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nama;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Dibebaskan setelah klik; tanpa ini blob-nya bertahan sampai tab ditutup.
      URL.revokeObjectURL(url);

      setKeadaan({ jenis: 'selesai', nama });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Ekspor butuh koneksi.',
      });
    }
  }, [baseUrl, sesi, jenis, rentang, outletId]);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '84ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Ekspor</span>
        <span className="t-caption">
          Mengunduh laporan sebagai berkas CSV yang dapat dibuka Excel atau Google Sheets.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <RentangTanggal
            rentang={rentang}
            onRentang={setRentang}
            outlet={outlet}
            outletId={outletId}
            onOutlet={setOutletId}
            sedangMuat={false}
            onTampilkan={() => void unduh()}
            catatan="Angkanya sama persis dengan yang tampil di layar laporan."
          />
        </div>
      </Card>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Jenis laporan</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {JENIS.map((j) => (
                  <Tombol
                    key={j.nilai}
                    varian={jenis === j.nilai ? 'primary' : 'secondary'}
                    onClick={() => {
                      setJenis(j.nilai);
                      setKeadaan({ jenis: 'siap' });
                    }}
                  >
                    {j.judul}
                  </Tombol>
                ))}
              </div>
              <span className="t-caption">
                {JENIS.find((j) => j.nilai === jenis)?.catatan}
              </span>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol
                varian="primary"
                disabled={!rentangSiap(rentang) || keadaan.jenis === 'mengunduh'}
                onClick={() => void unduh()}
              >
                {keadaan.jenis === 'mengunduh' ? 'Menyiapkan…' : 'Unduh CSV'}
              </Tombol>

              {keadaan.jenis === 'selesai' ? (
                // Status membawa TEKS, tidak pernah warna saja (aturan DS #5).
                <span className="t-caption" role="status">
                  Terunduh: <span className="num">{keadaan.nama}</span>
                </span>
              ) : null}
              {keadaan.jenis === 'galat' ? (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {keadaan.pesan}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {keadaan.jenis === 'siap' ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name="download" size={32} />}
              title="Belum ada berkas diunduh"
              body="Pilih rentang tanggal dan jenis laporan, lalu tekan Unduh CSV. Berkasnya masuk ke folder unduhan browser Anda."
            />
          </div>
        </Card>
      ) : null}

      <span className="t-caption">
        Angka di CSV dihitung server dengan fungsi yang sama persis dengan layar laporan — berkas
        yang Anda bawa ke akuntan tidak akan berbeda dari yang Anda lihat di sini. Uang ditulis
        tanpa titik ribuan supaya dapat dijumlahkan spreadsheet.
      </span>
    </div>
  );
}
