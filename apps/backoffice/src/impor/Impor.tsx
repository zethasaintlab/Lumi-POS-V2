import { useRef, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { bangunBerkasGagal, namaBerkasGagal, type MasalahBaris } from './berkas-gagal.ts';

/**
 * B-11 — Impor Katalog (`IA:§3.3`, akses minimum Manajer Area).
 *
 * `spec-a:252`: *"Ini fitur AKUISISI, bukan utilitas admin — migrasi katalog
 * adalah biaya switching terbesar bagi merchant yang pindah dari kompetitor."*
 *
 * ## Alurnya dari spec, bukan dikarang
 *
 * `spec-a:259` menetapkan urutannya: unggah → pratinjau (n valid, m
 * bermasalah) → daftar masalah PER BARIS → impor → ringkasan + unduh baris
 * gagal.
 *
 * Dua langkahnya memakai endpoint yang SAMA, dibedakan `dryRun` — jadi yang
 * dilihat merchant di pratinjau dihitung jalur kode yang sama persis dengan
 * yang menjalankannya. Pratinjau lewat endpoint terpisah dapat menyimpang
 * dari yang benar-benar dijalankan.
 *
 * ## ⛔ "Sudah ada di katalog" ditanyakan SEKALI DI AWAL
 *
 * `spec-a:280`: *"Ditanyakan sekali di awal: lewati semua / perbarui semua"* —
 * bukan per baris. Merchant dengan 5.000 produk yang ditanyai per baris tidak
 * akan menyelesaikan impornya, dan itu tepat kebalikan dari maksud fitur ini.
 *
 * Karena itu pilihannya ada SEBELUM tombol pratinjau, bukan sesudahnya.
 *
 * ## ⛔ Unggah ulang tidak menghukum
 *
 * Kuota impor dihitung dari baris yang akan menjadi produk BARU, bukan dari
 * jumlah baris berkas. Itu yang membuat siklus di layar ini — unduh baris
 * gagal → perbaiki → unggah ulang — mungkin dijalankan berkali-kali tanpa
 * merchant kehabisan kuota karena memperbaiki datanya sendiri.
 */

interface HasilImpor {
  dryRun: boolean;
  jumlahBaris: number;
  diimpor: number;
  dilewati: number;
  kategoriBaru: string[];
  masalah: MasalahBaris[];
}

type Keadaan =
  | { jenis: 'kosong' }
  | { jenis: 'bekerja' }
  | { jenis: 'hasil'; data: HasilImpor }
  | { jenis: 'galat'; pesan: string };

const BILA_SUDAH_ADA = [
  { nilai: 'lewati', label: 'Lewati semua' },
  { nilai: 'perbarui', label: 'Perbarui semua' },
] as const;

export function Impor() {
  const { api } = useSesi();
  const inputRef = useRef<HTMLInputElement>(null);

  const [namaBerkas, setNamaBerkas] = useState('');
  const [isi, setIsi] = useState('');
  const [bilaSudahAda, setBilaSudahAda] = useState<'lewati' | 'perbarui'>('lewati');
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'kosong' });

  async function pilihBerkas(berkas: File | undefined) {
    if (!berkas) return;
    setNamaBerkas(berkas.name);
    // Berkas dibaca SEKALI dan disimpan. Isi mentahnya dibutuhkan lagi setelah
    // impor untuk menyusun berkas baris gagal — server tidak pernah
    // melihatnya, jadi ia tidak dapat mengirimkannya kembali.
    setIsi(await berkas.text());
    setKeadaan({ jenis: 'kosong' });
  }

  async function jalankan(dryRun: boolean) {
    if (isi.length === 0) return;
    setKeadaan({ jenis: 'bekerja' });
    try {
      const data = await api.minta<HasilImpor>('/catalog/import', {
        metode: 'POST',
        body: { csv: isi, dryRun, bilaSudahAda },
      });
      setKeadaan({ jenis: 'hasil', data });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        // Pesan server dipakai apa adanya. Penolakan kuota di sini MEMBAWA
        // ANGKANYA ("Paket saat ini memuat 200 produk. Sudah terpakai 150…"),
        // dan itu satu-satunya informasi yang dapat ditindaklanjuti merchant.
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.',
      });
    }
  }

  function unduhBarisGagal() {
    const hasil = keadaan.jenis === 'hasil' ? keadaan.data : null;
    if (!hasil) return;
    const berkas = bangunBerkasGagal(isi, hasil.masalah);
    if (berkas === null) return;

    // ⛔ BOM sengaja ditambahkan di sini, dan HANYA di sini.
    //
    // Excel di Windows membaca CSV tanpa BOM sebagai ANSI, jadi "Kopi Susu
    // Gula Aren" yang mengandung karakter non-ASCII berubah bentuk saat
    // dibuka. Berkas ini dibuat untuk DIBUKA dan DIPERBAIKI merchant, jadi ia
    // harus terbaca benar di alat yang benar-benar mereka pakai.
    //
    // `pratinjauImpor` membuang BOM di baris pertama, jadi unggah ulang tetap
    // bekerja — dan itu diuji, bukan diasumsikan.
    const blob = new Blob(['﻿', berkas], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = namaBerkasGagal(namaBerkas);
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasil = keadaan.jenis === 'hasil' ? keadaan.data : null;
  const sibuk = keadaan.jenis === 'bekerja';

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '80ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Impor Katalog</span>
        <span className="t-caption">
          Berkas CSV dengan kolom <strong>nama</strong>, <strong>harga</strong>, dan{' '}
          <strong>kategori</strong>. Kategori yang belum ada dibuat otomatis.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Berkas</span>
              {/* `<input type="file">` tidak punya padanan di design system;
                  ia disembunyikan dan dipicu tombol supaya tampilannya tetap
                  milik `components.css`. */}
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => void pilihBerkas(e.target.files?.[0])}
              />
              <div className="row" style={{ gap: 'var(--space-3)' }}>
                <Tombol onClick={() => inputRef.current?.click()}>Pilih berkas…</Tombol>
                <span className="t-caption">
                  {namaBerkas.length > 0 ? namaBerkas : 'Belum ada berkas dipilih'}
                </span>
              </div>
            </div>

            {/* ⛔ SEBELUM tombol pratinjau. `spec-a:280` menuntutnya
                ditanyakan sekali di awal, bukan per baris. */}
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Bila nama produk sudah ada di katalog</span>
              <div className="row" style={{ gap: 'var(--space-2)' }}>
                {BILA_SUDAH_ADA.map((p) => (
                  <Tombol
                    key={p.nilai}
                    varian={bilaSudahAda === p.nilai ? 'primary' : 'secondary'}
                    onClick={() => setBilaSudahAda(p.nilai)}
                  >
                    {p.label}
                  </Tombol>
                ))}
              </div>
              <span className="t-caption">
                {bilaSudahAda === 'lewati'
                  ? 'Produk yang sudah ada tidak disentuh.'
                  : 'Kategori produk yang sudah ada diperbarui. Harga tidak pernah diubah lewat impor — perubahan harga punya riwayatnya sendiri.'}
              </span>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol
                varian="primary"
                disabled={isi.length === 0 || sibuk}
                onClick={() => void jalankan(true)}
              >
                {sibuk ? 'Memeriksa…' : 'Periksa berkas'}
              </Tombol>
              {/* ⛔ Tombol jalankan hanya muncul SETELAH pratinjau, dan hilang
                  lagi begitu impor sungguhan selesai — katalog tidak pernah
                  di-DELETE, jadi impor yang terlanjur berjalan dua kali harus
                  diarsipkan satu per satu. */}
              {hasil?.dryRun ? (
                <Tombol disabled={sibuk} onClick={() => void jalankan(false)}>
                  Impor {hasil.diimpor.toLocaleString('id-ID')} produk
                </Tombol>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {keadaan.jenis === 'galat' ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Berkas tidak dapat diimpor"
              body={keadaan.pesan}
            />
          </div>
        </Card>
      ) : null}

      {hasil ? (
        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <div className="row between">
                <span className="t-body-md">
                  {hasil.dryRun ? 'Pratinjau' : 'Impor selesai'}
                </span>
                <Badge tone={hasil.masalah.length > 0 ? 'warning' : 'success'}>
                  {hasil.masalah.length > 0
                    ? `${hasil.masalah.length.toLocaleString('id-ID')} baris bermasalah`
                    : 'Semua baris terbaca'}
                </Badge>
              </div>

              {/* `jumlahBaris = diimpor + dilewati + masalah` — ditegakkan
                  test di server. Ditampilkan utuh supaya merchant dapat
                  memeriksanya sendiri. */}
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <span className="t-body num">
                  {hasil.diimpor.toLocaleString('id-ID')}{' '}
                  {hasil.dryRun ? 'akan diimpor' : 'diimpor'}
                </span>
                <span className="t-caption num">
                  {hasil.dilewati.toLocaleString('id-ID')} dilewati (sudah ada) ·{' '}
                  {hasil.masalah.length.toLocaleString('id-ID')} bermasalah · dari{' '}
                  {hasil.jumlahBaris.toLocaleString('id-ID')} baris
                </span>
                {hasil.kategoriBaru.length > 0 ? (
                  <span className="t-caption">
                    Kategori {hasil.dryRun ? 'yang akan dibuat' : 'baru dibuat'}:{' '}
                    {hasil.kategoriBaru.join(', ')}
                  </span>
                ) : null}
              </div>

              {hasil.masalah.length > 0 ? (
                <div className="stack" style={{ gap: 'var(--space-2)' }}>
                  <div className="row between">
                    <span className="t-body-md">Baris bermasalah</span>
                    {/* AC `spec-a:288`. Berkasnya memuat baris aslinya APA
                        ADANYA plus kolom `alasan`, dan dapat diunggah ulang
                        setelah diperbaiki. */}
                    <Tombol onClick={unduhBarisGagal}>Unduh baris gagal</Tombol>
                  </div>
                  <Table
                    columns={[
                      { key: 'baris', header: 'Baris', align: 'right' },
                      { key: 'alasan', header: 'Alasan' },
                    ]}
                    rows={hasil.masalah.map((m) => ({
                      baris: m.baris,
                      alasan: m.alasan,
                    }))}
                  />
                  <span className="t-caption">
                    Baris bermasalah tidak diimpor. Baris yang sah tetap masuk — memperbaikinya
                    tidak menuntut mengulang seluruh berkas.
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
