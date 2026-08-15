import { useState } from 'react';
import type { FormEvent } from 'react';
import { Card } from 'ds';
import { Tombol } from './Tombol.tsx';
import { Bidang } from './Bidang.tsx';
import { useSesi } from './sesi.tsx';
import { GalatHttp } from './http.ts';

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
 * ## ⛔ Field "ID Tenant" — gap produk, bukan pilihan desain
 *
 * `POST /auth/login` MENUNTUT header `X-Tenant-Id`. Tenant karena itu harus
 * sudah diketahui SEBELUM login, bukan hasil darinya.
 *
 * Merchant tidak menghafal UUID tenant-nya, jadi field ini tidak dapat
 * bertahan sampai merchant berbayar pertama. Jalan keluarnya (subdomain per
 * tenant, atau pencarian by-email lintas tenant di server — yang menuntut
 * query di luar RLS dan karena itu bukan keputusan kecil) belum kamu putuskan.
 *
 * Yang dilakukan sekarang: field-nya ADA, diberi label jujur, dan nilainya
 * diingat di `localStorage` supaya ia hanya diketik sekali per perangkat.
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

const KUNCI_TENANT_TERAKHIR = 'lumi.backoffice.tenant-terakhir';

function bacaTenantTerakhir(): string {
  try {
    return window.localStorage.getItem(KUNCI_TENANT_TERAKHIR) ?? '';
  } catch {
    return '';
  }
}

function ingatTenant(id: string): void {
  try {
    window.localStorage.setItem(KUNCI_TENANT_TERAKHIR, id);
  } catch {
    // Private mode. Merchant mengetiknya lagi lain kali — tidak fatal.
  }
}

export function Masuk() {
  const { masuk } = useSesi();
  const [tenantId, setTenantId] = useState(bacaTenantTerakhir);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    setGalat(null);
    setSedangKirim(true);
    try {
      await masuk({ tenantId: tenantId.trim(), email: email.trim(), password });
      ingatTenant(tenantId.trim());
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

  const siap = tenantId.trim().length > 0 && email.trim().length > 0 && password.length > 0;

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

              <Bidang
                id="tenant"
                label="ID Tenant"
                value={tenantId}
                required
                autoComplete="off"
                onChange={setTenantId}
              />

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

              <Tombol varian="primary" tipe="submit" penuh disabled={!siap || sedangKirim}>
                {sedangKirim ? 'Memeriksa…' : 'Masuk'}
              </Tombol>
            </form>
          </div>
        </Card>

        <div className="t-caption" style={{ marginTop: 'var(--space-3)', textAlign: 'center' }}>
          Kasir tidak masuk lewat sini. Aplikasi kasir memakai PIN.
        </div>
      </div>
    </div>
  );
}
