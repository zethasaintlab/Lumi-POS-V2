import { useEffect, useState } from 'react';
import { EmptyState } from 'ds';
import { GagalBaca } from '../komponen/GagalBaca.tsx';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { shiftAktif, type ShiftAktif } from '../kas/shift.ts';
import {
  ALASAN_SELISIH,
  butuhOtorisasiSelisih,
  catatHitungan,
  laporanShift,
  ringkasanSebelumHitung,
  tutupKas,
  type LaporanShift,
  type RingkasanAwal,
} from '../kas/tutup.ts';
import { muatHlc } from '../lokal/hlc.ts';
import { DialogOtorisasi } from '../komponen/DialogOtorisasi.tsx';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { useSesi } from '../konteks/useSesi.ts';
import { labelMetode } from '../../../../packages/domain/src/metode-tampilan.ts';
import { Tombol } from '../Tombol.tsx';
import { navigasi } from '../rute/navigasi.ts';
import { BASIS } from '../rute/tabel.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* K-12 Tutup Kas + K-13 Laporan Shift (IA §2.2).

   ⛔ "Urutan input wajib" (`IA:71`, FR-D2). Layar ini punya TIGA tahap yang
   tidak dapat dilompati:

     hitung  → jumlah transaksi + rincian metode. TIDAK ada saldo terhitung.
     review  → setelah hitungan dimasukkan: saldo seharusnya + selisih.
     selesai → K-13, laporan yang dapat dicetak.

   `spec-d`: "Ini kontrol, bukan preferensi UX — kasir yang melihat angka
   target akan menghitung mundur ke angka itu." Design system sudah menetapkan
   copy-nya: "Hitung dulu, baru sistem menampilkan angkanya." */

const PECAHAN = [1000, 5000, 10000, 50000, 100000];

/* ⛔ Peta nama metode DIHAPUS dari sini, 1 September 2026.
 *
 * Yang berdiri di sini adalah salinan KEEMPAT, dan ia sudah menyimpang: ia
 * memuat `card` — kode yang tidak ada di skema mana pun; kolomnya `card_edc` —
 * sementara `qris_static` dan `card_edc` TIDAK ada di dalamnya sama sekali.
 * Akibatnya kasir yang menutup shift dengan QRIS statis membaca baris berbunyi
 * `qris_static` di layar hitungan laci — layar tempat selisih paling
 * berbahaya, dan satu-satunya angka non-tunai yang ia punya untuk
 * mencocokkannya.
 *
 * Ditemukan lewat galeri komponen, dengan data pembayaran campuran. Tidak satu
 * pun dari seluruh test kasir merah karenanya: semuanya memakai `cash`, dan `cash`
 * adalah satu-satunya kunci yang keempat salinan sepakati.
 *
 * `labelMetode` dari `packages/domain` adalah peta LAYAR, dibagi dengan
 * back-office dan HP. `cetak/metode.ts` tetap terpisah — nama struk
 * dipendekkan untuk 32 kolom, dan alasannya dinyatakan di kedua berkas.
 */

