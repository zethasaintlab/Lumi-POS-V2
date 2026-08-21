import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { DIMENSI_KUOTA } from '../../../../packages/domain/src/kuota.ts';
import {
  susunBaris,
  labelPaket,
  labelStatusTenant,
  type BarisKuota,
  type Pemakaian,
} from './kuota-tampilan.ts';
import {
  labelStatusTagihan,
  rupiah,
  susunPilihan,
  tagihanTerbuka,
  toneStatusTagihan,
  type HasilTagihanBaru,
  type PilihanPaket,
  type RiwayatTagihan,
  type Tagihan,
} from './upgrade.ts';

/**
 * B-29 — Langganan & Batas (`IA:§3.3`, akses minimum Owner).
 *
 * `research/09` § "Implikasi untuk IA" menuntut dua hal, dan keduanya ada di
 * sini: *"pemakaian versus kuota"* dan *"peringatan kuota mendekati batas
 * harus muncul di dashboard owner, bukan hanya saat operasi ditolak."*
 *
 * ## ⛔ Layout shift dicegah dengan menyamakan TINGGI, bukan dengan spinner
 *
 * Jumlah baris sudah diketahui sebelum data tiba — ia `DIMENSI_KUOTA`, daftar
 * tertutup di `packages/domain`. Jadi keadaan memuat merender jumlah kerangka
 * yang SAMA dengan jumlah baris akhir, dengan struktur yang sama persis.
 *
 * Spinner yang lalu diganti empat baris akan menggeser seluruh isi
 * `.shell-body` dua kali: sekali saat data tiba, sekali lagi saat tingginya
 * berubah. Di layar yang merchant buka untuk memutuskan pembayaran, isi yang
 * melompat adalah isi yang salah dibaca.
 *
 * ⛔ Yang dijamin nol-geser adalah **memuat → siap**, dan hanya itu. Diukur di
 * browser: tinggi kartu 400px di kedua keadaan, nol pergeseran lewat tiga
 * sampel MutationObserver.
 *
 * Keadaan **error tetap berbeda tingginya**, dan itu disengaja. Versi pertama
 * berkas ini mencoba menyamakannya dengan menambahkan kerangka di bawah pesan
 * error; hasilnya terukur **614px versus 400px** — klaimnya salah, dan
 * memaksanya sama menuntut padding yang dikarang. Error adalah keadaan yang
 * jarang, sekali per kegagalan, dan ia memang membawa jumlah informasi yang
 * berbeda. Yang sering — setiap kali layar dibuka — adalah memuat → siap.
 *
 * ## Data
 *
 * `GET /tenants/usage` lewat `api` dari `useSesi()`. Pemanggil tidak pernah
 * menyusun header sendiri: Bearer, tenant, dan aktor disuntikkan satu pintu
 * (`http.ts`), dan header sesi tidak dapat ditimpa dari sini.
 */

const JUMLAH_BARIS = DIMENSI_KUOTA.length;

function BarisKerangka() {
  // Tinggi ditentukan isi yang sama bentuknya, bukan angka piksel: satu baris
  // judul (`t-body-md`), satu baris angka (`t-caption`), dan bar setinggi
  // `--space-2`. Aturan #6 — tidak ada ukuran yang dikarang.
  return (
    // ⛔ TANPA teks sama sekali. Versi pertama memakai kata "Memuat" yang
    // dibuat `color: transparent` — tak terlihat, tapi tetap muncul di
    // `innerText`, jadi test yang membaca isi layar melihat "Memuat" empat
    // kali di keadaan yang sudah selesai memuat.
    //
    // Tingginya sekarang datang dari `&nbsp;` di dalam kelas tipografi yang
    // SAMA dengan baris sungguhan — bukan dari angka piksel (aturan #6).
    <div className="stack" style={{ gap: 'var(--space-2)' }} aria-hidden="true">
      <div className="row between">
        <span className="t-body-md">&nbsp;</span>
        <span className="badge badge-neutral">&nbsp;</span>
      </div>
      <div
        style={{
          height: 'var(--space-2)',
          borderRadius: 'var(--radius-control)',
          background: 'var(--surface-alt)',
        }}
      />
      <span className="t-caption">&nbsp;</span>
    </div>
  );
}

