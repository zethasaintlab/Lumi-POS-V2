import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { RentangTanggal, hariIni, type Outlet } from '../laporan/RentangTanggal.tsx';
import { rentangSiap, type Rentang } from '../laporan/b16.ts';
import { waktuTampil, zonaPerangkat } from './b21.ts';
import {
  JUDUL_LAYAR,
  labelKelompok,
  labelPeristiwa,
  objekTampil,
  pelakuTampil,
  penyetujuTampil,
  pesanBelumDipancarkan,
  pesanKeadaanAudit,
  pilihanPeristiwa,
  ringkasSaringan,
  type HasilAudit,
  type KeadaanAudit,
} from './b22.ts';

/**
 * B-22 — Audit & Aktivitas (`IA:201`, grup PENGAWASAN). FR-F6, FR-F7.
 *
 * ## ⛔ Layar ini dibaca saat ada sengketa
 *
 * `spec-f:372` memberi audit trail retensi **lima tahun**, lebih panjang
 * daripada retensi transaksi, dengan alasan yang dinyatakan: sengketa muncul
 * berbulan-bulan kemudian. Yang membacanya biasanya sedang mencari jawaban
 * atas tuduhan. Layar yang menambahkan penilaiannya sendiri di atas jejak
 * menjadi bagian dari sengketa alih-alih menyelesaikannya.
 *
 * ## ⛔ Dua hal yang harus disebutkan karena keduanya diam
 *
 * 1. **Saringan yang aktif** — daftar yang tidak menyebut apa yang disaring
 *    terbaca seperti daftar lengkap.
 * 2. **Peristiwa yang belum dipancarkan** — FR-F6 AC pertama menuntut setiap
 *    event pada `spec-f:288` menghasilkan record; sebagian belum. Manajer yang
 *    tidak menemukan perubahan harga di sini akan menyimpulkan tidak ada yang
 *    mengubah harga. Daftarnya datang dari server, diturunkan di domain.
 *
 * ## ⛔ Paginasi kursor, bukan halaman bernomor
 *
 * Kursornya nilai buram yang server berikan. Menyusunnya sendiri di klien
 * membuat dua tempat memutuskan urutan, dan yang menyimpang melewatkan baris
 * audit tanpa meninggalkan lubang yang terlihat.
 *
 * Halaman berikutnya DITAMBAHKAN ke daftar, bukan menggantinya: pembaca yang
 * sedang menyusun kronologi tidak boleh kehilangan baris yang baru saja ia
 * baca hanya karena ia menekan "Muat lebih banyak".
 *
 * ## Akses
 *
 * Endpointnya menuntut `report_exception` — himpunan peran yang sama dengan
 * B-21, dan `[ASUMSI]` yang dinyatakan di `reporting/index.ts`: matriks
 * `spec-f` tidak punya baris untuk audit trail.
 */

type Baris = Record<string, unknown>;

const ANGKA = { whiteSpace: 'nowrap' } as const;

