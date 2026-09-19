import { useEffect, useState } from 'react';
import { Memuat } from '../komponen/Memuat.tsx';
import { PIN_LENGTH } from '../../../../packages/domain/src/pin.ts';
import { masuk, type HasilLogin } from '../identitas/login.ts';
import { buatPinHasherWasm } from '../identitas/pin-hasher-wasm.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { simpanSesi } from '../konteks/useSesi.ts';
import { Keypad } from '../komponen/Keypad.tsx';
import { navigasi } from '../rute/navigasi.ts';
import { BASIS } from '../rute/tabel.ts';

/* K-01 — Login PIN (IA §2.2).

   "Entry point; verifikasi hash lokal. TANPA opsi email/password — permukaan
   kasir hanya menerima PIN" (`IA:60`, `spec-f:150`).

   ⛔ Tidak ada daftar nama pengguna di layar ini, dan itu keputusan produk
   yang terbaca dari IA: kasir mengetik PIN saja. PIN-lah yang
   mengidentifikasi orangnya — yang hanya bekerja karena PIN unik per outlet
   (`spec-f:126`, ditegakkan server saat PIN diset).

   Menampilkan daftar nama akan mengubah PIN 6 digit dari "satu dari sejuta"
   menjadi "satu dari sejuta, untuk orang yang sudah kamu pilih" — dan
   memberi tahu siapa pun yang berdiri di depan mesin siapa saja yang bekerja
   di outlet ini. */

const hasher = buatPinHasherWasm();

export function Login() {
  const { db } = useDbLokal();
  const [pin, setPin] = useState('');
  const [hasil, setHasil] = useState<HasilLogin | null>(null);
  const [memeriksa, setMemeriksa] = useState(false);
  const [detikTersisa, setDetikTersisa] = useState(0);
  const [gagalTeknis, setGagalTeknis] = useState<string | null>(null);

  /* Hitung mundur penguncian (`spec-f:220` — "hitungan mundur ditampilkan").

     Tanpa angka yang bergerak, layar terkunci tidak dapat dibedakan dari
     aplikasi yang menggantung — dan kasir akan me-restart perangkat, yang
     justru keadaan yang `spec-f:226` pastikan tidak menolongnya. */
  useEffect(() => {
    if (detikTersisa <= 0) return;
    const t = setTimeout(() => setDetikTersisa((d) => d - 1), 1000);
    return () => clearTimeout(t);
  }, [detikTersisa]);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || memeriksa) return;

    /* Verifikasi berjalan otomatis pada digit keenam — tidak ada tombol
       "Masuk". Panjang PIN tetap, jadi tombol itu hanya menambah satu
       ketukan pada alur yang terjadi setiap awal shift.

       Argon2 di WASM memblokir thread utama ~36 ms per pengguna; dengan 20
       staf outlet itu hampir satu detik. `memeriksa` yang menahan keypad
       adalah satu-satunya yang mencegah kasir mengira mesinnya hang dan
       menekan tombol lagi. */
    setMemeriksa(true);
    void masuk({ db, hasher, waktu: () => new Date(), pin })
      .then(async (h) => {
        setHasil(h);
        if (h.status === 'terkunci') setDetikTersisa(h.detikTersisa);
        if (h.status === 'berhasil') {
          await simpanSesi(h.sesi);
          navigasi(`${BASIS}/shift/buka`);
          return;
        }
        setPin('');
      })
      .catch((e: Error) => {
        /* ⛔ Sampai 1 September 2026 tidak ada `catch` di sini sama sekali.
           Verifikasi yang MELEMPAR — database lokal yang tidak dapat dibaca,
           WASM Argon2 yang gagal dimuat — hanya menjalankan `finally`: keypad
           menyala kembali, `hasil` tetap `null`, dan layar tidak berubah
           SEDIKIT PUN. Kasir mengetik enam digit, tidak terjadi apa-apa,
           mengetik lagi, tidak terjadi apa-apa.

           Ini bentuk "gagal auth tanpa pesan" yang paling mahal: ia tidak
           dapat dibedakan dari PIN yang salah, jadi kasir menyalahkan
           ingatannya sendiri lalu memanggil manajer untuk PIN yang sebenarnya
           benar. */
        setPin('');
        setGagalTeknis(e.message);
      })
      .finally(() => setMemeriksa(false));
  }, [pin, db, memeriksa]);

  const terkunci = detikTersisa > 0;

  return (
    <div className="kasir-login">
      <h1 className="t-display">Masukkan PIN</h1>
      <p className="t-body-md kasir-login-sub">
        {terkunci
          ? `Terkunci. Coba lagi dalam ${detikTersisa} detik.`
          : 'Enam digit. Hubungi manajer bila lupa.'}
      </p>

      <Keypad nilai={pin} panjang={PIN_LENGTH} onUbah={setPin} nonaktif={terkunci || memeriksa} />

      {/* Aturan design system #5: status tidak pernah warna saja, selalu ada
          teks. Pesan gagalnya datang dari `login.ts` dan NETRAL — ia tidak
          menyebut apakah penggunanya ada (`spec-f:161`). */}
      {hasil && hasil.status !== 'berhasil' && !terkunci && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {hasil.pesan}
        </p>
      )}

      {/* ⛔ TERPISAH dari pesan `hasil`, dan kalimatnya berbeda dengan sengaja.
          "PIN salah" dan "aplikasi tidak dapat memeriksa PIN" menuntut tindakan
          yang berlawanan: yang pertama diulangi, yang kedua tidak akan pernah
          berhasil sebanyak apa pun ia diulang. Pesan `login.ts` NETRAL soal
          ada tidaknya pengguna (`spec-f:161`); yang ini tidak menyentuh itu
          sama sekali — ia tentang perangkatnya, bukan tentang siapa pun. */}
      {gagalTeknis && !terkunci && (
        <p className="t-body-md kasir-login-galat" role="alert">
          PIN tidak dapat diperiksa di perangkat ini. Muat ulang aplikasi; bila tetap gagal,
          hubungi dukungan. ({gagalTeknis})
        </p>
      )}

      {memeriksa && (
        <p className="t-caption kasir-login-sub" role="status">
          Memeriksa…
        </p>
      )}
    </div>
  );
}

/**
 * Layar yang menahan seluruh aplikasi sampai ada sesi.
 *
 * `IA:2.3` menempatkan K-01 sebagai entry point tanpa jalan memutar: setiap
 * layar lain menuntut kasir yang dikenal, karena setiap penulisan membawa
 * `created_by`.
 */
export function ButuhSesi({
  sesi,
  children,
}: {
  sesi: { userId: string } | null;
  children: React.ReactNode;
}) {
  if (!sesi) return <Login />;
  return <>{children}</>;
}

export function SesiBelumSiap() {
  return <Memuat judul="Menyiapkan sesi…" bentuk="blok" jumlah={2} />;
}