function Bar({ persen, tone }: { persen: number | null; tone: BarisKuota['tone'] }) {
  // ⛔ Tanpa batas → TIDAK ada bar sama sekali.
  //
  // Bar kosong terbaca "0 dari sesuatu"; bar penuh terbaca "habis". Keduanya
  // salah untuk tier yang justru tidak punya batas. Wadahnya tetap dirender
  // supaya tingginya sama dengan baris lain — itu yang menahan layout shift
  // antar-baris, bukan hanya antar-keadaan.
  const warna: Record<BarisKuota['tone'], string> = {
    neutral: 'var(--border-strong)',
    accent: 'var(--accent)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
  };

  return (
    <div
      style={{
        height: 'var(--space-2)',
        borderRadius: 'var(--radius-control)',
        background: 'var(--surface-alt)',
        overflow: 'hidden',
      }}
    >
      {persen === null ? null : (
        <div
          style={{
            width: `${persen}%`,
            height: '100%',
            background: warna[tone],
          }}
        />
      )}
    </div>
  );
}

function Baris({ baris }: { baris: BarisKuota }) {
  const angka =
    baris.batas === null
      ? `${baris.terpakai.toLocaleString('id-ID')} terpakai`
      : `${baris.terpakai.toLocaleString('id-ID')} dari ${baris.batas.toLocaleString('id-ID')}`;

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <div className="row between">
        <span className="t-body-md">{baris.judul}</span>
        {/* ⛔ Status membawa TEKS, bukan hanya warna (aturan design system #5). */}
        <Badge tone={baris.tone}>{baris.label}</Badge>
      </div>
      <Bar persen={baris.persen} tone={baris.tone} />
      <span className="t-caption num">{angka}</span>
    </div>
  );
}

type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; data: Pemakaian }
  | { jenis: 'galat'; pesan: string };

/**
 * ⛔ Satu keadaan untuk SELURUH tindakan menulis di layar ini, bukan satu per
 * tombol. Dua tombol yang punya penanda sibuknya masing-masing dapat menyala
 * bersamaan, dan merchant yang menekan "Naikkan paket" lalu "Cek status"
 * sementara yang pertama masih berjalan akan melihat dua hasil saling
 * menimpa — pada layar yang memutuskan pembayaran.
 */
type Aksi =
  | { jenis: 'diam' }
  | { jenis: 'sibuk' }
  | { jenis: 'gagal'; pesan: string };

function pesanGalat(err: unknown): string {
  return err instanceof GalatHttp
    ? err.message
    : 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.';
}

function BarisPaket({
  pilihan,
  nonaktif,
  onBeli,
}: {
  pilihan: PilihanPaket;
  nonaktif: boolean;
  onBeli: (paket: string) => void;
}) {
  const harga =
    pilihan.hargaPerOutlet === null
      ? 'Harga dinegosiasikan'
      : pilihan.hargaPerOutlet === 0n
        ? 'Gratis'
        : `${rupiah(pilihan.hargaPerOutlet)} / outlet / bulan`;

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <div className="row between">
        <span className="t-body-md">{pilihan.judul}</span>
        {/* Status membawa teks, bukan hanya warna (aturan #5). */}
        {pilihan.sedangDipakai ? <Badge tone="accent">Paket sekarang</Badge> : null}
      </div>
      <span className="t-caption num">{harga}</span>

      {pilihan.dapatDibeli ? (
        <div className="row between">
          <span className="t-caption num">
            {pilihan.perkiraanBulanan === null
              ? 'Perkiraan tidak dapat dihitung'
              : `Perkiraan tagihan ${rupiah(pilihan.perkiraanBulanan)}`}
          </span>
          <Tombol varian="primary" disabled={nonaktif} onClick={() => onBeli(pilihan.paket)}>
            Naikkan ke {pilihan.judul}
          </Tombol>
        </div>
      ) : (
        // ⛔ Alasannya DITAMPILKAN, bukan tombolnya disembunyikan diam-diam.
        // Kalimatnya sama persis dengan yang server jawab.
        <span className="t-caption">{pilihan.sedangDipakai ? 'Sedang dipakai.' : pilihan.alasan}</span>
      )}
    </div>
  );
}

