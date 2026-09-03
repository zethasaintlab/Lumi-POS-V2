import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { siapkanDariBerkas } from './gambar-kompres.ts';
import {
  BATAS_BYTE,
  MIME_SUMBER,
  SISI_PIKSEL,
  anggaranTampil,
} from '../../../../packages/domain/src/gambar-produk.ts';

/**
 * B-07 — gambar produk. DS #8 dicabut lebih jauh (keputusan user, 1 September
 * 2026): *"Card harusnya bergambar"*.
 *
 * ## ⛔ Ini FITUR, bukan perubahan tampilan
 *
 * `item.image_url` ada di skema sejak F0 dan tidak pernah dibaca, ditulis,
 * maupun disinkronkan; server tidak punya satu pun jalur unggah berkas.
 * Seluruhnya dari nol — dan yang paling mudah terlupa adalah bahwa gambar yang
 * merchant unggah di sini akan turun ke SETIAP perangkat di armadanya.
 *
 * ## ⛔ Anggaran armada DISEBUTKAN di layar, bukan hanya ditegakkan
 *
 * Merchant yang tidak tahu bahwa setiap foto menambah unduhan setiap tablet
 * akan memfoto seluruh 500 produknya lalu menemukan tagihan datanya di akhir
 * bulan. Angkanya datang dari `anggaranTampil` — fungsi yang sama yang
 * testnya kunci — bukan dari kalimat yang diketik di sini.
 *
 * ## ⛔ Kompresi terjadi SEBELUM unggah, dan hasilnya dinyatakan
 *
 * `siapkanDariBerkas` menuruni tangga kualitas sampai muat. Merchant melihat
 * berapa KB yang benar-benar terkirim — bukan ukuran berkas aslinya, yang
 * dapat 8 MB dan tidak pernah menyentuh jaringan.
 */

interface Props {
  itemId: string;
  /** Nama produk, untuk kalimat konfirmasi hapus. */
  namaItem: string;
}

type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'tanpa-gambar' }
  | { jenis: 'ada'; url: string; byte: number; diperbarui: string }
  | { jenis: 'gagal-memuat'; pesan: string };

const TERIMA = MIME_SUMBER.join(',');

