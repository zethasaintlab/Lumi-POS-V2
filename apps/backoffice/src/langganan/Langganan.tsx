import { useEffect, useState } from 'react';
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

export function Langganan() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [putaran, setPutaran] = useState(0);

  useEffect(() => {
    let batal = false;
    setKeadaan({ jenis: 'memuat' });

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
          pesan:
            err instanceof GalatHttp
              ? err.message
              : 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.',
        });
      });

    return () => {
      batal = true;
    };
  }, [api, putaran]);

  const baris = keadaan.jenis === 'siap' ? susunBaris(keadaan.data, DIMENSI_KUOTA) : [];

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '72ch' }}>
      <div className="row between">
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <span className="t-title">Langganan &amp; Batas</span>
          <span className="t-caption">
            {keadaan.jenis === 'siap'
              ? `Paket ${labelPaket(keadaan.data.plan)} · ${labelStatusTenant(keadaan.data.status)}`
              : ' '}
          </span>
        </div>
        <Tombol onClick={() => setPutaran((n) => n + 1)}>Muat ulang</Tombol>
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
                action={<Tombol onClick={() => setPutaran((n) => n + 1)}>Coba lagi</Tombol>}
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

      <span className="t-caption">
        Kuota ditegakkan saat menambah data, tidak pernah saat berjualan. Kasir tetap dapat
        menjual meski batas produk sudah penuh.
      </span>
    </div>
  );
}
