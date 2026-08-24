import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Card, EmptyState, Icon, Table, Tabs } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import { RentangTanggal, hariIni, type Outlet } from '../laporan/RentangTanggal.tsx';
import { rentangSiap, type Rentang } from '../laporan/b16.ts';
import {
  JUDUL_LAYAR,
  bandingRata,
  labelAlasan,
  rasioTampil,
  ringkasAlasan,
  waktuTampil,
  zonaPerangkat,
} from './b21.ts';
import {
  LAPORAN,
  arahSelisih,
  definisi,
  jarakTutupTampil,
  pesanLaporan,
  posisiTampil,
  ringkasSebaran,
  skewTampil,
  trenTampil,
  type IdLaporan,
  type KeadaanLaporan,
} from './b21-daftar.ts';

/**
 * B-21 — Laporan Exception (`IA:§3.3`, grup PENGAWASAN). FR-G5.
 *
 * ## ⛔ Satu layar, delapan laporan
 *
 * `IA:200` menamainya **"Laporan Exception (8 laporan)"**. Memecahnya menjadi
 * delapan entri menu mengembalikan masalah yang pemisahan PENGAWASAN dari
 * LAPORAN selesaikan (`IA:171`): masing-masing tenggelam sendiri-sendiri.
 *
 * ## ⛔ Pengawasan, bukan Laporan — dan itu bukan selera
 *
 * `IA:171`: laporan menjawab "apa yang terjadi", pengawasan menjawab "apa yang
 * tidak wajar". Digabung, layar ini tenggelam di antara laporan rutin — dan
 * sejak keputusan 1 Agustus 2026 menghapus PIN manajer dari void, ia satu-
 * satunya kontrol yang tersisa terhadap penyalahgunaannya.
 *
 * ## ⛔ Layar ini menjawab pertanyaan yang B-18 sengaja TIDAK jawab
 *
 * Laporan Kasir melekatkan nilai pembatalan pada kasir yang **penjualannya**
 * dibatalkan — itu yang membuat jumlah seluruh kasir sama dengan Laporan
 * Penjualan. Di sini yang dilacak **siapa yang menekan tombolnya**.
 *
 * Keduanya benar untuk pertanyaan berbeda, dan keduanya dinyatakan di layar
 * masing-masing. Manajer yang membandingkan dua angka yang memang berbeda
 * tanpa penjelasan akan menyimpulkan salah satunya rusak.
 *
 * ## ⛔ Tanpa bahasa menuduh, dan ada test yang memindainya
 *
 * Tidak ada skor, tidak ada label, tidak ada baris merah. Yang ditampilkan
 * angka dan perbandingannya terhadap rata-rata periode. Kesimpulannya milik
 * manusia yang membacanya — layar ini menyediakan bahan, bukan vonis.
 *
 * ## ⛔ X6 ADA di daftar, dengan alasannya
 *
 * Laporan keenam tidak dapat dibangun: keranjang kasir hanya hidup di memori
 * perangkat. Menghilangkan tabnya membuat merchant yang membaca `spec-g`
 * menyimpulkan laporannya rusak atau ia salah mencari; menampilkannya dengan
 * alasan yang dinyatakan adalah batas yang jujur.
 *
 * ## Akses
 *
 * Kedelapan endpointnya menuntut operasi `report_exception`; kasir mendarat di
 * 403. Menyembunyikan menu adalah penjaga UX, batas sebenarnya ada di server.
 */

type Baris = Record<string, unknown>;

/**
 * ⛔ Angka tidak pernah dipatahkan ke baris berikutnya.
 *
 * `.table th` di design system sudah `nowrap`, `td` tidak — dan pada lebar
 * sempit `Rp 50.000` terbelah menjadi "Rp" di satu baris dan "50.000" di baris
 * berikutnya. Ditemukan di browser, bukan di test.
 *
 * Memotongnya (`.truncate`) bukan jalan keluar: itu justru cacat yang F4
 * catat — "Rp 25.0" adalah struk yang menyebut harga salah, dan laporan yang
 * menyebut nilai salah lebih buruk lagi karena ia dipakai menilai orang.
 */
const ANGKA = { whiteSpace: 'nowrap' } as const;

const num = (isi: ReactNode) => (
  <span className="num" style={ANGKA}>
    {isi}
  </span>
);

/** Rasio + kalimatnya. Aturan design system #5: angka telanjang bukan status. */
function Rasio({ rasio }: { rasio: string }) {
  return (
    <span className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
      <span className="num" style={ANGKA}>
        {rasioTampil(rasio)}
      </span>
      <span className="t-caption">{bandingRata(rasio)}</span>
    </span>
  );
}

