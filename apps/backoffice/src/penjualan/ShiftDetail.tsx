import { useEffect, useState } from 'react';
import { Badge, EmptyState, Icon, Modal, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../katalog/produk.ts';
import { waktuTampil, zonaPerangkat } from '../pengawasan/b21.ts';
import {
  LABEL_SELISIH,
  arahSelisih,
  besaranSelisih,
  labelGerak,
  labelMetode,
  labelAlasanSelisih,
  nadaSelisih,
  type DetailShift,
} from './b04.ts';

/**
 * B-05 — Detail Shift, sebagai Modal di atas B-04.
 *
 * ## ⛔ Urutan angkanya mengikuti cara kasir menghitung
 *
 * Saldo awal → penerimaan tunai → gerakan kas lain → saldo seharusnya →
 * hitungan fisik → selisih. Menampilkan selisih lebih dulu membuat angka di
 * atasnya terbaca sebagai pembenaran, bukan sebagai perhitungan.
 *
 * ## ⛔ Riwayat percobaan hitungan ditampilkan
 *
 * `spec-d`: kasir tidak dapat mengubah hitungan setelah melihat selisih;
 * koreksinya tercatat sebagai percobaan kedua. Riwayat yang tidak pernah
 * ditampilkan tidak menahan siapa pun — ia hanya menahan orang yang tahu ia
 * ada.
 */

type Baris = Record<string, unknown>;
const ANGKA = { whiteSpace: 'nowrap' } as const;

type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; detail: DetailShift }
  | { jenis: 'galat'; pesan: string };

interface Props {
  shiftId: string | null;
  onTutup: () => void;
}