export function TutupKas() {
  const { db, pemberitahu } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  const [ringkas, setRingkas] = useState<RingkasanAwal | null>(null);
  const [siap, setSiap] = useState(false);
  const [gagalMuat, setGagalMuat] = useState<string | null>(null);

  const [hitungan, setHitungan] = useState(0);
  const [review, setReview] = useState<{ selisih: number; saldoSeharusnya: number; percobaan: number } | null>(null);
  const [kodeAlasan, setKodeAlasan] = useState('');
  const [catatan, setCatatan] = useState('');
  const [mintaOtorisasi, setMintaOtorisasi] = useState(false);
  const [laporan, setLaporan] = useState<LaporanShift | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const k = await bacaKonfigPerangkat(db);
      if (!hidup) return;
      setKonfig(k);
      const s = k ? await shiftAktif(db, k.deviceId) : null;
      if (!hidup) return;
      setShift(s);
      if (s) setRingkas(await ringkasanSebelumHitung(db, s.id));
      if (hidup) setSiap(true);
    })().catch((e: Error) => {
      /* ⛔ Tanpa ini layar berhenti di "Menyiapkan tutup kas" selamanya, dan
         kasir yang hendak pulang tidak punya satu pun cara mengetahui apakah
         shiftnya tertutup. */
      if (!hidup) return;
      setGagalMuat(e.message);
      setSiap(true);
    });
    return () => {
      hidup = false;
    };
  }, [db]);

  if (!siap) return <EmptyState title="Menyiapkan tutup kas" body="Membaca data shift." />;

  /* ⛔ Mendahului "Tidak ada shift yang dapat ditutup". Pesan itu menyuruh
     kasir membuka shift; pada database yang tidak dapat dibaca, shiftnya
     mungkin justru terbuka dan hanya tidak terbaca. */
  if (gagalMuat) {
    return <GagalBaca akibat="Shift tidak dapat ditutup dari perangkat ini sampai masalahnya selesai." pesan={gagalMuat} />;
  }

  /* K-13 — laporan shift. Dari data LOKAL (AC FR-D8): laporan yang menuntut
     jaringan tidak berguna justru saat kasir menutup toko dengan internet
     mati. */
  if (laporan) {
    return (
      <div className="kasir-grid-panel">
        <h1 className="t-title">Laporan Shift</h1>
        <p className="t-caption kasir-login-sub">
          {laporan.businessDate} · dibuka {laporan.dibukaOleh} · ditutup {laporan.ditutupOleh}
        </p>

        {/* FR-G3 + FR-G2 — posisi penjualan, dengan basisnya tertulis.
            `spec-g:64`: labelnya "tidak dapat dilewatkan, bukan tooltip".
            Angkanya dari `posisiPenjualan`, fungsi yang sama yang dipakai
            laporan harian — itu yang membuat keduanya tidak dapat berbeda. */}
        <h2 className="t-body-md">Penjualan shift ini</h2>
        <Baris label="Omzet kotor" nilai={laporan.penjualan.omzetKotor} />
        {laporan.penjualan.voidAmount > 0n && (
          <Baris label="Dibatalkan" nilai={-laporan.penjualan.voidAmount} />
        )}
        {laporan.penjualan.refundAmount > 0n && (
          <Baris label="Refund" nilai={-laporan.penjualan.refundAmount} />
        )}
        <Baris label="Omzet bersih" nilai={laporan.penjualan.omzetBersih} tebal />
        <p className="t-caption kasir-login-sub">
          Setelah void &amp; refund · {laporan.penjualan.jumlahTransaksi} transaksi · rata-rata{' '}
          {rupiah(Number(laporan.penjualan.rataRataPerTransaksi))}
        </p>
        {/* FR-G4 — `spec-g:111`. Tanpa kalimat ini, kasir atau owner yang
            membaca satu tablet membacanya sebagai angka seluruh outlet. */}
        <p className="t-caption kasir-login-sub">
          Hanya transaksi dari perangkat ini.
        </p>

        <h2 className="t-body-md">Laci kas</h2>
        <Baris label="Saldo awal" nilai={laporan.saldoAwal} />
        {laporan.perMetode.map((m) => (
          <Baris key={m.metode} label={labelMetode(m.metode)} nilai={m.total} />
        ))}
        <Baris label="Saldo seharusnya" nilai={laporan.saldoSeharusnya} />
        <Baris label="Hitungan fisik" nilai={laporan.hitunganFisik ?? 0} />
        <Baris label="Selisih" nilai={laporan.selisih ?? 0} tebal />

        {laporan.alasanSelisih && (
          <p className="t-body-md">
            Alasan: {ALASAN_SELISIH.find((a) => a.kode === laporan.alasanSelisih)?.label ?? laporan.alasanSelisih}
            {laporan.disetujuiOleh ? ` · disetujui ${laporan.disetujuiOleh}` : ''}
          </p>
        )}

        {/* ⛔ Riwayat percobaan DITAMPILKAN. Ia kontrol anti-fraud, bukan
            catatan teknis — laporan yang menyembunyikannya membuat "kasir
            menghitung tiga kali sampai angkanya cocok" tidak terlihat siapa
            pun. */}
        {laporan.percobaan.length > 1 && (
          <>
            <h2 className="t-body-md kasir-login-galat">
              {laporan.percobaan.length} kali percobaan hitungan
            </h2>
            <ul className="kasir-baris-daftar">
              {laporan.percobaan.map((p, i) => (
                <li key={p.pada} className="kasir-baris">
                  <span className="grow t-caption">Percobaan {i + 1}</span>
                  <span className="t-body-md num">{rupiah(p.hitungan)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <Tombol varian="primary" kritis onClick={() => navigasi(BASIS + '/')}>
          Selesai
        </Tombol>
      </div>
    );
  }

  if (!konfig || !shift || !sesi || !ringkas) {
    return (
      <EmptyState
        title="Tidak ada shift yang dapat ditutup"
        body="Buka shift terlebih dahulu sebelum menutup kas."
      />
    );
  }

  const simpan = (approverId: string | null) => {
    setSibuk(true);
    setGalat(null);
    void muatHlc(db, () => Date.now())
      .then((hlc) =>
        tutupKas({
          db,
          shiftId: shift.id,
          hitungan,
          sesi,
          approverId,
          alasan: kodeAlasan ? { kode: kodeAlasan, catatan: catatan || null } : null,
          waktu: () => new Date(),
          idBaru: () => crypto.randomUUID(),
          hlc: () => hlc.tick(),
        })
      )
      .then(async (hasil) => {
        if (hasil.status === 'tertutup') {
          pemberitahu.beritahu();
          setLaporan(await laporanShift(db, shift.id));
          return;
        }
        if (hasil.status === 'butuh_otorisasi') setGalat('Selisih di atas ambang — PIN manajer diperlukan.');
        else if (hasil.status === 'butuh_alasan') setGalat('Pilih alasan selisih terlebih dahulu.');
        else if (hasil.status === 'penyetuju_sama_dengan_aktor')
          setGalat('Anda tidak dapat menyetujui selisih hitungan Anda sendiri.');
        else setGalat('Kas tidak dapat ditutup.');
      })
      .catch((e: Error) => setGalat(`Kas TIDAK tertutup: ${e.message}`))
      .finally(() => {
        setSibuk(false);
        setMintaOtorisasi(false);
      });
  };

  if (mintaOtorisasi) {
    return (
      <DialogOtorisasi
        aktorId={sesi.userId}
        judul={`Otorisasi selisih ${rupiah(review?.selisih ?? 0)}`}
        onBatal={() => setMintaOtorisasi(false)}
        onSetuju={({ approverId }) => simpan(approverId)}
      />
    );
  }

  /* Tahap REVIEW — hanya setelah hitungan dimasukkan. */
  if (review) {
    const perluOtorisasi = butuhOtorisasiSelisih(review.selisih);
    return (
      <div className="kasir-grid-panel">
        <h1 className="t-title">Hasil hitungan</h1>

        <Baris label="Saldo awal" nilai={ringkas.saldoAwal} />
        {/* Di tahap REVIEW angka tunai boleh muncul: hitungan fisik sudah
            terkunci sebagai percobaan, jadi tidak ada lagi yang dapat
            dihitung mundur. */}
        <Baris label="Saldo seharusnya" nilai={review.saldoSeharusnya} />
        <Baris label="Hitungan fisik" nilai={hitungan} />
        <Baris label="SELISIH" nilai={review.selisih} tebal />

        {review.percobaan > 1 && (
          <p className="t-caption kasir-login-galat">
            Percobaan hitungan ke-{review.percobaan}. Seluruhnya tercatat.
          </p>
        )}

        {perluOtorisasi && (
          <>
            <p className="t-body-md kasir-login-galat">
              Selisih {rupiah(Math.abs(review.selisih))} — persetujuan manajer diperlukan.
            </p>
            <fieldset className="kasir-alasan">
              <legend className="t-body-md">Alasan selisih</legend>
              {ALASAN_SELISIH.map((a) => (
                <label key={a.kode} className="kasir-alasan-opsi t-body-md">
                  <input
                    type="radio"
                    name="alasan-selisih"
                    checked={kodeAlasan === a.kode}
                    onChange={() => setKodeAlasan(a.kode)}
                  />
                  {a.label}
                </label>
              ))}
            </fieldset>
            {kodeAlasan === 'lainnya' && (
              <textarea
                className="kasir-catatan"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="Jelaskan selisihnya (minimal 10 karakter)"
                rows={2}
              />
            )}
          </>
        )}

        <p className="t-body-md kasir-login-galat kasir-pesan-tetap" role="alert">
          {galat ?? ' '}
        </p>

        <div className="kasir-dialog-aksi">
          {/* Hitung ULANG tetap mungkin — tapi tercatat sebagai percobaan
              baru, dan layar mengatakannya. `spec-d`: kasir tidak dapat
              MENGUBAH hitungan, ia memasukkan hitungan lain. */}
          <Tombol
            varian="ghost"
            kritis
            disabled={sibuk}
            onClick={() => {
              setReview(null);
              setHitungan(0);
              setGalat(null);
            }}
          >
            Hitung ulang
          </Tombol>
          <Tombol
            varian="primary"
            kritis
            disabled={sibuk || (perluOtorisasi && kodeAlasan === '')}
            onClick={() => {
              if (perluOtorisasi) setMintaOtorisasi(true);
              else simpan(null);
            }}
          >
            {sibuk ? 'Menutup…' : 'Tutup Kas'}
          </Tombol>
        </div>
      </div>
    );
  }

  /* Tahap HITUNG — dan di sini TIDAK ADA satu pun angka saldo terhitung. */
  return (
    <div className="kasir-shift">
      <h1 className="t-title">Tutup Kas</h1>
      <p className="t-body-md kasir-login-sub">Hitung dulu, baru sistem menampilkan angkanya.</p>

      <p className="t-caption kasir-login-sub">
        {ringkas.jumlahTransaksi} transaksi ·{' '}
        {ringkas.perMetode
          .map((m) =>
            // Tunai: JUMLAH saja, tanpa total — lihat `RingkasanAwal.perMetode`.
            m.total === null
              ? `${labelMetode(m.metode)} ${m.jumlah}×`
              : `${labelMetode(m.metode)} ${rupiah(m.total)}`
          )
          .join(' · ')}
      </p>

      <p className="t-body-md">Hitungan fisik laci</p>
      <p className="t-display num">{rupiah(hitungan)}</p>

      <div className="kasir-pecahan">
        {PECAHAN.map((p) => (
          <Tombol key={p} kritis disabled={sibuk} onClick={() => setHitungan((h) => h + p)}>
            + {rupiah(p)}
          </Tombol>
        ))}
        <Tombol varian="ghost" kritis disabled={sibuk || hitungan === 0} onClick={() => setHitungan(0)}>
          Hapus
        </Tombol>
      </div>

      <Tombol
        varian="primary"
        kritis
        disabled={sibuk || hitungan === 0}
        onClick={() => {
          setSibuk(true);
          /* ⛔ `konfig`, `sesi`, `idBaru`, dan `hlc` ikut supaya percobaan
             meninggalkan JEJAK AUDIT, bukan hanya riwayat lokal. Tanpanya
             `catatHitungan` tetap bekerja — riwayatnya benar — tapi percobaan
             yang DITOLAK tidak tercatat di mana pun, dan itu justru percobaan
             yang `spec-d:127` ingin buktikan tidak dapat diulang diam-diam. */
          void muatHlc(db, () => Date.now())
            .then((jam) =>
              catatHitungan({
                db,
                shiftId: shift.id,
                hitungan,
                waktu: () => new Date(),
                konfig,
                sesi,
                idBaru: () => crypto.randomUUID(),
                hlc: () => jam.tick(),
              })
            )
            .then((h) => setReview(h))
            .catch((e: Error) => setGalat(e.message))
            .finally(() => setSibuk(false));
        }}
      >
        Lanjut
      </Tombol>
    </div>
  );
}

function Baris({
  label,
  nilai,
  tebal = false,
}: {
  label: string;
  // `bigint` juga: posisi penjualan (FR-G3) memakai rupiah utuh ber-bigint,
  // sementara angka laci datang dari kolom INTEGER sebagai number.
  nilai: number | bigint;
  tebal?: boolean;
}) {
  const n = Number(nilai);
  return (
    <div className="kasir-subtotal">
      <span className="t-body-md">{label}</span>
      {/* ⛔ Tandanya diserahkan ke `rupiah`, bukan ditangani lagi di sini.
          Sebelum pemformat dibagi, baris ini punya cabangnya sendiri
          (`− ${rupiah(-n)}`) karena `toLocaleString` menghasilkan
          `Rp -20.000` — hyphen ASCII, bukan `−`, dan tandanya di tempat yang
          salah. Cabang itu kini menghasilkan hal yang sama persis dengan
          `rupiah(n)`, dan dua tempat yang memutuskan format nilai negatif
          adalah tepat yang pemindahan ke `packages/domain` selesaikan. */}
      <span className={tebal ? 't-title num' : 't-body-md num'}>{rupiah(n)}</span>
    </div>
  );
}