export function ExceptionLayar() {
  const { api } = useSesi();
  const [id, setId] = useState<IdLaporan>('x1');
  const [rentang, setRentang] = useState<Rentang>(() => ({ dari: hariIni(), sampai: hariIni() }));
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [keadaan, setKeadaan] = useState<KeadaanLaporan>({ jenis: 'awal' });
  const [zona] = useState(() => zonaPerangkat());

  const def = definisi(id);

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await api.minta<Outlet[]>('/outlets');
        if (!batal) setOutlet(o);
      } catch {
        // Penyaring outlet hilang; laporan seluruh tenant tetap terbuka.
      }
    })();
    return () => {
      batal = true;
    };
  }, [api]);

  const muat = useCallback(async () => {
    if (def.endpoint === null) return;
    if (!rentangSiap(rentang)) return;
    setKeadaan({ jenis: 'memuat' });
    try {
      const kueri = new URLSearchParams({ from: rentang.dari, to: rentang.sampai });
      if (outletId.length > 0) kueri.set('outlet_id', outletId);
      const hasil = await api.minta<Record<string, unknown>>(
        `${def.endpoint}?${kueri.toString()}`
      );
      setKeadaan({ jenis: 'siap', hasil });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Layar ini butuh koneksi — datanya dihitung server.',
      });
    }
  }, [api, def, rentang, outletId]);

  // ⛔ Pindah tab MEMUAT ULANG, dan keadaannya tidak dibawa serta.
  //
  // Menyimpan hasil per tab akan menampilkan angka rentang LAMA di bawah
  // penyaring rentang yang sudah diubah — laporan yang tidak menjawab
  // pertanyaan yang terlihat sedang diajukan.
  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const namaOutlet = (idOutlet: string | null) =>
    idOutlet === null || idOutlet === ''
      ? 'Semua outlet'
      : (outlet.find((o) => o.id === idOutlet)?.name ?? idOutlet);

  const pesan = pesanLaporan(def, keadaan, namaOutlet);
  const hasil = keadaan.jenis === 'siap' ? keadaan.hasil : null;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '110ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">{JUDUL_LAYAR}</span>
        <span className="t-caption">
          Delapan laporan yang menjawab &quot;apa yang tidak wajar&quot;, pada rentang tanggal
          bisnis. Angkanya bahan pertimbangan, bukan kesimpulan.
        </span>
      </div>

      <Tabs
        variant="underline"
        ariaLabel="Pilih laporan exception"
        value={id}
        onChange={(v: string) => setId(v as IdLaporan)}
        tabs={LAPORAN.map((l) => ({ value: l.id, label: l.tab }))}
      />

      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-body-md">{def.judul}</span>
        <span className="t-caption">{def.deskripsi}</span>
      </div>

      {def.endpoint !== null ? (
        <Card>
          <div className="card-pad">
            <RentangTanggal
              rentang={rentang}
              onRentang={setRentang}
              outlet={outlet}
              outletId={outletId}
              onOutlet={setOutletId}
              sedangMuat={keadaan.jenis === 'memuat'}
              onTampilkan={() => void muat()}
              catatan="Peristiwa dihitung pada tanggal bisnis pesanan atau shift yang bersangkutan."
            />
          </div>
        </Card>
      ) : null}

      {pesan !== null ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'shield'} size={32} />}
              title={pesan.judul}
              body={pesan.badan}
              action={
                keadaan.jenis === 'galat' && def.endpoint !== null ? (
                  <Tombol onClick={() => void muat()}>Coba lagi</Tombol>
                ) : undefined
              }
            />
          </div>
        </Card>
      ) : null}

      {hasil !== null && pesan === null ? (
        <>
          <div className="row between">
            <span className="t-caption">Lingkup</span>
            <Badge tone="neutral">{namaOutlet((hasil.outletId as string | null) ?? null)}</Badge>
          </div>
          <IsiLaporan id={id} hasil={hasil} zona={zona} namaOutlet={namaOutlet} />
        </>
      ) : null}

      {def.catatan !== '' ? <span className="t-caption">{def.catatan}</span> : null}

      <span className="t-caption">
        Jam ditampilkan menurut zona waktu perangkat Anda (<span className="num">{zona}</span>),
        bukan zona outlet — outlet di zona berbeda akan tampil bergeser. Penyaring tanggal tidak
        terpengaruh: ia memakai tanggal bisnis yang dihitung server dari zona outlet
        masing-masing.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Isi per laporan
// ---------------------------------------------------------------------------