export function GambarProduk({ itemId, namaItem }: Props) {
  const { api, sesi, baseUrl } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const berkasRef = useRef<HTMLInputElement | null>(null);

  /* ⛔ Object URL dilepas saat diganti DAN saat komponen dilepas. Tanpa itu
     setiap unggahan ulang meninggalkan blob yang bertahan sampai tab ditutup —
     dan layar ini adalah layar yang merchant pakai berulang kali saat memfoto
     seluruh katalognya. */
  const urlLama = useRef<string | null>(null);
  const pasangUrl = useCallback((url: string | null) => {
    if (urlLama.current) URL.revokeObjectURL(urlLama.current);
    urlLama.current = url;
  }, []);
  useEffect(() => () => pasangUrl(null), [pasangUrl]);

  const muat = useCallback(async () => {
    if (!sesi) return;
    setKeadaan({ jenis: 'memuat' });
    try {
      /* ⛔ `fetch` mentah dengan header sesi, bukan `api.minta`.
         Endpointnya menjawab BINER (`image/webp`); `minta` mem-`JSON.parse`
         setiap respons. Preseden dan alasannya sama dengan unduhan CSV di
         B-20 — sebuah `<img src>` biasa mengirim permintaan tanpa header apa
         pun dan mendarat di 401. */
      const res = await fetch(`${baseUrl}/items/${itemId}/image`, {
        headers: {
          authorization: `Bearer ${sesi.token}`,
          'x-tenant-id': sesi.tenantId,
          'x-actor-id': sesi.userId,
        },
      });

      /* ⛔ 404 adalah keadaan NORMAL, bukan kegagalan. Produk yang belum
         difoto adalah keadaan paling umum di merchant baru, dan menampilkan
         pesan galat untuknya membuat katalog yang sehat terlihat rusak. */
      if (res.status === 404) {
        pasangUrl(null);
        setKeadaan({ jenis: 'tanpa-gambar' });
        return;
      }
      if (!res.ok) {
        setKeadaan({
          jenis: 'gagal-memuat',
          pesan: `Gambar tidak dapat dimuat (${res.status}). Gambarnya mungkin masih ada.`,
        });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      pasangUrl(url);
      setKeadaan({
        jenis: 'ada',
        url,
        byte: blob.size,
        // Server menyetel `cache-control: no-store`; `last-modified` tidak
        // dikirim, jadi waktunya diambil dari metadata di bawah bila ada.
        diperbarui: res.headers.get('last-modified') ?? '',
      });
    } catch {
      /* ⛔ Kegagalan JARINGAN dibedakan dari "belum punya gambar". Keduanya
         menghasilkan layar tanpa gambar, dan yang menyamakannya membuat
         merchant mengunggah ulang foto yang sebenarnya sudah tersimpan. */
      setKeadaan({
        jenis: 'gagal-memuat',
        pesan: 'Gambar tidak dapat dimuat — server tidak terjangkau.',
      });
    }
  }, [baseUrl, itemId, sesi, pasangUrl]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function pilihBerkas(berkas: File) {
    setPesan(null);
    setSibuk('Mengompresi…');

    const hasil = await siapkanDariBerkas(berkas);
    if (!hasil.ok) {
      setSibuk(null);
      setPesan(hasil.pesan);
      return;
    }

    setSibuk(`Mengunggah ${Math.ceil(hasil.byte / 1024)} KB…`);
    try {
      await api.minta(`/items/${itemId}/image`, {
        metode: 'PUT',
        body: { data: hasil.base64, width: SISI_PIKSEL, height: SISI_PIKSEL },
      });
      setPesan(
        `Tersimpan — ${Math.ceil(hasil.byte / 1024)} KB pada kualitas ` +
          `${hasil.kualitasPersen}%. Gambar akan turun ke perangkat kasir pada ` +
          'sinkronisasi berikutnya.'
      );
      await muat();
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Gambar tidak dapat diunggah.');
    } finally {
      setSibuk(null);
      // Input dikosongkan supaya memilih berkas YANG SAMA lagi tetap memicu
      // `change` — merchant yang unggahannya gagal akan mencoba berkas itu lagi.
      if (berkasRef.current) berkasRef.current.value = '';
    }
  }

  async function hapus() {
    setPesan(null);
    setSibuk('Menghapus…');
    try {
      await api.minta(`/items/${itemId}/image`, { metode: 'DELETE' });
      pasangUrl(null);
      setKeadaan({ jenis: 'tanpa-gambar' });
      setPesan('Gambar dihapus. Kartu produk kembali tanpa gambar.');
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Gambar tidak dapat dihapus.');
    } finally {
      setSibuk(null);
    }
  }

  return (
    <Card>
      <div className="card-pad">
        <div className="stack" style={{ gap: 'var(--space-3)' }}>
          <span className="t-body-md">Gambar produk</span>

          <div className="row" style={{ gap: 'var(--space-4)', alignItems: 'flex-start' }}>
            <div className="bo-gambar-kotak" aria-live="polite">
              {keadaan.jenis === 'memuat' && <span className="t-caption">Memuat…</span>}
              {keadaan.jenis === 'ada' && (
                <img className="bo-gambar-pratinjau" src={keadaan.url} alt={`Foto ${namaItem}`} />
              )}
              {/* ⛔ Kalimat, bukan kotak abu-abu kosong. Di back-office kotak
                  kosong sah — merchant sedang MEMUTUSKAN apakah akan memfoto,
                  jadi ruang untuk foto adalah informasi. Yang tidak boleh
                  terjadi ada di layar KASIR, dan aturannya berbeda di sana. */}
              {keadaan.jenis === 'tanpa-gambar' && (
                <span className="t-caption">Belum ada gambar</span>
              )}
              {keadaan.jenis === 'gagal-memuat' && (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {keadaan.pesan}
                </span>
              )}
            </div>

            <div className="stack grow" style={{ gap: 'var(--space-2)' }}>
              <span className="t-caption">
                {SISI_PIKSEL}×{SISI_PIKSEL} piksel, maksimum {BATAS_BYTE / 1024} KB setelah
                dikompresi. Foto dipotong persegi dari bagian tengahnya.
              </span>
              {/* ⛔ Ongkos ARMADA dinyatakan, dan angkanya datang dari fungsi
                  yang testnya kunci — bukan dari kalimat yang diketik. Merchant
                  yang tidak tahu bahwa setiap foto menambah unduhan SETIAP
                  tabletnya tidak dapat memutuskan berapa banyak yang ia foto. */}
              <span className="t-caption">
                Setiap gambar diunduh oleh semua perangkat kasir. Katalog 500 produk yang
                seluruhnya bergambar menambah sekitar {anggaranTampil(500)} per perangkat.
              </span>

              <input
                ref={berkasRef}
                id={`gambar-${itemId}`}
                type="file"
                accept={TERIMA}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pilihBerkas(f);
                }}
              />

              <div className="row" style={{ gap: 'var(--space-2)' }}>
                <Tombol
                  disabled={sibuk !== null}
                  onClick={() => berkasRef.current?.click()}
                >
                  {sibuk ?? (keadaan.jenis === 'ada' ? 'Ganti gambar' : 'Pilih gambar…')}
                </Tombol>
                {/* Hapus hanya muncul saat ada yang dapat dihapus. Tombol yang
                    selalu ada membuat "belum punya gambar" terlihat seperti
                    keadaan yang perlu dibereskan. */}
                {keadaan.jenis === 'ada' && (
                  <Tombol disabled={sibuk !== null} onClick={() => void hapus()}>
                    Hapus gambar
                  </Tombol>
                )}
              </div>

              {keadaan.jenis === 'ada' && (
                <span className="t-caption num">
                  Tersimpan {Math.ceil(keadaan.byte / 1024)} KB
                </span>
              )}

              {pesan !== null && (
                <span className="t-caption" role="status">
                  {pesan}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
