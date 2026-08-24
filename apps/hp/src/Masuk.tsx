import { useState } from 'react';
import type { FormEvent } from 'react';
import { Card } from 'ds';
import { Tombol } from './Tombol.tsx';
import { Bidang } from './Bidang.tsx';
import { useSesi } from '../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../packages/klien-api/src/http.ts';

/**
 * M-00 — Login Owner mobile (`IA:245`).
 *
 * ## ⛔ Kredensialnya SAMA dengan back-office, dan itu tertulis di IA
 *
 * `IA:245`: *"Entry point; kredensial sama dengan back-office."* Ia memakai
 * `POST /auth/login` yang sama lewat `packages/klien-api` yang sama — bukan
 * salinan. Dua klien sesi yang menyimpang menghasilkan aplikasi yang berhenti
 * dari sesi yang masih hidup, atau lebih buruk, tetap menampilkan layar dengan
 * sesi yang sudah mati.
 *
 * ## Yang TIDAK ada di sini, dan alasannya
 *
 * - **Tanpa pendaftaran.** `POST /tenants` (B-00b) mendaftarkan usaha baru,
 *   dan orang yang mendaftarkan usaha melakukannya di laptop dengan katalog di
 *   depannya. Menyediakannya di HP berarti alur yang tidak pernah selesai di
 *   sini.
 * - **Tanpa field "ID Tenant".** Owner yang punya dua usaha adalah kasus yang
 *   nyata, tapi ia dapat menyebutnya di back-office; di layar 390px, field
 *   yang tidak dapat diisi siapa pun tanpa menyalin dari tempat lain adalah
 *   pertanyaan pertama yang dilihat orang yang tidak punya jawabannya. Server
 *   meresolusi tenant dari email sejak migrasi 0023. **Batas yang dinyatakan:**
 *   email yang terdaftar di dua tenant TIDAK dapat masuk lewat HP.
 *
 * Pesan kegagalan diteruskan apa adanya — server menjawab SATU pesan untuk
 * setiap sebab (`spec-f:148`), dan memperkayanya di klien membangun kembali
 * oracle enumerasi yang server berusaha tutup.
 */
export function Masuk() {
  const { masuk } = useSesi();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    setGalat(null);
    setSedangKirim(true);
    try {
      await masuk({ email: email.trim(), password });
    } catch (err) {
      setGalat(
        err instanceof GalatHttp
          ? err.message
          : 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.'
      );
    } finally {
      // ⛔ Di `finally`. Tombol yang tetap mati setelah satu salah ketik
      // mengunci layar, dan satu-satunya jalan keluar adalah memuat ulang.
      setSedangKirim(false);
    }
  }

  const siap = email.trim().length > 0 && password.length > 0;

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-4)',
        background: 'var(--surface-sunk)',
      }}
    >
      {/* `ch`, bukan px — aturan design system #6 melarang nilai ukuran
          hardcoded, dan `ch` adalah idiom design system sendiri untuk lebar
          berbasis teks. */}
      <div style={{ width: '100%', maxWidth: '32ch' }}>
        <Card>
          <div className="card-pad">
            <form className="stack" style={{ gap: 'var(--space-4)' }} onSubmit={kirim}>
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <div className="t-title">Masuk</div>
                <div className="t-caption">Lumi POS — Owner</div>
              </div>

              <Bidang
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                required
                autoComplete="username"
              />
              <Bidang
                id="password"
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                required
                autoComplete="current-password"
                error={galat ?? undefined}
              />

              <Tombol varian="primary" tipe="submit" penuh disabled={!siap || sedangKirim}>
                {sedangKirim ? 'Memeriksa…' : 'Masuk'}
              </Tombol>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