interface PropsIsi {
  id: IdLaporan;
  hasil: Record<string, unknown>;
  zona: string;
  namaOutlet: (id: string | null) => string;
}

function IsiLaporan({ id, hasil, zona, namaOutlet }: PropsIsi) {
  if (id === 'x1') return <X1 hasil={hasil} zona={zona} />;
  if (id === 'x2') return <X2 hasil={hasil} zona={zona} />;
  if (id === 'x3') return <X3 hasil={hasil} zona={zona} />;
  if (id === 'x4') return <X4 hasil={hasil} />;
  if (id === 'x5') return <X5 hasil={hasil} />;
  if (id === 'x7') return <X7 hasil={hasil} />;
  if (id === 'x8') return <X8 hasil={hasil} zona={zona} namaOutlet={namaOutlet} />;
  return null;
}

function Panel({ judul, children }: { judul: string; children: ReactNode }) {
  return (
    <Card>
      <div className="card-pad">
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          <span className="t-body-md">{judul}</span>
          {children}
        </div>
      </div>
    </Card>
  );
}

interface AktorX1 {
  name: string;
  jumlahVoid: number;
  nilaiVoid: string;
  jumlahRefund: number;
  nilaiRefund: string;
  rasio: string;
  alasan: { reasonCode: string; jumlah: number }[];
}

interface PeristiwaX1 {
  auditId: string;
  occurredAt: string;
  jenis: 'void' | 'refund';
  aktorNama: string;
  receiptNumber: string;
  nilai: string;
  reasonCode: string | null;
  reasonNote: string | null;
  penyetujuNama: string | null;
}

function X1({ hasil, zona }: { hasil: Record<string, unknown>; zona: string }) {
  const perAktor = (hasil.perAktor ?? []) as AktorX1[];
  const peristiwa = (hasil.peristiwa ?? []) as PeristiwaX1[];
  return (
    <>
      <Panel judul="Ringkasan per pelaku">
        <Table
          columns={[
            { key: 'nama', header: 'Pelaku' },
            { key: 'void', header: 'Void', align: 'right' },
            { key: 'nilaiVoid', header: 'Nilai void', align: 'right' },
            { key: 'refund', header: 'Refund', align: 'right' },
            { key: 'nilaiRefund', header: 'Nilai refund', align: 'right' },
            { key: 'rasio', header: 'Terhadap rata-rata', align: 'right' },
            { key: 'alasan', header: 'Alasan' },
          ]}
          rows={perAktor.map<Baris>((a) => ({
            nama: a.name,
            void: num(a.jumlahVoid),
            nilaiVoid: num(rupiah(a.nilaiVoid)),
            refund: num(a.jumlahRefund),
            nilaiRefund: num(rupiah(a.nilaiRefund)),
            rasio: <Rasio rasio={a.rasio} />,
            alasan: <span className="t-caption">{ringkasAlasan(a.alasan)}</span>,
          }))}
        />
      </Panel>

      <Panel judul="Daftar peristiwa">
        <Table
          columns={[
            { key: 'waktu', header: 'Waktu' },
            { key: 'pelaku', header: 'Pelaku' },
            { key: 'jenis', header: 'Jenis' },
            { key: 'struk', header: 'Struk' },
            { key: 'nilai', header: 'Nilai', align: 'right' },
            { key: 'alasan', header: 'Alasan' },
            { key: 'penyetuju', header: 'Penyetuju' },
          ]}
          rows={peristiwa.map<Baris>((p) => ({
            waktu: num(waktuTampil(p.occurredAt, zona)),
            pelaku: p.aktorNama,
            // ⛔ Jenis dibedakan lewat TEKS, bukan warna baris.
            jenis: <Badge tone="neutral">{p.jenis === 'void' ? 'Void' : 'Refund'}</Badge>,
            struk: num(p.receiptNumber),
            nilai: num(rupiah(p.nilai)),
            alasan: (
              <span className="stack" style={{ gap: 0 }}>
                <span>{labelAlasan(p.reasonCode)}</span>
                {p.reasonNote !== null && p.reasonNote !== '' ? (
                  <span className="t-caption">{p.reasonNote}</span>
                ) : null}
              </span>
            ),
            // Void berjalan tanpa penyetuju sejak keputusan 1 Agustus 2026;
            // refund selalu menuntutnya. Sel kosong di sini bermakna, jadi ia
            // diberi tanda alih-alih dibiarkan hampa.
            penyetuju: p.penyetujuNama ?? <span className="t-caption">—</span>,
          }))}
        />
      </Panel>
    </>
  );
}

interface VoidX2 {
  auditId: string;
  occurredAt: string;
  posisi: string;
  menitKeTutup: number | null;
  aktorNama: string;
  receiptNumber: string;
  nilai: string;
}

