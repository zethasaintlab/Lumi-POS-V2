import { useState } from 'react';
import type { FormEvent } from 'react';
import { Card } from 'ds';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { ingatTenant } from '../tenant-terakhir.ts';
import { buatMuatanPendaftaran, type FormPendaftaran } from './pendaftaran.ts';
import {
  ZONA_WAKTU,
  LABEL_ZONA,
  type ZonaWaktu,
} from '../../../../packages/domain/src/zona-waktu.ts';

/**
 * B-00b — Pendaftaran merchant mandiri.
 *
 * Gate `ARCH:399`: *"Merchant dapat mendaftar → impor → bertransaksi tanpa
 * bantuan."* Ini kaki pertamanya, dan ia **tidak punya kode layar di
 * `IA:§3.3`** — tabel itu memetakan layar back-office milik merchant yang
 * sudah ada. `IA:§9` menampilkan "☑ Buat akun" sebagai langkah yang sudah
 * selesai sebelum alurnya dimulai. Kodenya karena itu diberi nama B-00b:
 * saudara publik dari B-00, di sisi pintu yang sama.
 *
 * ## ⛔ Id dibuat SEKALI, bukan sekali per penekanan tombol
 *
 * `POST /tenants` idempoten hanya lewat PK `tenant.id` (`register.ts`): id
 * yang sama diulang menjawab 409, id BARU menghasilkan tenant KEDUA — yang
 * tidak dapat dihapus lewat API mana pun dan ikut terhitung di kuota.
 *
 * Merchant yang menekan "Daftar" dua kali karena responsnya lambat karena itu
 * harus mengirim id yang sama. Identitasnya dibuat di inisialisasi lazy
 * `useState` — sekali seumur layar ini — dan `pendaftaran.ts` menerimanya
 * alih-alih memanggil `randomUUID()` sendiri.
 *
 * ## ⛔ Password TIDAK diminta dua kali
 *
 * Tanpa pemulihan password (belum ada sama sekali), salah ketik berarti akun
 * yang tidak dapat dimasuki siapa pun. Yang dipakai bukan field kedua — ia
 * hanya menggandakan salah ketik yang sama — melainkan tombol perlihatkan,
 * supaya yang diketik dapat DIBACA sebelum dikirim.
 *
 * ## Batas yang dinyatakan
 *
 * Tanpa captcha dan tanpa verifikasi email. Rate limit in-memory ada di server
 * (`POST /tenants`, PR #13). Keduanya utang yang tercatat.
 */

interface Props {
  /** Kembali ke B-00 dengan kabar untuk ditampilkan sekali. */
  onSelesai: (kabar: string) => void;
  onBatal: () => void;
}

const KOSONG: FormPendaftaran = {
  namaMerchant: '',
  namaOutlet: '',
  zonaWaktu: 'Asia/Jakarta',
  namaOwner: '',
  email: '',
  password: '',
  alamat: '',
};

