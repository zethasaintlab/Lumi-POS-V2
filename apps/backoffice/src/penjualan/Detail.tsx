import { useEffect, useState } from 'react';
import { Badge, EmptyState, Icon, Modal, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import { waktuTampil, zonaPerangkat, labelAlasan } from '../pengawasan/b21.ts';
import { LABEL_STATUS } from './b02.ts';
import {
  barisRingkasan,
  kuantitasTampil,
  pesanDetail,
  sisaTagihan,
  type DetailTransaksi,
  type KeadaanDetail,
} from './b03.ts';
import { labelMetode, labelStatusBayar } from '../../../../packages/domain/src/metode-tampilan.ts';

/**
 * B-03 — Detail Transaksi, sebagai Modal di atas B-02.
 *
 * ## Kenapa Modal, bukan halaman
 *
 * `IA:§3.3` menaruh B-03 di luar menu: ia layar DETAIL yang dicapai dari
 * daftarnya. Modal menjaga daftar beserta penyaring dan halamannya tetap utuh
 * di belakang — dan yang membuka detail biasanya sedang membandingkan beberapa
 * transaksi berturut-turut untuk pelanggan yang menunggu.
 *
 * `Modal.d.ts` design system menyebut peruntukannya persis: *"Modal umum
 * (form/detail)"*.
 *
 * ## ⛔ Angka datang dari server, seluruhnya
 *
 * Tidak ada satu pun total yang dihitung ulang di sini. Yang ditampilkan
 * persis apa yang server kirim — termasuk ketika komponennya terlihat tidak
 * menjumlah, karena kalau itu terjadi yang salah adalah datanya, dan itu harus
 * terlihat alih-alih ditutupi aritmetika klien.
 */

interface Props {
  orderId: string | null;
  onTutup: () => void;
}

export function DetailTransaksiModal({ orderId, onTutup }: Props) {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<KeadaanDetail>({ jenis: 'memuat' });
  const [zona] = useState(() => zonaPerangkat());

  useEffect(() => {
    if (orderId === null) return;
    let batal = false;
    setKeadaan({ jenis: 'memuat' });
    void (async () => {
      try {
        const detail = await api.minta<DetailTransaksi>(
          `/reports/transactions/${encodeURIComponent(orderId)}`
        );
        if (!batal) setKeadaan({ jenis: 'siap', detail });
      } catch (err) {
        if (batal) return;
        setKeadaan({
          jenis: 'galat',
          pesan:
            err instanceof GalatHttp
              ? err.message
              : 'Tidak dapat menghubungi server. Detail transaksi butuh koneksi.',
        });
      }
    })();
    return () => {
      // ⛔ Membuka transaksi lain sebelum yang pertama selesai dimuat akan
      // menampilkan detail YANG SALAH kalau respons lama mendarat belakangan.
      batal = true;
    };
  }, [api, orderId]);

  const pesan = pesanDetail(keadaan);
  const d = keadaan.jenis === 'siap' ? keadaan.detail : null;
  const sisa = d === null ? '0' : sisaTagihan(d);

  return (
    <Modal
      open={orderId !== null}
      title={d === null ? 'Detail transaksi' : `Struk ${d.receiptNumber}`}
      onClose={onTutup}
      width={720}
      footer={<Tombol onClick={onTutup}>Tutup</Tombol>}
    >
      {pesan !== null ? (
        <EmptyState
          icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'receipt'} size={32} />}
          title={pesan.judul}
          body={pesan.badan}
        />
      ) : d !== null ? (
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          {/* --- kepala --- */}
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <div className="row between">
              <span className="t-caption">
                {waktuTampil(d.occurredAt, zona)} · tanggal bisnis{' '}
                <span className="num">{d.businessDate}</span>
              </span>
              <Badge tone={d.dibatalkanOleh !== null ? 'warning' : 'neutral'}>
                {d.dibatalkanOleh !== null
                  ? LABEL_STATUS.dibatalkan
                  : d.refunds.length > 0
                    ? LABEL_STATUS.direfund
                    : LABEL_STATUS.terjual}
              </Badge>
            </div>
            <span className="t-caption">
              Kasir: <strong>{d.createdByNama}</strong> · {d.channel === 'dine_in' ? 'Makan di tempat' : 'Bawa pulang'}
            </span>
            {d.hasCalculationVariance ? (
              // ⛔ Selisih hitungan klien TIDAK PERNAH menolak transaksi
              // (spec-h:95) — yang tersimpan hitungan server. Tapi ia harus
              // TERLIHAT, karena ia satu-satunya jejak bahwa perangkat kasir
              // menghitung angka yang berbeda.
              <span className="t-caption" role="status">
                Perangkat kasir menghitung total yang berbeda
                {d.varianceAmount !== null ? ` (selisih ${rupiah(d.varianceAmount)})` : ''}. Yang
                tersimpan adalah hitungan server.
              </span>
            ) : null}
          </div>

          {/* --- barang --- */}
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span className="label">Rincian barang</span>
            <Table
              columns={[
                { key: 'nama', header: 'Barang' },
                { key: 'qty', header: 'Qty', align: 'right' },
                { key: 'harga', header: 'Harga satuan', align: 'right' },
                { key: 'jumlah', header: 'Subtotal', align: 'right' },
              ]}
              empty="Transaksi ini tidak memiliki baris barang."
              rows={d.lines.map((l) => ({
                nama: (
                  <span className="stack" style={{ gap: 0 }}>
                    <span>
                      {l.itemName}
                      {l.variationName !== '' ? ` — ${l.variationName}` : ''}
                    </span>
                    {l.modifiers.length > 0 ? (
                      <span className="t-caption">
                        {l.modifiers
                          .map((m) => `${m.name}${m.price !== '0' ? ` (${rupiah(m.price)})` : ''}`)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </span>
                ),
                qty: <span className="num">{kuantitasTampil(l.quantityMilli)}×</span>,
                harga: <span className="num">{rupiah(l.unitPrice)}</span>,
                jumlah: <span className="num">{rupiah(l.lineTotal)}</span>,
              }))}
            />
          </div>

          {/* --- ringkasan uang --- */}
          <div className="stack" style={{ gap: 'var(--space-1)' }}>
            <span className="label">Ringkasan</span>
            {barisRingkasan(d).map((b) => (
              <div className="row between" key={b.label}>
                <span className={b.label === 'Total' ? 't-body-md' : 't-caption'}>{b.label}</span>
                <span className={b.label === 'Total' ? 't-body-md num' : 't-caption num'}>
                  {b.label === 'Diskon' ? '− ' : ''}
                  {rupiah(b.nilai)}
                </span>
              </div>
            ))}
          </div>

          {/* --- pembayaran --- */}
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span className="label">Pembayaran</span>
            <Table
              columns={[
                { key: 'metode', header: 'Metode' },
                { key: 'status', header: 'Status' },
                { key: 'tunai', header: 'Diterima', align: 'right' },
                { key: 'kembali', header: 'Kembalian', align: 'right' },
                { key: 'jumlah', header: 'Nominal', align: 'right' },
              ]}
              empty="Belum ada pembayaran atas transaksi ini."
              rows={d.payments.map((p) => ({
                metode: (
                  <span className="stack" style={{ gap: 0 }}>
                    <span>{labelMetode(p.method)}</span>
                    {p.cardLast4 !== null ? (
                      <span className="t-caption num">•••• {p.cardLast4}</span>
                    ) : null}
                  </span>
                ),
                // Status membawa TEKS, tidak pernah warna saja (aturan DS #5).
                status: (
                  <Badge tone={p.status === 'confirmed' ? 'success' : 'warning'}>
                    {labelStatusBayar(p.status)}
                  </Badge>
                ),
                // ⛔ `null` dirender sebagai tanda pisah, BUKAN "Rp 0" —
                // QRIS tidak menerima uang tunai, dan "Rp 0" adalah pernyataan
                // yang salah, bukan sekadar kosong.
                tunai:
                  p.tenderedAmount === null ? (
                    <span className="t-caption">—</span>
                  ) : (
                    <span className="num">{rupiah(p.tenderedAmount)}</span>
                  ),
                kembali:
                  p.changeAmount === null ? (
                    <span className="t-caption">—</span>
                  ) : (
                    <span className="num">{rupiah(p.changeAmount)}</span>
                  ),
                jumlah: <span className="num">{rupiah(p.amount)}</span>,
              }))}
            />
            <div className="row between">
              <span className="t-caption">Total diterima (terkonfirmasi)</span>
              <span className="t-caption num">{rupiah(d.totalDibayar)}</span>
            </div>
            {sisa !== '0' ? (
              <div className="row between">
                <span className="t-caption">Sisa tagihan</span>
                <span className="t-caption num">{rupiah(sisa)}</span>
              </div>
            ) : null}
          </div>

          {/* --- refund --- */}
          {d.refunds.length > 0 ? (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Refund</span>
              <Table
                columns={[
                  { key: 'waktu', header: 'Waktu' },
                  { key: 'alasan', header: 'Alasan' },
                  { key: 'oleh', header: 'Oleh / disetujui' },
                  { key: 'jumlah', header: 'Nominal', align: 'right' },
                ]}
                rows={d.refunds.map((r) => ({
                  waktu: <span className="num">{waktuTampil(r.occurredAt, zona)}</span>,
                  alasan: (
                    <span className="stack" style={{ gap: 0 }}>
                      <span>{labelAlasan(r.reasonCode)}</span>
                      {r.reasonNote !== null && r.reasonNote !== '' ? (
                        <span className="t-caption">{r.reasonNote}</span>
                      ) : null}
                    </span>
                  ),
                  oleh: (
                    <span className="t-caption">
                      {r.createdByNama} / {r.approvedByNama}
                    </span>
                  ),
                  jumlah: <span className="num">− {rupiah(r.amount)}</span>,
                }))}
              />
            </div>
          ) : null}

          {/* ⛔ Refund tidak menghasilkan payment negatif (keputusan 7 Agustus
              2026), jadi "Total diterima" TIDAK berkurang saat direfund.
              Tanpa kalimat ini, angkanya terbaca seperti uang yang masih ada. */}
          {d.refunds.length > 0 ? (
            <span className="t-caption">
              Total diterima di atas tidak dikurangi refund — refund dicatat sebagai baris
              tersendiri, bukan pembayaran negatif. Uang yang benar-benar tinggal adalah{' '}
              <span className="num">{rupiah((BigInt(d.totalDibayar) - BigInt(d.totalRefund)).toString())}</span>.
            </span>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
