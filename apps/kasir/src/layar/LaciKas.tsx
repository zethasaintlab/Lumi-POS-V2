import { useCallback, useEffect, useState } from 'react';
import { EmptyState, Icon } from 'ds';
import { Memuat } from '../komponen/Memuat.tsx';
import { GagalBaca } from '../komponen/GagalBaca.tsx';
import { FormKasManual, LABEL_ALASAN } from '../komponen/FormKasManual.tsx';
import { DialogNoSale } from '../komponen/DialogNoSale.tsx';
import { Tombol } from '../Tombol.tsx';
import { bacaKasManualShift, type BarisKasManual } from '../kas/manual.ts';
import { shiftAktif, type ShiftAktif } from '../kas/shift.ts';
import { bacaFitur, fiturAktif, type PetaFitur } from '../fitur/baca.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { useSesi } from '../konteks/useSesi.ts';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* K-18 — Laci kas (`IA:§2.2`, tab bilah nav, rute `/laci`).

   Menampung tiga hal yang sampai Task 4 tersebar: kas masuk/keluar (FR-D5,
   dulu dialog dari toolbar K-03), buka laci tanpa transaksi (K-16, dulu tombol
   toolbar K-03), dan riwayat kas manual shift berjalan (baru, baca-saja).

   ⛔ TIDAK menampilkan saldo laci, di mana pun di layar ini — bukan di kartu
   kiri, bukan di riwayat, bukan sebagai jumlah baris. Saldo adalah
   `saldo_awal + SUM(delta)` dan hanya tampil di K-12 tahap `review`, SESUDAH
   hitungan fisik diisi (`spec-d` FR-D2 hitungan buta: "kasir yang melihat
   angka target akan menghitung mundur ke angka itu"). Layar yang dapat dibuka
   kapan saja di tengah shift dan menampilkan saldo membatalkan kontrol itu
   tanpa satu pun test K-12 merah. Dijaga `tests/kasir-dom/laci-kas.test.js`.

   ⛔ Kill switch `buka_laci_no_sale` menghilangkan tombol buka laci, BUKAN
   kas manual: kill switch tidak boleh menyentuh audit maupun menghentikan
   pencatatan uang (`spec-f:369`, `docs/keputusan/rilis-dan-flag.md`). */

/** Format Indonesia `14:32` (`CLAUDE.md`), zona perangkat = zona outlet. */
function jam(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function LaciKas() {
  const { db } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  const [fitur, setFitur] = useState<PetaFitur>(() => ({}));
  const [riwayat, setRiwayat] = useState<BarisKasManual[]>([]);
  const [galatRiwayat, setGalatRiwayat] = useState<string | null>(null);
  const [siap, setSiap] = useState(false);
  const [gagalMuat, setGagalMuat] = useState<string | null>(null);
  const [bukaLaci, setBukaLaci] = useState(false);
  const [pesanLaci, setPesanLaci] = useState<string | null>(null);

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const k = await bacaKonfigPerangkat(db);
      if (!hidup) return;
      setKonfig(k);
      const s = k ? await shiftAktif(db, k.deviceId) : null;
      if (!hidup) return;
      setShift(s);
      setFitur(await bacaFitur(db));
      if (!hidup) return;
      if (s) setRiwayat(await bacaKasManualShift(db, s.id));
      if (hidup) setSiap(true);
    })().catch((e: Error) => {
      /* ⛔ Tanpa `catch` layar berhenti di penanda memuat SELAMANYA. */
      if (!hidup) return;
      setGagalMuat(e.message);
      setSiap(true);
    });
    return () => {
      hidup = false;
    };
  }, [db]);

  /* Dibaca ulang SESUDAH kas tercatat. Kegagalannya TIDAK menggantikan seluruh
     layar: kas yang baru saja tersimpan tetap tersimpan, dan yang gagal hanya
     tampilan riwayatnya — dinyatakan di kartu riwayat, daftar lama dipertahankan. */
  const muatUlangRiwayat = useCallback(() => {
    if (!shift) return;
    setGalatRiwayat(null);
    bacaKasManualShift(db, shift.id)
      .then(setRiwayat)
      .catch((e: Error) => setGalatRiwayat(`Riwayat tidak dapat dibaca ulang: ${e.message}`));
  }, [db, shift]);

  if (!siap) return <Memuat judul="Membaca laci dari perangkat…" bentuk="grid" jumlah={4} />;

  if (gagalMuat) {
    return (
      <GagalBaca
        akibat="Kas masuk, kas keluar, dan pembukaan laci tidak dapat dicatat dari perangkat ini sampai masalahnya selesai."
        pesan={gagalMuat}
      />
    );
  }

  if (!konfig) {
    return (
      <EmptyState
        title="Perangkat belum terdaftar"
        body="Daftarkan perangkat ini lebih dulu di layar Perangkat & Uji Cetak."
      />
    );
  }

  if (!shift) {
    return (
      <EmptyState
        title="Tidak ada shift yang terbuka"
        body="Buka shift terlebih dahulu untuk mencatat kas masuk, kas keluar, atau membuka laci."
      />
    );
  }

  if (!sesi) {
    return (
      <EmptyState
        title="Sesi tidak dikenali"
        body="Masuk ulang dengan PIN Anda untuk mencatat kas atau membuka laci."
      />
    );
  }

  return (
    <div className="kasir-grid-panel">
      <div className="kasir-laci">
        <section className="card card-pad kasir-dialog-sel">
          <FormKasManual shiftId={shift.id} konfig={konfig} sesi={sesi} onTercatat={muatUlangRiwayat} />

          {/* ⛔ HILANG saat fitur dimatikan, bukan nonaktif: tombol mati yang
              tetap terlihat mengundang kasir menekannya berulang lalu menelepon
              merchant support. Yang menegakkannya di jalur tulis tetap
              `bukaLaci` (kasir/no-sale.ts) — layar bukan satu-satunya penjaga.
              `secondary`, bukan `primary`: aksi utama layar ini Simpan catatan,
              dan membuka laci adalah pola fraud paling dasar (`spec-d:229`).
              44 px, bukan `kritis` 56: no-sale TIDAK memindahkan uang (tanpa
              `cash_movement`) dan konfirmasinya di dialog yang 56 px; kartu ini
              harus muat 1024×768 tanpa gulir. */}
          {fiturAktif(fitur, 'buka_laci_no_sale') && (
            <div className="kasir-laci-nosale">
              <Tombol varian="secondary" onClick={() => setBukaLaci(true)}>
                <Icon name="register" size={17} />
                Buka laci tanpa transaksi
              </Tombol>
              {pesanLaci && (
                <p className="t-caption" role="status">
                  {pesanLaci}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="card card-pad kasir-dialog-sel">
          <h2 className="t-title">Riwayat shift berjalan</h2>
          {galatRiwayat && (
            <p className="t-body-md kasir-login-galat" role="alert">
              {galatRiwayat}
            </p>
          )}
          {/* ⛔ Kosong + galat baca-ulang: HANYA galatnya. Kalimat "Belum ada kas…"
              berdampingan dengan "tidak dapat dibaca ulang" tidak dapat dipercaya —
              kas yang baru saja tersimpan justru bisa ada di baris yang gagal dibaca. */}
          {riwayat.length === 0 && galatRiwayat ? null : riwayat.length === 0 ? (
            <EmptyState
              title="Belum ada kas masuk atau kas keluar di shift ini"
              body="Catatan yang Anda simpan akan muncul di sini."
            />
          ) : (
            <ul className="kasir-laci-riwayat">
              {riwayat.map((b) => (
                <li key={b.id} className="kasir-laci-baris">
                  {/* ⛔ Arah dibawa KATA ("Kas masuk"/"Kas keluar"), bukan warna
                      ikon dan bukan tanda `−` (DS #5). Jumlahnya POSITIF. */}
                  <span className="kasir-laci-ikon" data-arah={b.arah} aria-hidden="true">
                    <Icon name={b.arah === 'masuk' ? 'arrow-down-left' : 'arrow-up-right'} size={18} />
                  </span>
                  <span className="kasir-laci-isi">
                    <b className="t-body-md">{b.arah === 'masuk' ? 'Kas masuk' : 'Kas keluar'}</b>
                    <span className="t-caption">
                      {jam(b.occurredAt)} · {LABEL_ALASAN[b.alasanKode] ?? b.alasanKode}
                      {b.catatan ? ` · ${b.catatan}` : ''}
                    </span>
                  </span>
                  <b className="t-body-md num">{rupiah(b.jumlah)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {bukaLaci && (
        <DialogNoSale
          shiftId={shift.id}
          konfig={konfig}
          sesi={sesi}
          onBatal={() => setBukaLaci(false)}
          onSelesai={(h) => {
            setBukaLaci(false);
            /* ⛔ Keadaan laci DIKEMBALIKAN, bukan didiamkan. Perangkat tanpa
               printer tidak dapat memerintahkan laci terbuka sama sekali, dan
               kasir yang mengira sistem sudah membukanya akan menunggu di
               depan laci yang tertutup. */
            setPesanLaci(
              h.laciTerbuka
                ? `Laci dibuka (pembukaan ke-${h.urutan}). Tercatat di audit.`
                : `Pembukaan ke-${h.urutan} tercatat. Laci harus dibuka manual — belum ada printer terpasang di perangkat ini.`
            );
          }}
        />
      )}
    </div>
  );
}
