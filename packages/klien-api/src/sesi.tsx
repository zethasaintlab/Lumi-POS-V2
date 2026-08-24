import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  bacaSesi,
  hapusSesi,
  simpanSesi,
  penyimpananBrowser,
  type Penyimpanan,
  type Sesi,
} from '../../../packages/klien-api/src/sesi-simpanan.ts';
import {
  buatKlien,
  masuk as mintaLogin,
  daftar as mintaDaftar,
  type HasilDaftar,
  type KlienApi,
} from '../../../packages/klien-api/src/http.ts';

/**
 * Glue React untuk sesi back-office. SENGAJA tipis — seluruh aturan
 * (kedaluwarsa, validasi bentuk, pemilihan penyimpanan) hidup di
 * `sesi-simpanan.ts`, yang dapat diuji di `node --test` tanpa DOM.
 *
 * ⛔ Batas keamanan lapisan ini dinyatakan di `sesi-simpanan.ts`, dan harus
 * dibaca sebelum menganggap autentikasi selesai: server belum memverifikasi
 * token sesi pada satu pun endpoint selain `POST /auth/logout`.
 */

interface NilaiSesi {
  sesi: Sesi | null;
  api: KlienApi;
  /**
   * Alamat server API.
   *
   * ⛔ Diekspos supaya layar yang perlu MENYEBUTKANNYA — B-28 memasukkannya
   * ke kode pemasangan perangkat — memakai nilai yang SAMA dengan yang
   * dipakai klien HTTP. Versi pertama B-28 memakai
   * `window.location.origin` sebagai cadangan, dan itu menghasilkan alamat
   * BACK-OFFICE (port 1422) alih-alih API (port 3000): perangkat kasir yang
   * dipasang dengan kode itu menembak Vite dev server, dan gejalanya muncul
   * di outlet sebagai sinkronisasi yang tidak pernah jalan.
   */
  baseUrl: string;
  /**
   * `tenantId` OPSIONAL sejak migrasi 0023 — server meresolusinya dari email
   * bila tidak disebut. Ia tetap diterima karena merchant yang emailnya
   * terdaftar di dua tenant harus dapat menyebut yang mana.
   */
  masuk: (kredensial: { tenantId?: string; email: string; password: string }) => Promise<void>;
  /**
   * `POST /tenants` (B-00b). Ada di sini meski ia TIDAK membuat sesi — supaya
   * ia memakai `baseUrl` dan `fetch` yang sama dengan seluruh aplikasi. Layar
   * yang memanggil `globalThis.fetch` sendiri adalah layar yang tidak dapat
   * diuji dan yang akan menembak alamat berbeda saat `VITE_API_URL` disetel.
   */
  daftar: (muatan: unknown) => Promise<HasilDaftar>;
  keluar: () => Promise<void>;
}

const KonteksSesi = createContext<NilaiSesi | null>(null);

