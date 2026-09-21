import { useCallback, useEffect, useState } from 'react';
import {
  ringkasanAntrean,
  type RingkasanAntrean,
} from '../../../../packages/sync-client/src/status.ts';
import { useKeadaanLokal } from './DbLokalProvider.tsx';

/* Ringkasan antrean, dijaga tetap mutakhir lewat DUA jalur.

   ⛔ Bukan kehati-hatian berlebihan. Keduanya menutupi kelemahan yang lain:

     - `pemberitahu` menyala SEKETIKA, tapi hanya untuk perubahan yang lewat
       kode kita (penjualan baru, putaran relay selesai).
     - `watch()` melihat SEMUANYA -- termasuk katalog yang turun dan tulisan
       dari tab lain -- tapi butuh ~1.000 ms (diukur sembilan kali; lihat
       PLAN-pondasi-kasir §11.4), sementara `spec-h:224` menuntut < 1 detik.

   Menyandarkan indikator pada salah satunya saja berarti memilih antara
   "cepat tapi buta" dan "melihat semua tapi terlambat". */

export const RINGKASAN_KOSONG: RingkasanAntrean = {
  menunggu: 0,
  gagal: 0,
  tertuaPada: null,
  terakhirTerkirimPada: null,
};

export function useAntrean(): {
  ringkasan: RingkasanAntrean;
  siap: boolean;
  /**
   * Apakah `ringkasan` berasal dari pembacaan yang BERHASIL.
   *
   * ⛔ Satu boolean, bukan tiga keadaan (`belum`/`ok`/`gagal`). Versi pertama
   * membedakan ketiganya, lalu tidak satu pun pemanggil memakai bedanya:
   * keduanya yang bukan `ok` berarti hal yang sama — angka di layar adalah nol
   * yang tidak diukur. Distinksi tanpa pemakai adalah slot yang akan diisi
   * kebutuhan karangan; pelajaran `--t-data` di skala teks final.
   *
   * `false` sampai pembacaan pertama berhasil, DAN kembali `false` bila
   * pembacaan berikutnya menolak — yang kedua itu keadaan nyata: OPFS yang
   * penuh di tengah shift membuat database yang sudah terbuka berhenti dapat
   * dibaca, dan angka terakhir yang berhasil berhenti menggambarkan apa pun.
   */
  antreanTerbaca: boolean;
  muatUlang: () => void;
} {
  const keadaan = useKeadaanLokal();
  const lokal = keadaan.lokal;
  const [ringkasan, setRingkasan] = useState<RingkasanAntrean>(RINGKASAN_KOSONG);
  const [antreanTerbaca, setAntreanTerbaca] = useState(false);
  const [pemicu, setPemicu] = useState(0);

  const muatUlang = useCallback(() => setPemicu((n) => n + 1), []);

  useEffect(() => {
    if (!lokal) return;
    const { db, ps, pemberitahu } = lokal;
    let hidup = true;

    const muat = () => {
      ringkasanAntrean(db).then(
        (r) => {
          if (!hidup) return;
          setRingkasan(r);
          setAntreanTerbaca(true);
        },
        () => {
          /* Kegagalan membaca ringkasan tidak menjatuhkan layar. Angka lama
             lebih baik daripada layar putih; yang TIDAK boleh adalah angka
             yang dikarang jadi nol -- itu berbunyi "semua sudah terkirim".

             ⛔ Kalimat di atas sudah ada di sini sejak 8 Agustus 2026, dan
             SELAMA ITU ia tidak berlaku. Cabang ini kosong, jadi state
             bertahan pada nilai awalnya -- `RINGKASAN_KOSONG`, yang PERSIS
             angka nol yang dilarangnya. Niat yang benar dibatalkan oleh nilai
             awal, tanpa satu pun error, dan yang membacanya adalah indikator
             topbar di SETIAP layar sepanjang shift.

             Angkanya tetap dipertahankan -- yang berubah hanya bahwa pemanggil
             kini diberi tahu angka itu tidak dapat dipercaya.

             ⛔ Baris ini dan nilai awal `false` SALING MENUTUPI pada fixture
             galeri, dan itu diukur: skenario `error` menolak SETIAP pembacaan,
             jadi `antreanTerbaca` tidak pernah menjadi `true` sekali pun.
             Melepas salah satunya -- baris ini, atau nilai awalnya -- membuat
             penjaga DOM tetap HIJAU; hanya melepas keduanya yang membuatnya
             merah. Keduanya karena itu tidak dapat dipisahkan oleh test yang
             ada.

             Yang membedakan keduanya adalah keadaan yang fixture tidak dapat
             hasilkan: pembacaan yang BERHASIL lalu menolak di kemudian hari --
             OPFS yang penuh di tengah shift. Di sana nilai awal tidak menolong
             apa pun, dan baris inilah satu-satunya yang mengembalikan
             indikator ke keadaan jujur. Fake galeri melempar untuk selamanya
             atau tidak sama sekali; memberinya mode "berhasil lalu gagal"
             mengubah arti skenario `error` bagi keempat layar lain. Batas yang
             dinyatakan, bukan lubang yang tidak diketahui. */
          if (hidup) setAntreanTerbaca(false);
        }
      );
    };

    muat();
    const lepas = pemberitahu.langgan(muat);
    const ac = new AbortController();
    ps.watch(
      'SELECT count(*) AS n FROM outbox_local',
      [],
      { onResult: muat },
      { signal: ac.signal, tables: ['outbox_local'] }
    );

    return () => {
      hidup = false;
      lepas();
      ac.abort();
    };
  }, [lokal, pemicu]);

  return { ringkasan, siap: keadaan.tahap === 'siap', antreanTerbaca, muatUlang };
}