export function AuditLayar() {
  const { api } = useSesi();
  const [rentang, setRentang] = useState<Rentang>(() => ({ dari: hariIni(), sampai: hariIni() }));
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [jenis, setJenis] = useState('');
  const [objek, setObjek] = useState('');
  /* F.5 — menyaring ke tindakan yang dilakukan selama sesi akses support.
     ⛔ Hanya satu arah; lihat catatan di `kueri`. */
  const [hanyaSupport, setHanyaSupport] = useState(false);
  const [keadaan, setKeadaan] = useState<KeadaanAudit>({ jenis: 'awal' });
  const [lanjutan, setLanjutan] = useState<HasilAudit['peristiwa']>([]);
  /**
   * ⛔ Kursor adalah state TERSENDIRI, bukan dibaca ulang dari `hasil`.
   *
   * `hasil` memegang halaman PERTAMA dan tidak berubah saat halaman lanjutan
   * datang — menurunkan kursor darinya berarti tombol "Muat lebih banyak"
   * selalu meminta halaman kedua, selamanya. Kegagalannya tidak terlihat
   * sebagai error: ia hanya menggandakan baris yang sama di layar yang dibaca
   * untuk menyusun kronologi.
   */
  const [kursor, setKursor] = useState<string | null>(null);
  const [memuatLagi, setMemuatLagi] = useState(false);
  const [zona] = useState(() => zonaPerangkat());

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await api.minta<Outlet[]>('/outlets');
        if (!batal) setOutlet(o);
      } catch {
        // Penyaring outlet hilang; audit seluruh tenant tetap terbuka.
      }
    })();
    return () => {
      batal = true;
    };
  }, [api]);

  const kueri = useCallback(
    (kursor: string | null) => {
      const q = new URLSearchParams({ from: rentang.dari, to: rentang.sampai });
      if (outletId.length > 0) q.set('outlet_id', outletId);
      if (jenis.length > 0) q.set('event_type', jenis);
      if (objek.trim().length > 0) q.set('entity_id', objek.trim());
      // ⛔ Hanya menyala; tidak ada nilai yang MENYEMBUNYIKAN tindakan support.
      // Saringan yang membuat audit dapat menyembunyikan sebagian dirinya akan
      // dipakai oleh pihak yang tindakannya sedang diperiksa.
      if (hanyaSupport) q.set('support_only', 'true');
      if (kursor !== null) q.set('cursor', kursor);
      return q.toString();
    },
    [rentang, outletId, jenis, objek, hanyaSupport]
  );

  const pesanGalat = (err: unknown) =>
    err instanceof GalatHttp
      ? err.message
      : 'Tidak dapat menghubungi server. Layar ini butuh koneksi — datanya dihitung server.';

  const muat = useCallback(async () => {
    if (!rentangSiap(rentang)) return;
    setKeadaan({ jenis: 'memuat' });
    // ⛔ Halaman lanjutan DIBUANG saat saringan berubah. Menyimpannya membuat
    // daftar memuat baris dari dua saringan berbeda sekaligus, dan tidak ada
    // apa pun di layar yang menyatakan mana yang mana.
    setLanjutan([]);
    setKursor(null);
    try {
      const hasil = await api.minta<HasilAudit>(`/audit-events?${kueri(null)}`);
      setKeadaan({ jenis: 'siap', hasil });
      setKursor(hasil.kursorBerikut);
    } catch (err) {
      setKeadaan({ jenis: 'galat', pesan: pesanGalat(err) });
    }
  }, [api, rentang, kueri]);

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasil = keadaan.jenis === 'siap' ? keadaan.hasil : null;

  const muatLagi = useCallback(async () => {
    if (hasil === null || kursor === null || memuatLagi) return;
    setMemuatLagi(true);
    try {
      const berikut = await api.minta<HasilAudit>(`/audit-events?${kueri(kursor)}`);
      setLanjutan((sebelum) => [...sebelum, ...berikut.peristiwa]);
      setKursor(berikut.kursorBerikut);
    } catch (err) {
      setKeadaan({ jenis: 'galat', pesan: pesanGalat(err) });
    } finally {
      setMemuatLagi(false);
    }
  }, [api, hasil, kursor, kueri, memuatLagi]);

  const namaOutlet = (id: string | null) =>
    id === null || id === ''
      ? 'Semua outlet'
      : (outlet.find((o) => o.id === id)?.name ?? id);

  const pesan = pesanKeadaanAudit(keadaan, namaOutlet);
  const baris = hasil === null ? [] : [...hasil.peristiwa, ...lanjutan];
  const saringan =
    hasil === null
      ? null
      : ringkasSaringan({
          outlet: hasil.outletId === null ? null : namaOutlet(hasil.outletId),
          jenis: hasil.eventType,
          aktor: hasil.actorUserId,
          objek: hasil.entityId,
          support: hasil.hanyaSupport,
        });
  const lubang = hasil === null ? null : pesanBelumDipancarkan(hasil.belumDipancarkan);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '120ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">{JUDUL_LAYAR}</span>
        <span className="t-caption">
          Jejak siapa melakukan apa, kapan, dan siapa yang menyetujuinya. Jejak ini tidak dapat
          diubah maupun dihapus, dan disimpan minimal lima tahun.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <RentangTanggal
              rentang={rentang}
              onRentang={setRentang}
              outlet={outlet}
              outletId={outletId}
              onOutlet={setOutletId}
              sedangMuat={keadaan.jenis === 'memuat'}
              onTampilkan={() => void muat()}
              sumbu="kejadian"
              catatan="Tekan Tampilkan setelah mengubah saringan di bawah."
            />

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
              <div className="stack" style={{ width: '32ch' }}>
                <label className="label" htmlFor="jenis">
                  Jenis peristiwa
                </label>
                <select
                  id="jenis"
                  className="field"
                  value={jenis}
                  onChange={(e) => setJenis(e.target.value)}
                >
                  <option value="">Semua jenis</option>
                  {pilihanPeristiwa().map((p) => (
                    <option key={p.nilai} value={p.nilai}>
                      {p.kelompok} — {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: '32ch' }}>
                <Bidang
                  id="objek"
                  label="Id objek (opsional)"
                  value={objek}
                  onChange={setObjek}
                />
              </div>
            </div>
            <span className="t-caption">
              Id objek menelusuri satu benda dari ujung ke ujung — seluruh peristiwa satu
              transaksi, satu shift, atau satu pengguna. Salin id-nya dari layar detail.
            </span>
            {/* ⛔ F.5 — SATU ARAH. Tidak ada pilihan yang menyembunyikan
                tindakan support: saringan yang membuat audit dapat
                menyembunyikan sebagian dirinya akan dipakai oleh pihak yang
                tindakannya sedang diperiksa. */}
            <label className="t-caption">
              <input
                type="checkbox"
                checked={hanyaSupport}
                onChange={(e) => setHanyaSupport(e.target.checked)}
              />{' '}
              Hanya tindakan yang dilakukan lewat akses support
            </label>
          </div>
        </div>
      </Card>

      {pesan !== null ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'book'} size={32} />}
              title={pesan.judul}
              body={pesan.badan}
              action={
                keadaan.jenis === 'galat' ? (
                  <Tombol onClick={() => void muat()}>Coba lagi</Tombol>
                ) : undefined
              }
            />
          </div>
        </Card>
      ) : null}

      {hasil !== null && pesan === null ? (
        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <div className="row between">
                <span className="t-body-md">Aktivitas</span>
                <Badge tone="neutral">{namaOutlet(hasil.outletId)}</Badge>
              </div>

              {/* ⛔ Saringan aktif dinyatakan DI ATAS tabel, bukan di catatan
                  kaki. Yang membacanya sedang menyusun kesimpulan tentang
                  orang, dan ia menyusunnya dari baris yang terlihat. */}
              {saringan !== null ? <span className="t-caption">{saringan}</span> : null}

              <Table
                columns={[
                  { key: 'waktu', header: 'Waktu' },
                  { key: 'peristiwa', header: 'Peristiwa' },
                  { key: 'pelaku', header: 'Pelaku' },
                  { key: 'penyetuju', header: 'Penyetuju' },
                  { key: 'objek', header: 'Objek' },
                  { key: 'alasan', header: 'Alasan' },
                  { key: 'perangkat', header: 'Perangkat' },
                ]}
                rows={baris.map<Baris>((p) => ({
                  waktu: (
                    <span className="stack" style={{ gap: 0 }}>
                      <span className="num" style={ANGKA}>
                        {waktuTampil(p.occurredAt, zona)}
                      </span>
                      {/* ⛔ Dua jam, dan keduanya ditampilkan bila berbeda
                          harinya. `occurred_at` jam perangkat, `recorded_at`
                          jam server; penjualan yang antre offline berjam-jam
                          adalah keadaan normal produk ini, dan pembaca yang
                          hanya melihat satu di antaranya akan menyimpulkan
                          jejaknya disisipkan belakangan. */}
                      {p.recordedAt.slice(0, 10) !== p.occurredAt.slice(0, 10) ? (
                        <span className="t-caption">
                          tersimpan {waktuTampil(p.recordedAt, zona)}
                        </span>
                      ) : null}
                    </span>
                  ),
                  peristiwa: (
                    <span className="stack" style={{ gap: 0 }}>
                      <span>{labelPeristiwa(p.eventType)}</span>
                      <span className="t-caption">{labelKelompok(p.kelompok)}</span>
                    </span>
                  ),
                  // ⛔ F.5 — atas nama siapa baris ini terjadi. `aktorNama`
                  // pada baris support adalah OWNER YANG MENYETUJUI akses itu;
                  // menampilkannya sendirian terbaca sebagai "owner
                  // melakukannya", dan layar ini dibaca saat sengketa.
                  pelaku: pelakuTampil(p.aktorNama, p.supportAdmin),
                  // ⛔ Teks, bukan sel kosong. Lihat `penyetujuTampil`.
                  penyetuju:
                    p.penyetujuNama === null ? (
                      <span className="t-caption">{penyetujuTampil(null)}</span>
                    ) : (
                      p.penyetujuNama
                    ),
                  objek: (
                    <span className="num" style={ANGKA} title={p.entityId ?? ''}>
                      {objekTampil(p.entityType, p.entityId)}
                    </span>
                  ),
                  alasan: (
                    <span className="stack" style={{ gap: 0 }}>
                      <span>{p.reasonCode ?? '—'}</span>
                      {p.reasonNote !== null && p.reasonNote !== '' ? (
                        <span className="t-caption">{p.reasonNote}</span>
                      ) : null}
                    </span>
                  ),
                  perangkat: (
                    <span className="num" style={ANGKA}>
                      {p.deviceKode ?? '—'}
                    </span>
                  ),
                }))}
              />

              <div className="row between">
                <span className="t-caption">
                  <span className="num">{baris.length}</span> peristiwa ditampilkan
                  {kursor !== null ? ', masih ada lagi' : ''}.
                </span>
                {kursor !== null ? (
                  <Tombol onClick={() => void muatLagi()} disabled={memuatLagi}>
                    {memuatLagi ? 'Memuat…' : 'Muat lebih banyak'}
                  </Tombol>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {lubang !== null ? <span className="t-caption">{lubang}</span> : null}

      <span className="t-caption">
        Kolom <strong>Penyetuju</strong> adalah identitas kedua: yang memasukkan PIN untuk
        mengizinkan tindakan orang lain. Ia tidak pernah sama dengan pelaku — database menolak
        baris yang membuatnya sama. Sebagian operasi memang tidak menuntut persetujuan, dan
        barisnya menyatakan itu alih-alih dibiarkan kosong.
      </span>

      <span className="t-caption">
        Jam ditampilkan menurut zona waktu perangkat Anda (<span className="num">{zona}</span>),
        bukan zona outlet. Waktu kejadian datang dari jam perangkat kasir; waktu tersimpan datang
        dari jam server, dan ditampilkan bila keduanya jatuh pada hari berbeda.
      </span>
    </div>
  );
}