export function ShiftDetailModal({ shiftId, onTutup }: Props) {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [zona] = useState(() => zonaPerangkat());

  useEffect(() => {
    if (shiftId === null) return;
    let batal = false;
    setKeadaan({ jenis: 'memuat' });
    void (async () => {
      try {
        const detail = await api.minta<DetailShift>(
          `/reports/shifts/${encodeURIComponent(shiftId)}`
        );
        if (!batal) setKeadaan({ jenis: 'siap', detail });
      } catch (err) {
        if (batal) return;
        setKeadaan({
          jenis: 'galat',
          pesan:
            err instanceof GalatHttp
              ? err.message
              : 'Tidak dapat menghubungi server. Detail shift butuh koneksi.',
        });
      }
    })();
    // Membuka shift lain sebelum yang pertama selesai dimuat akan menampilkan
    // detail YANG SALAH kalau respons lama mendarat belakangan.
    return () => {
      batal = true;
    };
  }, [api, shiftId]);

  const d = keadaan.jenis === 'siap' ? keadaan.detail : null;
  const arah = d === null ? 'belum' : arahSelisih(d.difference);

  return (
    <Modal
      open={shiftId !== null}
      title={d === null ? 'Detail shift' : `Shift ${d.businessDate}`}
      onClose={onTutup}
      width={680}
      footer={<Tombol onClick={onTutup}>Tutup</Tombol>}
    >
      {keadaan.jenis !== 'siap' ? (
        <EmptyState
          icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'clock'} size={32} />}
          title={keadaan.jenis === 'galat' ? 'Detail tidak dapat dimuat' : 'Memuat detail…'}
          body={
            keadaan.jenis === 'galat'
              ? keadaan.pesan
              : 'Mengambil rincian shift dari server.'
          }
        />
      ) : d !== null ? (
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          <div className="stack" style={{ gap: 'var(--space-1)' }}>
            <div className="row between">
              <span className="t-caption">
                Dibuka {waktuTampil(d.openedAt, zona)} oleh <strong>{d.openedByNama}</strong>
              </span>
              <Badge tone={nadaSelisih(arah)}>{LABEL_SELISIH[arah]}</Badge>
            </div>
            {d.closedAt !== null ? (
              <span className="t-caption">
                Ditutup {waktuTampil(d.closedAt, zona)}
                {d.closedByNama !== null ? (
                  <>
                    {' '}
                    oleh <strong>{d.closedByNama}</strong>
                  </>
                ) : null}
                {/* ⛔ Penyetuju ditampilkan bila ada. Ia satu-satunya jejak di
                    layar bahwa selisihnya melewati ambang dan seseorang
                    bertanggung jawab menerimanya. */}
                {d.approvedByNama !== null ? (
                  <>
                    {' '}
                    · disetujui <strong>{d.approvedByNama}</strong>
                  </>
                ) : null}
              </span>
            ) : (
              <span className="t-caption">Shift ini masih berjalan.</span>
            )}
          </div>

          {/* --- rincian penerimaan --- */}
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span className="label">Penerimaan per metode</span>
            <Table
              columns={[
                { key: 'metode', header: 'Metode' },
                { key: 'jumlah', header: 'Transaksi', align: 'right' },
                { key: 'total', header: 'Diterima', align: 'right' },
              ]}
              empty="Belum ada pembayaran terkonfirmasi pada shift ini."
              rows={d.perMetode.map<Baris>((m) => ({
                metode: labelMetode(m.method),
                jumlah: <span className="num">{m.jumlahTransaksi}</span>,
                total: (
                  <span className="num" style={ANGKA}>
                    {rupiah(m.total)}
                  </span>
                ),
              }))}
            />
            <span className="t-caption">
              Hanya pembayaran yang <strong>terkonfirmasi</strong>. QRIS yang masih menunggu
              jawaban gateway tidak dihitung.
            </span>
          </div>

          {/* --- gerakan kas lain --- */}
          {d.gerakanKas.length > 0 ? (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Gerakan kas lain</span>
              <Table
                columns={[
                  { key: 'waktu', header: 'Waktu' },
                  { key: 'jenis', header: 'Jenis' },
                  { key: 'alasan', header: 'Alasan' },
                  { key: 'nilai', header: 'Nilai', align: 'right' },
                ]}
                rows={d.gerakanKas.map<Baris>((g) => ({
                  waktu: (
                    <span className="num" style={ANGKA}>
                      {waktuTampil(g.occurredAt, zona)}
                    </span>
                  ),
                  jenis: labelGerak(g.type),
                  alasan: (
                    <span className="t-caption">
                      {/* ⛔ `cash_movement.reason_code` adalah teks BEBAS — tidak
                          ada CHECK constraint dan tidak ada daftar tertutup.
                          Memetakannya lewat kamus mana pun akan menampilkan
                          `—` untuk kode yang sah tapi tidak terdaftar. */}
                      {g.reasonCode !== null && g.reasonCode !== '' ? g.reasonCode : '—'}
                      {g.note !== null && g.note !== '' ? ` · ${g.note}` : ''}
                    </span>
                  ),
                  nilai: (
                    <span className="num" style={ANGKA}>
                      {g.delta.startsWith('-') ? '− ' : ''}
                      {rupiah(g.delta.replace('-', ''))}
                    </span>
                  ),
                }))}
              />
            </div>
          ) : null}

          {/* --- perhitungan kas, urut seperti kasir menghitungnya --- */}
          <div className="stack" style={{ gap: 'var(--space-1)' }}>
            <span className="label">Perhitungan kas</span>
            {[
              ['Saldo awal (modal)', d.openingFloat],
              ['Total diterima', d.totalDiterima],
              ['Saldo seharusnya', d.expectedAmount],
              ['Hitungan fisik', d.countedAmount],
            ].map(([label, nilai]) => (
              <div className="row between" key={label as string}>
                <span className="t-caption">{label}</span>
                <span className="t-caption num" style={ANGKA}>
                  {/* ⛔ `null` DIPERTAHANKAN sebagai tanda pisah. "Rp 0" untuk
                      shift yang belum dihitung adalah pernyataan yang salah. */}
                  {nilai === null ? '—' : rupiah(nilai as string)}
                </span>
              </div>
            ))}
            <div className="row between">
              <span className="t-body-md">Selisih</span>
              <span className="row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
                <span className="t-body-md num" style={ANGKA}>
                  {arah === 'belum'
                    ? '—'
                    : `${arah === 'kurang' ? '− ' : arah === 'lebih' ? '+ ' : ''}${rupiah(besaranSelisih(d.difference))}`}
                </span>
                <Badge tone={nadaSelisih(arah)}>{LABEL_SELISIH[arah]}</Badge>
              </span>
            </div>
            {d.varianceReasonCode !== null ? (
              <span className="t-caption">
                Alasan: {labelAlasanSelisih(d.varianceReasonCode)}
                {d.varianceNote !== null && d.varianceNote !== '' ? ` — ${d.varianceNote}` : ''}
              </span>
            ) : null}
          </div>

          {/* --- riwayat percobaan --- */}
          {d.percobaanHitungan.length > 0 ? (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Riwayat hitungan</span>
              <Table
                columns={[
                  { key: 'ke', header: 'Percobaan' },
                  { key: 'waktu', header: 'Waktu' },
                  { key: 'hitungan', header: 'Hitungan', align: 'right' },
                ]}
                rows={d.percobaanHitungan.map<Baris>((p, i) => ({
                  ke: <span className="num">{i + 1}</span>,
                  waktu: (
                    <span className="num" style={ANGKA}>
                      {p.pada === null ? '—' : waktuTampil(p.pada, zona)}
                    </span>
                  ),
                  hitungan: (
                    <span className="num" style={ANGKA}>
                      {rupiah(p.hitungan)}
                    </span>
                  ),
                }))}
              />
              {/* ⛔ Dinyatakan. Riwayat yang tidak pernah ditampilkan tidak
                  menahan siapa pun. */}
              <span className="t-caption">
                Hitungan tidak dapat diubah setelah selisihnya terlihat — koreksi tercatat sebagai
                percobaan berikutnya, bukan menimpa yang sebelumnya.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