function X2({ hasil, zona }: { hasil: Record<string, unknown>; zona: string }) {
  const baris = (hasil.void ?? []) as VoidX2[];
  return (
    <Panel judul="Void di ujung shift">
      <Table
        columns={[
          { key: 'waktu', header: 'Waktu' },
          { key: 'posisi', header: 'Posisi' },
          { key: 'jarak', header: 'Jarak ke penutupan' },
          { key: 'pelaku', header: 'Pelaku' },
          { key: 'struk', header: 'Struk' },
          { key: 'nilai', header: 'Nilai', align: 'right' },
        ]}
        rows={baris.map<Baris>((v) => ({
          waktu: num(waktuTampil(v.occurredAt, zona)),
          // ⛔ Teks, bukan warna baris — aturan design system #5.
          posisi: <Badge tone="neutral">{posisiTampil(v.posisi)}</Badge>,
          jarak: <span className="t-caption">{jarakTutupTampil(v.menitKeTutup)}</span>,
          pelaku: v.aktorNama,
          struk: num(v.receiptNumber),
          nilai: num(rupiah(v.nilai)),
        }))}
      />
    </Panel>
  );
}

interface RefundX3 {
  refundId: string;
  occurredAt: string;
  nilai: string;
  reasonCode: string;
  reasonNote: string | null;
  aktorNama: string;
  penyetujuNama: string;
  receiptNumber: string;
}

function X3({ hasil, zona }: { hasil: Record<string, unknown>; zona: string }) {
  const laporan = (hasil.laporan ?? {}) as {
    ambang?: string;
    jumlahSeluruhRefund?: number;
    refund?: RefundX3[];
  };
  const baris = laporan.refund ?? [];
  return (
    <Panel judul="Refund bernilai tinggi">
      {/* ⛔ Ambangnya ikut ditampilkan. Daftar nama tanpa ambang yang
          menghasilkannya tidak dapat dijelaskan kepada orang yang namanya ada
          di sana — dan ambang ini bergerak mengikuti periode. */}
      <span className="t-caption">
        Ambang periode ini <span className="num">{rupiah(laporan.ambang ?? '')}</span> — persentil 90
        dari <span className="num">{laporan.jumlahSeluruhRefund ?? 0}</span> refund pada rentang yang
        dipilih.
      </span>

      <Table
        columns={[
          { key: 'waktu', header: 'Waktu' },
          { key: 'nilai', header: 'Nilai', align: 'right' },
          { key: 'alasan', header: 'Alasan' },
          { key: 'pelaku', header: 'Pelaku' },
          { key: 'penyetuju', header: 'Penyetuju' },
          { key: 'struk', header: 'Struk' },
        ]}
        rows={baris.map<Baris>((r) => ({
          waktu: num(waktuTampil(r.occurredAt, zona)),
          nilai: num(rupiah(r.nilai)),
          alasan: (
            <span className="stack" style={{ gap: 0 }}>
              <span>{labelAlasan(r.reasonCode)}</span>
              {r.reasonNote !== null && r.reasonNote !== '' ? (
                <span className="t-caption">{r.reasonNote}</span>
              ) : null}
            </span>
          ),
          pelaku: r.aktorNama,
          penyetuju: r.penyetujuNama,
          struk: num(r.receiptNumber),
        }))}
      />
    </Panel>
  );
}

interface NoSaleX4 {
  userId: string;
  name: string;
  jumlah: number;
  jumlahShift: number;
  perShift: string;
  rasio: string;
}

function X4({ hasil }: { hasil: Record<string, unknown> }) {
  const baris = (hasil.perKasir ?? []) as NoSaleX4[];
  return (
    <Panel judul="Buka laci tanpa transaksi, per kasir">
      <Table
        columns={[
          { key: 'nama', header: 'Kasir' },
          { key: 'jumlah', header: 'Jumlah', align: 'right' },
          { key: 'shift', header: 'Shift', align: 'right' },
          { key: 'perShift', header: 'Per shift', align: 'right' },
          { key: 'rasio', header: 'Terhadap rata-rata', align: 'right' },
        ]}
        rows={baris.map<Baris>((k) => ({
          nama: k.name,
          jumlah: num(k.jumlah),
          shift: num(k.jumlahShift),
          perShift: num(k.perShift.replace('.', ',')),
          rasio: <Rasio rasio={k.rasio} />,
        }))}
      />
    </Panel>
  );
}