export function Daftar({ onSelesai, onBatal }: Props) {
  const { daftar: mintaDaftar } = useSesi();
  const [form, setForm] = useState<FormPendaftaran>(KOSONG);
  const [galat, setGalat] = useState<{ bidang: keyof FormPendaftaran; pesan: string } | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);
  const [lihatPassword, setLihatPassword] = useState(false);

  // ⛔ Inisialisasi LAZY, bukan `useState({...})`. Yang kedua memanggil
  // `randomUUID()` pada setiap render — dan meski hasilnya dibuang, kebiasaan
  // itu yang membuat seseorang kelak memindahkannya ke tempat yang benar-benar
  // dipakai. Yang di sini dibuat sekali seumur layar.
  const [identitas] = useState(() => ({
    tenantId: crypto.randomUUID(),
    outletId: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
  }));

  const ubah = (bidang: keyof FormPendaftaran) => (nilai: string) => {
    setForm((f) => ({ ...f, [bidang]: nilai }));
    // Error dibersihkan begitu fieldnya disunting — pesan yang bertahan
    // setelah diperbaiki terbaca sebagai "masih salah".
    setGalat((g) => (g?.bidang === bidang ? null : g));
  };

  async function kirim(e: FormEvent) {
    e.preventDefault();
    setGalat(null);

    const hasil = buatMuatanPendaftaran(form, identitas);
    if (!hasil.ok) {
      setGalat({ bidang: hasil.bidang, pesan: hasil.pesan });
      return;
    }

    setSedangKirim(true);
    try {
      const jawaban = await mintaDaftar(hasil.muatan);
      // Inilah yang membuat merchant tidak pernah perlu mengetik UUID: layar
      // masuk membacanya dari sini. Sejak migrasi 0023 ia bukan lagi syarat
      // masuk, tapi ia tetap satu-satunya jalan bila email yang sama kelak
      // terdaftar di tenant kedua.
      ingatTenant(jawaban.tenantId);
      onSelesai(`Usaha "${hasil.muatan.tenant.name}" terdaftar. Masuk dengan email dan password yang baru saja Anda buat.`);
    } catch (err) {
      if (err instanceof GalatHttp && err.kode === 'ID_ALREADY_EXISTS') {
        // ⛔ Ini yang terjadi saat respons percobaan PERTAMA hilang: idnya
        // sama, jadi servernya menolak — dan penolakan itu justru bukti bahwa
        // pendaftarannya BERHASIL. Menampilkan "gagal" di sini akan mengirim
        // merchant mendaftar ulang dan membuat tenant kedua.
        ingatTenant(identitas.tenantId);
        onSelesai('Pendaftaran ini sudah pernah berhasil. Silakan masuk dengan email dan password Anda.');
        return;
      }
      setGalat({
        bidang: 'password',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.',
      });
    } finally {
      // Di `finally`, bukan hanya di cabang sukses — kalau tidak, satu
      // kegagalan mengunci tombolnya dan satu-satunya jalan keluar adalah
      // memuat ulang halaman. Memuat ulang di sini lebih mahal daripada di
      // layar masuk: ia MENGGANTI identitas, dan percobaan berikutnya menjadi
      // tenant kedua.
      setSedangKirim(false);
    }
  }

  const pesanUntuk = (bidang: keyof FormPendaftaran) =>
    galat?.bidang === bidang ? galat.pesan : undefined;

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-4)',
        background: 'var(--surface-sunk)',
      }}
    >
      {/* `ch`, bukan px — aturan design system #6, sama seperti B-00. Lebih
          lebar dari layar masuk karena isiannya tujuh, bukan tiga. */}
      <div style={{ width: '100%', maxWidth: '46ch' }}>
        <Card>
          <div className="card-pad">
            <form className="stack" style={{ gap: 'var(--space-4)' }} onSubmit={kirim}>
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <div className="t-title">Daftarkan usaha Anda</div>
                <div className="t-caption">
                  Satu menit. Anda akan langsung punya satu outlet dan akun pemilik.
                </div>
              </div>

              <Bidang
                id="nama-merchant"
                label="Nama usaha"
                value={form.namaMerchant}
                required
                error={pesanUntuk('namaMerchant')}
                onChange={ubah('namaMerchant')}
              />

              <Bidang
                id="nama-outlet"
                label="Nama outlet pertama"
                value={form.namaOutlet}
                required
                error={pesanUntuk('namaOutlet')}
                onChange={ubah('namaOutlet')}
              />

              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">
                  Zona waktu outlet
                  <span style={{ color: 'var(--danger)' }}> *</span>
                </span>
                <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {ZONA_WAKTU.map((z) => (
                    <Tombol
                      key={z}
                      varian={form.zonaWaktu === z ? 'primary' : 'secondary'}
                      onClick={() => ubah('zonaWaktu')(z)}
                    >
                      {LABEL_ZONA[z as ZonaWaktu]}
                    </Tombol>
                  ))}
                </div>
                {/* ⛔ Bukan hiasan. Tanggal bisnis berakhir saat tutup shift
                    dan dihitung di zona outlet — zona yang salah menggeser
                    setiap laporan harian sejak hari pertama. */}
                <span className="t-caption">
                  Menentukan tanggal bisnis di laporan. Dapat diubah nanti di Pengaturan → Outlet.
                </span>
              </div>

              <Bidang
                id="alamat"
                label="Alamat outlet (opsional)"
                value={form.alamat ?? ''}
                onChange={ubah('alamat')}
              />

              <Bidang
                id="nama-owner"
                label="Nama Anda"
                value={form.namaOwner}
                required
                autoComplete="name"
                error={pesanUntuk('namaOwner')}
                onChange={ubah('namaOwner')}
              />

              <Bidang
                id="email"
                label="Email"
                type="email"
                value={form.email}
                required
                autoComplete="username"
                error={pesanUntuk('email')}
                onChange={ubah('email')}
              />

              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <Bidang
                  id="password"
                  label="Password"
                  type={lihatPassword ? 'text' : 'password'}
                  value={form.password}
                  required
                  autoComplete="new-password"
                  error={pesanUntuk('password')}
                  onChange={ubah('password')}
                />
                <div className="row between">
                  <span className="t-caption">Minimal 10 karakter.</span>
                  <Tombol varian="ghost" onClick={() => setLihatPassword((v) => !v)}>
                    {lihatPassword ? 'Sembunyikan' : 'Perlihatkan'}
                  </Tombol>
                </div>
                {/* Tanpa pemulihan password, salah ketik berarti akun yang
                    tidak dapat dimasuki siapa pun. Dinyatakan, bukan
                    didiamkan. */}
                <span className="t-caption">
                  Belum ada pemulihan password. Simpan password ini sekarang.
                </span>
              </div>

              <Tombol varian="primary" tipe="submit" penuh disabled={sedangKirim}>
                {sedangKirim ? 'Mendaftarkan…' : 'Daftar'}
              </Tombol>
            </form>
          </div>
        </Card>

        <div
          className="stack"
          style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)', textAlign: 'center' }}
        >
          <span className="t-caption">Sudah punya akun?</span>
          <Tombol onClick={onBatal}>Masuk</Tombol>
        </div>
      </div>
    </div>
  );
}