export interface PropsPenyediaSesi {
  children: ReactNode;
  /** Seam test. Bawaannya `sessionStorage` dengan jatuh ke memori. */
  penyimpanan?: Penyimpanan;
  /** Seam test. Bawaannya `Date.now`. */
  sekarang?: () => number;
  /** Seam test. Bawaannya `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

export function PenyediaSesi({
  children,
  penyimpanan,
  sekarang = () => Date.now(),
  fetch: fetchDipakai = globalThis.fetch.bind(globalThis),
  baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
}: PropsPenyediaSesi) {
  // ⛔ Dibuat SEKALI lewat inisialisasi lazy `useState`, bukan di badan
  // komponen. `penyimpananBrowser()` menyentuh `window.sessionStorage` dan
  // menulis kunci uji — menjalankannya pada setiap render berarti menyentuh
  // penyimpanan setiap kali apa pun berubah.
  const [simpanan] = useState<Penyimpanan>(() => penyimpanan ?? penyimpananBrowser());

  // Sesi dibaca sekali saat boot. Kalau sudah kedaluwarsa, `bacaSesi`
  // membuangnya dan mengembalikan `null` — aplikasi langsung berada di layar
  // masuk alih-alih menampilkan shell yang setiap permintaannya gagal 401.
  const [sesi, setSesi] = useState<Sesi | null>(() =>
    bacaSesi({ penyimpanan: penyimpanan ?? penyimpananBrowser(), sekarang })
  );

  const buangSesi = useCallback(() => {
    hapusSesi({ penyimpanan: simpanan });
    setSesi(null);
  }, [simpanan]);

  // ⛔ `sesi` DIBACA lewat fungsi, bukan ditangkap sebagai nilai. Klien dibuat
  // sekali (dependensinya tidak berubah saat login), sementara sesi berganti.
  // Menangkapnya berarti permintaan pertama sesudah login memakai `null` yang
  // lama — dan gejalanya adalah 400 "Header X-Tenant-Id wajib diisi" tepat
  // setelah login berhasil.
  //
  // `useState` menyimpan referensi terbaru supaya `useMemo` tidak perlu
  // bergantung pada `sesi`.
  const [kotakSesi] = useState<{ nilai: Sesi | null }>(() => ({ nilai: sesi }));
  kotakSesi.nilai = sesi;

  const api = useMemo(
    () =>
      buatKlien({
        baseUrl,
        fetch: fetchDipakai,
        sesi: () => kotakSesi.nilai,
        onSesiHabis: buangSesi,
      }),
    [baseUrl, fetchDipakai, kotakSesi, buangSesi]
  );

  const masuk = useCallback(
    async (kredensial: { tenantId?: string; email: string; password: string }) => {
      const hasil = await mintaLogin({ baseUrl, fetch: fetchDipakai }, kredensial);
      // ⛔ `tenantId` dari RESPONS, bukan dari isian form.
      //
      // Versi pertama memakai `kredensial.tenantId`, dan itu benar selama
      // field-nya wajib. Sejak ia opsional, memakainya berarti sesi merchant
      // yang masuk lewat resolusi email menyimpan tenant KOSONG — login
      // berhasil, lalu setiap layar di dalamnya menjawab 400. Kegagalan yang
      // justru sulit dibaca karena pintunya terbuka.
      //
      // Server juga satu-satunya yang tahu tenant mana yang benar-benar
      // dipakai: ia yang meresolusinya.
      simpanSesi(hasil, { penyimpanan: simpanan });
      setSesi(hasil);
    },
    [baseUrl, fetchDipakai, simpanan]
  );

  const daftar = useCallback(
    (muatan: unknown) => mintaDaftar({ baseUrl, fetch: fetchDipakai }, muatan),
    [baseUrl, fetchDipakai]
  );

  const keluar = useCallback(async () => {
    try {
      await api.minta('/auth/logout', { metode: 'POST' });
    } catch {
      // ⛔ Kegagalan logout server TIDAK menahan logout klien. Sesi yang
      // sudah kedaluwarsa menjawab 401 di sini, dan menolak membersihkan
      // keadaan lokal karenanya akan mengunci pengguna di aplikasi yang tidak
      // dapat dipakainya maupun ditinggalkannya.
      //
      // Yang hilang: barisnya tertinggal di `user_session` sampai kedaluwarsa
      // sendiri. Ia sudah tidak dapat dipakai untuk apa pun selain logout.
    }
    buangSesi();
  }, [api, buangSesi]);

  const nilai = useMemo<NilaiSesi>(
    () => ({ sesi, api, baseUrl, masuk, daftar, keluar }),
    [sesi, api, baseUrl, masuk, daftar, keluar]
  );

  return <KonteksSesi.Provider value={nilai}>{children}</KonteksSesi.Provider>;
}

export function useSesi(): NilaiSesi {
  const nilai = useContext(KonteksSesi);
  if (!nilai) {
    // Fail-closed, dan keras. Komponen yang membaca sesi di luar penyedia
    // akan mendapat `null` dan menyimpulkan "belum masuk" — lalu memaksa
    // pengguna yang SUDAH masuk kembali ke layar login, berulang.
    throw new Error('useSesi dipanggil di luar <PenyediaSesi>.');
  }
  return nilai;
}