interface DiskonX5 {
  userId: string;
  name: string;
  jumlah: number;
  nilai: string;
  jumlahBerpenyetuju: number;
  rasio: string;
  alasan: { reasonCode: string; jumlah: number }[];
}

function X5({ hasil }: { hasil: Record<string, unknown> }) {
  const baris = (hasil.perKasir ?? []) as DiskonX5[];
  return (
    <Panel judul="Diskon manual per kasir">
      <Table
        columns={[
          { key: 'nama', header: 'Kasir' },
          { key: 'jumlah', header: 'Jumlah', align: 'right' },
          { key: 'nilai', header: 'Nilai potongan', align: 'right' },
          { key: 'disetujui', header: 'Dengan persetujuan', align: 'right' },
          { key: 'rasio', header: 'Terhadap rata-rata', align: 'right' },
          { key: 'alasan', header: 'Alasan' },
        ]}
        rows={baris.map<Baris>((k) => ({
          nama: k.name,
          jumlah: num(k.jumlah),
          nilai: num(rupiah(k.nilai)),
          disetujui: num(k.jumlahBerpenyetuju),
          rasio: <Rasio rasio={k.rasio} />,
          alasan: <span className="t-caption">{ringkasSebaran(k.alasan)}</span>,
        }))}
      />
    </Panel>
  );
}

interface SelisihX7 {
  userId: string;
  name: string;
  jumlahShift: number;
  totalSelisih: string;
  totalMutlak: string;
  jumlahKurang: number;
  jumlahLebih: number;
  tren: string;
}

function X7({ hasil }: { hasil: Record<string, unknown> }) {
  const baris = (hasil.perKasir ?? []) as SelisihX7[];
  return (
    <Panel judul="Selisih kas per kasir">
      <Table
        columns={[
          { key: 'nama', header: 'Kasir' },
          { key: 'shift', header: 'Shift', align: 'right' },
          { key: 'total', header: 'Total selisih', align: 'right' },
          { key: 'mutlak', header: 'Total mutlak', align: 'right' },
          { key: 'arah', header: 'Kurang / lebih' },
          { key: 'tren', header: 'Kecenderungan' },
        ]}
        rows={baris.map<Baris>((k) => ({
          nama: k.name,
          shift: num(k.jumlahShift),
          // ⛔ Angka DAN katanya. Tanda minus sendirian tidak cukup untuk
          // membedakan kas yang kurang dari kas yang lebih — dua keadaan yang
          // `spec-d` perlakukan berbeda.
          total: (
            <span className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
              <span className="num" style={ANGKA}>
                {rupiah(k.totalSelisih)}
              </span>
              <span className="t-caption">{arahSelisih(k.totalSelisih)}</span>
            </span>
          ),
          mutlak: num(rupiah(k.totalMutlak)),
          arah: (
            <span className="t-caption">
              {k.jumlahKurang}× kurang · {k.jumlahLebih}× lebih
            </span>
          ),
          tren: <span className="t-caption">{trenTampil(k.tren)}</span>,
        }))}
      />
    </Panel>
  );
}

interface AnomaliX8 {
  auditId: string;
  occurredAt: string;
  deviceId: string;
  deviceCode: string | null;
  outletId: string | null;
  aktorNama: string;
  skewDetik: number;
}

function X8({
  hasil,
  zona,
  namaOutlet,
}: {
  hasil: Record<string, unknown>;
  zona: string;
  namaOutlet: (id: string | null) => string;
}) {
  const baris = (hasil.anomali ?? []) as AnomaliX8[];
  const ambang = typeof hasil.ambangDetik === 'number' ? hasil.ambangDetik : 0;
  return (
    <Panel judul="Selisih jam perangkat">
      <span className="t-caption">
        Tercatat bila selisihnya melebihi <span className="num">{Math.round(ambang / 60)}</span>{' '}
        menit. Satu perangkat dicatat paling banyak sekali per jam, jadi jumlah baris bukan jumlah
        transaksi yang terpengaruh.
      </span>

      <Table
        columns={[
          { key: 'waktu', header: 'Waktu' },
          { key: 'perangkat', header: 'Perangkat' },
          { key: 'selisih', header: 'Selisih jam' },
          { key: 'kasir', header: 'Kasir' },
          { key: 'outlet', header: 'Outlet' },
        ]}
        rows={baris.map<Baris>((a) => ({
          waktu: num(waktuTampil(a.occurredAt, zona)),
          perangkat: num(a.deviceCode ?? a.deviceId),
          selisih: <span className="t-caption">{skewTampil(a.skewDetik)}</span>,
          kasir: a.aktorNama,
          outlet: namaOutlet(a.outletId),
        }))}
      />
    </Panel>
  );
}