function KartuTagihanTerbuka({
  tagihan,
  sibuk,
  onCek,
}: {
  tagihan: Tagihan;
  sibuk: boolean;
  onCek: (id: string) => void;
}) {
  return (
    <Card>
      <div className="card-pad">
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          <div className="row between">
            <span className="t-body-md">Tagihan menunggu pembayaran</span>
            <Badge tone={toneStatusTagihan(tagihan.status)}>{labelStatusTagihan(tagihan.status)}</Badge>
          </div>

          <span className="t-caption num">
            {labelPaket(tagihan.plan)} · {tagihan.outletCount} outlet ·{' '}
            {rupiah(BigInt(tagihan.amount))}
          </span>

          {/* ⛔ QR ditampilkan sebagai TAUTAN, bukan gambar.
               Aturan design system #8 melarang gambar, dan tidak ada komponen
               QR di `/ds-bundle`. `qrString` Midtrans memang sebuah URL.
               Batasnya dinyatakan: merchant membuka tautan itu untuk
               memindai, dan alur idealnya menuntut renderer QR yang belum ada
               di repo ini. */}
          {tagihan.qrString ? (
            <a className="t-body-md" href={tagihan.qrString} target="_blank" rel="noreferrer">
              Buka QRIS untuk membayar
            </a>
          ) : (
            <span className="t-caption">
              QR belum tersedia — gateway tidak menjawab saat tagihan dibuat. Tagihan tetap
              tersimpan; tekan &quot;Cek status pembayaran&quot; setelah membayar.
            </span>
          )}

          <Tombol disabled={sibuk} onClick={() => onCek(tagihan.id)}>
            Cek status pembayaran
          </Tombol>
        </div>
      </div>
    </Card>
  );
}

