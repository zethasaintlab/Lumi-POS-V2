import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Avatar, Icon } from 'ds';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { navigasi } from '../rute/navigasi.ts';
import { kunciNavSekarang, langgananKunciNav } from '../rute/kunci-nav.ts';
import { keluar } from '../konteks/useSesi.ts';

/**
 * Tombol pengguna di header satu baris (spec § 3): avatar 28, nama 15/600,
 * baris kedua 13 px `outlet · device`, chevron. Menu: Status sinkronisasi
 * (`/sync`), Perangkat & uji cetak (`/perangkat`), Keluar.
 *
 * ⛔ Popover ditulis TANGAN, bukan komponen bundle — `/ds-bundle` tidak
 * punya Menu/Dropdown (diperiksa: `ds-bundle/components/`). `Modal` ada
 * tetapi ini bukan dialog: menu pengguna tidak mengambil fokus layar dan
 * tidak butuh latar gelap.
 *
 * ⛔ `db` diterima sebagai PROP dari `ShellKasir`, bukan dibaca lewat
 * `useDbLokal()` di sini. `useDbLokal()` MELEMPAR saat database belum siap,
 * dan shell harus tetap dapat dirender di keadaan itu (`App.tsx`: "Topbar
 * dan menu tetap ada, kalau tidak kasir terjebak di satu layar galat tanpa
 * jalan ke mana pun"). `db === null` karena itu adalah keadaan SAH, bukan
 * kelalaian.
 *
 * ⛔ Tombol Keluar TIDAK dinonaktifkan saat `db === null` — perbaikan tinjauan
 * (fix round 1), komentar sebelumnya mengklaim perilaku yang kodenya tidak
 * punya. `lakukanKeluar()` mengirim `db ?? undefined`, dan `keluar()`
 * (`konteks/useSesi.ts`) jatuh ke `lokalSekarang()` saat argumennya
 * `undefined` — promise modul yang SAMA yang sedang dibuka `DbLokalProvider`.
 * Menonaktifkan tombolnya tidak menambah apa pun terhadap FR-H4: baik
 * ditekan sekarang maupun sesudah database siap, pemeriksaan antrean baru
 * berjalan SETELAH database benar-benar terbuka — kasir hanya menunggu lebih
 * lama (`sibuk` tetap `true` selama itu), bukan melewati pemeriksaannya.
 */
export function MenuPengguna({
  pengguna,
  outlet,
  device,
  db,
}: {
  pengguna: string;
  outlet: string;
  device: string;
  db: DbLokal | null;
}) {
  const [terbuka, setTerbuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  /* Task 3, [EKSPLORASI]: galeri tidak menavigasi layar berdasarkan sesi
     (`Galeri.tsx` selalu merender `layarId` yang dipilih, terlepas dari
     `useSesi()`), dan header di sini menerima `pengguna`/`outlet`/`device`
     sebagai PROPS statis, bukan turunan `useSesi()` — mengubah keduanya di
     luar Task 3 ini. Penanda ini adalah bentuk PALING MINIMAL yang
     membuktikan `keluar()` sungguh dipanggil dan sungguh berhasil, tanpa
     menuntut Galeri.tsx berpindah layar: dicatat di laporan task. */
  const [keluarSelesai, setKeluarSelesai] = useState(false);
  const idMenu = useId();
  const bungkus = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!terbuka) return;
    const tutupDiLuar = (e: MouseEvent) => {
      if (bungkus.current && !bungkus.current.contains(e.target as Node)) setTerbuka(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTerbuka(false);
    };
    document.addEventListener('mousedown', tutupDiLuar);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', tutupDiLuar);
      document.removeEventListener('keydown', escape);
    };
  }, [terbuka]);

  const kunci = useSyncExternalStore(langgananKunciNav, kunciNavSekarang, kunciNavSekarang);
  const gayaKunci = kunci !== null ? ({ 'aria-disabled': true, 'aria-describedby': 'kunci-nav-alasan' } as const) : {};

  const tuju = (jalur: string) => {
    setTerbuka(false);
    navigasi(jalur);
  };

  const lakukanKeluar = () => {
    // Keluar mengakhiri sesi: tidak boleh di tengah QRIS menunggu/menyimpan.
    if (kunciNavSekarang() !== null) return;
    setSibuk(true);
    setPesan(null);
    void keluar(db ?? undefined)
      .then((hasil) => {
        setSibuk(false);
        if (!hasil.berhasil) {
          // FR-H4 — pesan penolakan ditampilkan APA ADANYA (spec § 3), sesi
          // TETAP dan menu TETAP terbuka supaya kasir membacanya.
          setPesan(hasil.pesan);
          return;
        }
        setTerbuka(false);
        setKeluarSelesai(true);
      })
      .catch((e: Error) => {
        setSibuk(false);
        setPesan(e.message);
      });
  };

  if (keluarSelesai) {
    return (
      <div className="kasir-menu-pengguna" data-keluar="selesai">
        <span className="t-caption">Sesi berakhir</span>
      </div>
    );
  }

  return (
    <div className="kasir-menu-pengguna" ref={bungkus}>
      <button
        type="button"
        className="kasir-menu-pengguna-tombol"
        aria-haspopup="menu"
        aria-expanded={terbuka}
        aria-controls={idMenu}
        onClick={() => setTerbuka((t) => !t)}
      >
        {/* ⛔ 32px, BUKAN 28px mockup (spec § 3) — DITOLAK, dicatat di laporan
            task. `<Avatar>` bundle mengetik `fontSize: Math.round(size *
            0.4)` (`Avatar.jsx`): 28 → 11px, bukan salah satu dari EMPAT
            ukuran final (32/20/15/13) — `tests/kasir-dom/skala-teks.test.js`
            (G-LH) menolaknya, dan skala teks adalah invariant yang wajib
            hijau TANPA disunting (§ 11 spec kampanye). 32px sudah dipakai
            `.kasir-staf` lama (topbar) dan menghasilkan 13px — genap token
            `--text-small`. Diukur, bukan disimpulkan. */}
        <Avatar name={pengguna} size={32} />
        <span className="kasir-menu-pengguna-teks">
          <span className="t-body-md truncate">{pengguna}</span>
          {/* Kode perangkat = prefiks struk: span sendiri yang tidak menyusut, NAMA OUTLET yang terpotong. */}
          <span className="t-caption kasir-menu-pengguna-lokasi">
            <span className="truncate">{outlet}</span>
            <span className="kasir-menu-pengguna-device"> · {device}</span>
          </span>
        </span>
        <Icon name="chevron-down" size={18} />
      </button>

      {terbuka && (
        <div
          id={idMenu}
          role="menu"
          aria-label="Menu pengguna"
          className="kasir-menu-pengguna-daftar card"
        >
          <button type="button" role="menuitem" className="kasir-menu-item" {...gayaKunci} onClick={() => tuju('/sync')}>
            Status sinkronisasi
          </button>
          <button
            type="button"
            role="menuitem"
            className="kasir-menu-item"
            {...gayaKunci}
            onClick={() => tuju('/perangkat')}
          >
            Perangkat &amp; uji cetak
          </button>
          <button
            type="button"
            role="menuitem"
            className="kasir-menu-item"
            disabled={sibuk}
            {...gayaKunci}
            onClick={lakukanKeluar}
          >
            {sibuk ? 'Memeriksa…' : 'Keluar'}
          </button>
          {pesan && (
            <p className="t-caption kasir-login-galat" role="alert">
              {pesan}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
