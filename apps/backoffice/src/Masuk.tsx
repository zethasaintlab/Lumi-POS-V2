import { useState } from 'react';
import type { FormEvent } from 'react';
import { Card } from 'ds';
import { Tombol } from './Tombol.tsx';
import { Bidang } from './Bidang.tsx';
import { useSesi } from '../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../packages/klien-api/src/http.ts';
import { bacaTenantTerakhir, ingatTenant } from './tenant-terakhir.ts';

/**
 * B-00 — Login back-office (`IA:§3.3`). Email + password, FR-F2b.
 *
 * ## Kenapa layar MANDIRI, di luar `AppShell`
 *
 * Sidebar back-office menampilkan seluruh peta layar merchant — nama outlet,
 * grup modul yang dipakainya. Menampilkannya sebelum ada sesi berarti
 * membocorkan bentuk aplikasi kepada siapa pun yang membuka alamatnya, dan
 * membuat layar login terlihat seperti satu layar di antara 29 lainnya alih-alih
 * pintu masuknya.
 *
 * ## Field "ID Tenant" — sekarang OPSIONAL
 *
 * `POST /auth/login` DULU menuntut header `X-Tenant-Id`, dan field ini tidak
 * dapat diisi siapa pun tanpa menyalinnya dari tempat lain — sementara
 * merchant yang baru mendaftar tidak punya tempat lain.
 *
 * Sejak migrasi 0023, server meresolusi tenant dari email lewat fungsi
 * `SECURITY DEFINER` yang sesempit mungkin. Field-nya tetap ada, karena satu
 * orang dapat bekerja di dua merchant: email yang terdaftar di dua tenant
 * TIDAK ditebak server (ia menolak), dan menyebutkannya di sini satu-satunya
 * jalan masuk. Ia disembunyikan di balik "Punya lebih dari satu usaha?" supaya
 * tidak menjadi pertanyaan pertama yang dilihat orang yang tidak punya
 * jawabannya.
 *
 * ⛔ Hanya id tenant yang diingat — bukan token, bukan email. Id tenant bukan
 * rahasia (ia dikirim di header setiap permintaan); token adalah.
 *
 * ## Pesan kegagalan
 *
 * Server menjawab SATU pesan untuk setiap sebab (`spec-f:148`: "pesan
 * kegagalan tidak membocorkan keberadaan pengguna"). Layar ini meneruskannya
 * apa adanya — memperkaya pesannya di klien akan membangun kembali oracle
 * enumerasi yang server berusaha tutup.
 */

interface Props {
  /** Beralih ke B-00b. */
  onDaftar: () => void;
  /** Ditampilkan sekali setelah pendaftaran berhasil. */
  kabar?: string | null;
}

export function Masuk({ onDaftar, kabar }: Props) {
  const { masuk } = useSesi();
  const [tenantId, setTenantId] = useState(bacaTenantTerakhir);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);
  // Terbuka sendiri bila ada nilai tersimpan — merchant yang PERNAH memakainya
  // hampir pasti membutuhkannya lagi.
  const [tampilTenant, setTampilTenant] = useState(() => bacaTenantTerakhir().length > 0);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    setGalat(null);
    setSedangKirim(true);
    try {
      await masuk({ tenantId: tenantId.trim(), email: email.trim(), password });
      // Yang diingat adalah isian merchant, dan `ingatTenant` mengabaikan
      // nilai kosong — login lewat resolusi email tidak menghapus id tenant
      // yang tersimpan dari pendaftaran.
      ingatTenant(tenantId);
    } catch (err) {
      // Pesan server dipakai apa adanya. Ia satu pesan untuk semua sebab, dan
      // itu disengaja (`spec-f:148`).
      setGalat(
        err instanceof GalatHttp
          ? err.message
          : 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.'
      );
    } finally {
      // ⛔ Di `finally`, bukan hanya di cabang sukses. Kalau tombolnya tetap
      // nonaktif setelah kegagalan, satu salah ketik password mengunci layar
      // dan satu-satunya jalan keluar adalah memuat ulang halaman.
      setSedangKirim(false);
    }
  }

  // ⛔ `tenantId` TIDAK ikut. Ia opsional sekarang, dan menuntutnya di sini
  // membuat seluruh perubahan di server sia-sia: tombolnya tetap mati untuk
  // merchant yang tidak menghafal UUID-nya.
  const siap = email.trim().length > 0 && password.length > 0;

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
      {/* `ch`, bukan px. Aturan design system #6 melarang nilai ukuran
          hardcoded, dan `lint:ds` menolaknya — `360px` ditandai. Satuan `ch`
          adalah idiom design system sendiri untuk lebar berbasis teks
          (`EmptyState.jsx` memakai `maxWidth: '32ch'`), dan ia ikut berskala
          bersama tipografi alih-alih melawannya. */}
      <div style={{ width: '100%', maxWidth: '32ch' }}>
        <Card>
          <div className="card-pad">
            <form className="stack" style={{ gap: 'var(--space-4)' }} onSubmit={kirim}>
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <div className="t-title">Masuk ke Back Office</div>
                <div className="t-caption">Lumi POS</div>
              </div>

              {kabar ? (
                // Status tidak pernah warna saja (aturan DS #5) — ini teks.
                <div className="t-caption" role="status">
                  {kabar}
                </div>
              ) : null}

              <Bidang
                id="email"
                label="Email"
                type="email"
                value={email}
                required
                autoComplete="username"
                onChange={setEmail}
              />

              <Bidang
                id="password"
                label="Password"
                type="password"
                value={password}
                required
                autoComplete="current-password"
                // ⛔ Error ditempel di field TERAKHIR, bukan di `email`.
                // Menaruhnya di email membuatnya terbaca sebagai "email ini
                // salah" — persis kesimpulan yang `spec-f:148` larang server
                // berikan.
                error={galat ?? undefined}
                onChange={setPassword}
              />

              {/* ⛔ Di BAWAH password, dan tertutup secara bawaan.
                  Merchant yang tidak punya jawabannya tidak boleh disodori
                  pertanyaan ini lebih dulu — itu justru keadaan yang membuat
                  layar ini tidak dapat dipakai sebelum migrasi 0023. */}
              {tampilTenant ? (
                <Bidang
                  id="tenant"
                  label="ID Tenant (hanya bila email Anda terdaftar di lebih dari satu usaha)"
                  value={tenantId}
                  autoComplete="off"
                  onChange={setTenantId}
                />
              ) : (
                <Tombol varian="ghost" onClick={() => setTampilTenant(true)}>
                  Punya lebih dari satu usaha?
                </Tombol>
              )}

              <Tombol varian="primary" tipe="submit" penuh disabled={!siap || sedangKirim}>
                {sedangKirim ? 'Memeriksa…' : 'Masuk'}
              </Tombol>
            </form>
          </div>
        </Card>

        <div
          className="stack"
          style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)', textAlign: 'center' }}
        >
          <span className="t-caption">Belum punya akun?</span>
          <Tombol onClick={onDaftar}>Daftarkan usaha baru</Tombol>
          <span className="t-caption">Kasir tidak masuk lewat sini. Aplikasi kasir memakai PIN.</span>
        </div>
      </div>
    </div>
  );
}