function Riwayat({ invoices }: { invoices: Tagihan[] }) {
  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="receipt" size={32} />}
        title="Belum ada tagihan"
        body="Tagihan langganan muncul di sini setelah kamu menaikkan paket."
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      {invoices.map((t) => (
        <div key={t.id} className="stack" style={{ gap: 'var(--space-1)' }}>
          <div className="row between">
            <span className="t-body-md">{labelPaket(t.plan)}</span>
            <Badge tone={toneStatusTagihan(t.status)}>{labelStatusTagihan(t.status)}</Badge>
          </div>
          <span className="t-caption num">
            {new Date(t.createdAt).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}{' '}
            · {t.outletCount} outlet · {rupiah(BigInt(t.amount))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Langganan() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [riwayat, setRiwayat] = useState<RiwayatTagihan | null>(null);
  const [aksi, setAksi] = useState<Aksi>({ jenis: 'diam' });
  const [putaran, setPutaran] = useState(0);

  const muatUlang = useCallback(() => setPutaran((n) => n + 1), []);

  useEffect(() => {
    let batal = false;
    setKeadaan({ jenis: 'memuat' });

    // ⛔ Riwayat dimuat TERPISAH dan kegagalannya tidak mematikan layar.
    // Pemakaian versus kuota adalah isi utama B-29 dan ia sudah berguna
    // sendirian; riwayat tagihan adalah tambahan. Menggabungkan keduanya ke
    // satu `Promise.all` membuat satu 500 di riwayat menghapus angka kuota
    // yang justru selalu benar.
    api
      .minta<Pemakaian>('/tenants/usage')
      .then((data) => {
        // ⛔ Respons yang datang setelah komponen dilepas diabaikan. Tanpa
        // ini, `setKeadaan` pada komponen yang sudah hilang — dan pada
        // pergantian menu cepat, respons LAMA dapat menimpa yang baru.
        if (!batal) setKeadaan({ jenis: 'siap', data });
      })
      .catch((err) => {
        if (batal) return;
        setKeadaan({
          jenis: 'galat',
          // Pesan server dipakai apa adanya — 403 di sini berbunyi "tidak
          // berhak melihat langganan dan batas", dan itu lebih berguna
          // daripada "gagal memuat".
          pesan: pesanGalat(err),
        });
      });

    api
      .minta<RiwayatTagihan>('/tenants/subscription/invoices')
      .then((data) => {
        if (!batal) setRiwayat(data);
      })
      .catch(() => {
        if (!batal) setRiwayat(null);
      });

    return () => {
      batal = true;
    };
  }, [api, putaran]);

  async function beliPaket(paket: string) {
    setAksi({ jenis: 'sibuk' });
    try {
      await api.minta<HasilTagihanBaru>('/tenants/subscription/invoices', {
        metode: 'POST',
        body: { id: crypto.randomUUID(), plan: paket },
        // ⛔ Key dibuat SEKALI per percobaan. Percobaan berikutnya adalah
        // percobaan baru — yang menahan tagihan ganda bukan key ini melainkan
        // index unik parsial di server, dan layar ini menampilkan tagihan
        // terbuka alih-alih menawarkan tombol yang pasti ditolak.
        header: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setAksi({ jenis: 'diam' });
      muatUlang();
    } catch (err) {
      setAksi({ jenis: 'gagal', pesan: pesanGalat(err) });
      // Tagihan mungkin TERLANJUR tersimpan (gateway gagal setelah commit).
      // Memuat ulang riwayat membuat keadaan itu terlihat alih-alih menjadi
      // tagihan hantu yang menolak setiap percobaan berikutnya.
      muatUlang();
    }
  }

  async function cekStatus(id: string) {
    setAksi({ jenis: 'sibuk' });
    try {
      await api.minta<unknown>(`/tenants/subscription/invoices/${id}/check-status`, {
        metode: 'POST',
        body: {},
      });
      setAksi({ jenis: 'diam' });
      muatUlang();
    } catch (err) {
      setAksi({ jenis: 'gagal', pesan: pesanGalat(err) });
    }
  }

  const baris = keadaan.jenis === 'siap' ? susunBaris(keadaan.data, DIMENSI_KUOTA) : [];
  // ⛔ Jumlah outlet diambil dari angka yang DITEGAKKAN (`kuota.outlet`), yaitu
  // hitungan yang sama persis dengan yang server pakai saat menagih.
  // Menghitungnya dari daftar outlet di layar lain akan menyimpang pada aturan
  // arsip, dan selisihnya muncul sebagai perkiraan tagihan yang salah.
  const jumlahOutlet = keadaan.jenis === 'siap' ? (keadaan.data.kuota?.outlet?.terpakai ?? 0) : 0;
  const pilihan =
    keadaan.jenis === 'siap' ? susunPilihan(keadaan.data.plan, jumlahOutlet) : [];
  const terbuka = tagihanTerbuka(riwayat);
  const sibuk = aksi.jenis === 'sibuk';

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '72ch' }}>
      <div className="row between">
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <span className="t-title">Langganan &amp; Batas</span>
          <span className="t-caption">
            {keadaan.jenis === 'siap'
              ? `Paket ${labelPaket(keadaan.data.plan)} · ${labelStatusTenant(keadaan.data.status)}`
              : ' '}
          </span>
        </div>
        <Tombol disabled={sibuk} onClick={muatUlang}>
          Muat ulang
        </Tombol>
      </div>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-6)' }}>
            {keadaan.jenis === 'memuat'
              ? Array.from({ length: JUMLAH_BARIS }, (_, i) => <BarisKerangka key={i} />)
              : null}

            {/* ⛔ EmptyState SAJA, tanpa kerangka di bawahnya.
                 Percobaan pertama menambahkan tiga kerangka untuk menyamakan
                 tinggi dengan keadaan siap; terukur 614px versus 400px — ia
                 tidak menyamakan apa pun, hanya menambah ruang kosong di
                 bawah pesan kegagalan. */}
            {keadaan.jenis === 'galat' ? (
              <EmptyState
                icon={<Icon name="alert" size={32} />}
                title="Pemakaian tidak dapat dimuat"
                body={keadaan.pesan}
                action={<Tombol onClick={muatUlang}>Coba lagi</Tombol>}
              />
            ) : null}

            {keadaan.jenis === 'siap' && baris.length === 0 ? (
              <EmptyState
                icon={<Icon name="alert" size={32} />}
                title="Belum ada dimensi kuota"
                body="Server tidak mengirim satu pun dimensi kuota untuk tenant ini. Hubungi dukungan bila ini berlanjut."
              />
            ) : null}

            {baris.map((b) => (
              <Baris key={b.dimensi} baris={b} />
            ))}
          </div>
        </div>
      </Card>

      {aksi.jenis === 'gagal' ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Permintaan ditolak"
              body={aksi.pesan}
            />
          </div>
        </Card>
      ) : null}

      {terbuka !== null ? (
        <KartuTagihanTerbuka tagihan={terbuka} sibuk={sibuk} onCek={cekStatus} />
      ) : null}

      {/* ⛔ Pilihan paket disembunyikan selama ada tagihan terbuka. Server
           menegakkan satu tagihan terbuka per tenant lewat index unik parsial;
           menawarkan tombol yang pasti dijawab 409 adalah menawarkan
           kegagalan. */}
      {keadaan.jenis === 'siap' && terbuka === null ? (
        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-6)' }}>
              <span className="t-body-md">Paket</span>
              {pilihan.map((p) => (
                <BarisPaket key={p.paket} pilihan={p} nonaktif={sibuk} onBeli={beliPaket} />
              ))}
              <span className="t-caption">
                Harga dihitung per outlet per bulan. Paket naik setelah pembayaran dikonfirmasi,
                bukan saat tagihan dibuat.
              </span>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">Riwayat tagihan</span>
            <Riwayat invoices={riwayat?.invoices ?? []} />
          </div>
        </div>
      </Card>

      <span className="t-caption">
        Kuota ditegakkan saat menambah data, tidak pernah saat berjualan. Kasir tetap dapat
        menjual meski batas produk sudah penuh.
      </span>
    </div>
  );
}
