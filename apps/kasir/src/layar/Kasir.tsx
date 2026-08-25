import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EmptyState } from 'ds';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import {
  bacaKatalog,
  bacaModifier,
  cariBarcode,
  cariItem,
  type DaftarModifier,
  type ItemKatalog,
  type VariationKatalog,
} from '../katalog/baca.ts';
import {
  hapusBaris,
  qtyDiKeranjang,
  satuanKeranjang,
  setelDiskon,
  subtotalKeranjang,
  tambah,
  ubahQty,
  type ModifierTerpilih,
} from '../kasir/keranjang.ts';
import { bacaAmbangDiskon, LABEL_ALASAN_DISKON, statusDiskon } from '../kasir/diskon.ts';
import {
  AMBANG_DISKON_BAWAAN,
  type AmbangDiskon,
} from '../../../../packages/domain/src/diskon.ts';
import { catat } from '../telemetri/sink.ts';
import { bacaStokBanyak } from '../inventori/stok.ts';
import { bacaProfilVertikal } from '../inventori/profil.ts';
import { bacaHabis } from '../inventori/sold-out.ts';
import { keputusanStok } from '../../../../packages/domain/src/profil-vertikal.ts';
import { keranjangSekarang, langgananKeranjang, setelKeranjang } from '../kasir/simpanan.ts';
import { pulihkanKeranjang, simpanKeranjang } from '../kasir/keranjang-simpan.ts';
import { shiftAktif, type ShiftAktif } from '../kas/shift.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { Pembayaran } from './Pembayaran.tsx';
import { navigasi } from '../rute/navigasi.ts';
import { BASIS } from '../rute/tabel.ts';
import { usePemindaiGlobal } from '../kasir/pemindai-global.ts';
import { DialogNoSale } from '../komponen/DialogNoSale.tsx';
import { DialogKasManual } from '../komponen/DialogKasManual.tsx';
import { DialogDiskon } from '../komponen/DialogDiskon.tsx';
import { bacaFitur, fiturAktif, type PetaFitur } from '../fitur/baca.ts';
import { DialogModifier } from '../komponen/DialogModifier.tsx';
import { useSesi } from '../konteks/useSesi.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* K-03 — layar kasir: grid produk + keranjang (IA §2.1, §2.2).

   "Layar utama; ≥12 kartu tanpa scroll" (`IA:62`).

   ⛔ Layar ini MENUNTUT shift terbuka. `IA:2.3` menempatkan K-02 sebelum
   K-03, dan alasannya di database: `order.shift_id` adalah NOT NULL, jadi
   penjualan tanpa shift tidak dapat disimpan sama sekali. Menampilkan grid
   yang tombol Bayar-nya pasti gagal adalah cara terburuk menyampaikan itu. */

export function Kasir() {
  const { db } = useDbLokal();
  const { sesi } = useSesi();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);
  const [shift, setShift] = useState<ShiftAktif | null>(null);
  const [katalog, setKatalog] = useState<ItemKatalog[]>([]);
  const [siap, setSiap] = useState(false);
  const [kueri, setKueri] = useState('');
  /* Keranjang hidup di modul, bukan di state komponen: K-06 adalah layar
     lain, dan router membongkar K-03 saat kasir menekan Bayar.
     `useSyncExternalStore` dipakai dengan alasan yang sama seperti untuk
     jalur URL — sumber kebenarannya di luar React, dan menyalinnya ke state
     berarti dua salinan yang harus dijaga sepakat. */
  const keranjang = useSyncExternalStore(langgananKeranjang, keranjangSekarang, keranjangSekarang);
  const setKeranjang = (f: (k: typeof keranjang) => typeof keranjang) => setelKeranjang(f(keranjang));
  const [pilihan, setPilihan] = useState<{ item: ItemKatalog; daftar: DaftarModifier[] } | null>(null);
  /* ⛔ K-06/K-07 adalah MODE, bukan rute. `IA:§7` tidak memberi keduanya URL,
     dan itu TETAP benar meski keranjang kini bertahan (KEP-21).

     Alasannya berubah, kesimpulannya tidak. Dulu: keranjang hilang saat muat
     ulang, jadi `/bayar` adalah alamat yang tidak pernah dapat dipulihkan.
     Sekarang: keranjangnya pulih, tetapi memulihkan kasir LANGSUNG ke layar
     pembayaran menempatkannya di depan angka yang harus ditagih tanpa ia
     sempat memeriksa pesanan yang baru saja dipulihkan — dan pemulihan itu
     justru yang menuntut diperiksa. K-03 adalah tempat pemeriksaan itu
     terjadi. Dijaga test yang mengikat TABEL_RUTE ke IA §7. */
  const [membayar, setMembayar] = useState(false);
  /* FR-E4 — stok dan aturannya. Keduanya dibaca sekali saat layar dibuka;
     penjualan berikutnya menulis movement sendiri, jadi angkanya diperbarui
     lewat pembacaan ulang setelah setiap penjualan, bukan lewat watch(). */
  const [stok, setStok] = useState<Map<string, number>>(new Map());
  const [bolehNegatif, setBolehNegatif] = useState(true);
  const [pesanStok, setPesanStok] = useState<string | null>(null);
  /* FR-E5 — penandaan habis MANUAL, terpisah dari stok terhitung. Produk
     dapat habis meski stoknya masih 10 (bahan habis, mesin rusak). */
  const [habis, setHabis] = useState<Set<string>>(new Set());
  /* K-16 — dialog, bukan rute (`IA:66`). */
  const [bukaLaci, setBukaLaci] = useState(false);
  const [pesanLaci, setPesanLaci] = useState<string | null>(null);
  /* FR-D5 — kas masuk/keluar. Dialog dengan alasan yang sama dengan K-16: ia
     tidak punya keadaan yang berguna untuk dipulihkan lewat URL. */
  const [dialogKas, setDialogKas] = useState(false);
  const [pesanKas, setPesanKas] = useState<string | null>(null);
  /* KEP-21 — keranjang yang bertahan melewati muat ulang.

     ⛔ Penulisan baru dimulai SETELAH pemulihan selesai. Efek yang menulis
     sejak render pertama akan menyimpan keranjang KOSONG lebih dulu — dan
     karena keranjang kosong menghapus barisnya, ia menghapus persis apa yang
     sedang dipulihkan. Urutannya yang menentukan, bukan keberadaan kodenya. */
  const bolehSimpan = useRef(false);
  const [dipulihkan, setDipulihkan] = useState(false);
  /* FR-B8 — diskon tingkat order. Ambangnya per outlet, dibaca dari perangkat
     supaya aturannya tetap berlaku offline; bawaan domain dipakai sampai
     baris outlet terbaca. */
  const [ambangDiskon, setAmbangDiskon] = useState<AmbangDiskon>(AMBANG_DISKON_BAWAAN);
  const [dialogDiskon, setDialogDiskon] = useState(false);
  /* `ARCH:358` — kill switch per fitur per merchant. Dibaca dari perangkat,
     jadi ia tetap berlaku offline; fitur yang belum pernah disegarkan
     mengikuti bawaan kode dan tetap menyala. */
  const [fitur, setFitur] = useState<PetaFitur>(() => ({}));

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const k = await bacaKonfigPerangkat(db);
      if (!hidup) return;
      setKonfig(k);
      const s = k ? await shiftAktif(db, k.deviceId) : null;
      if (!hidup) return;
      setShift(s);
      // Harga diresolusi pada SEKARANG di layar. Saat order ditulis, ia
      // diresolusi ulang pada `occurred_at` (FR-H6) — keduanya sama selama
      // kasir tidak menahan keranjang melewati jadwal perubahan harga.
      const daftar = await bacaKatalog(db, { outletId: k?.outletId ?? null, pada: new Date() });
      if (!hidup) return;
      setKatalog(daftar);
      setFitur(await bacaFitur(db));
      if (!hidup) return;

      if (k) {
        const ambang = await bacaAmbangDiskon(db, k.outletId);
        if (!hidup) return;
        setAmbangDiskon(ambang);
        const profil = await bacaProfilVertikal(db, { tenantId: k.tenantId, outletId: k.outletId });
        const ids = daftar.flatMap((i) => i.variations.map((v) => v.id));
        const peta = await bacaStokBanyak(db, { tenantId: k.tenantId, outletId: k.outletId }, ids);
        if (!hidup) return;
        setBolehNegatif(profil.allowNegativeStock);
        setStok(peta);
        setHabis(await bacaHabis(db, { tenantId: k.tenantId, outletId: k.outletId }));
      }
      /* KEP-21 — keranjang dipulihkan SEBELUM layar dinyatakan siap, dan
         sebelum penulisan diizinkan. Kasir yang sudah dapat menekan tombol
         sementara pemulihan masih berjalan akan melihat pesanannya muncul
         BELAKANGAN, di atas apa yang baru saja ia ketuk. */
      if (s) {
        const pulih = await pulihkanKeranjang(db, s.id);
        if (!hidup) return;
        if (pulih.status === 'dipulihkan') {
          setelKeranjang(pulih.keranjang);
          setDipulihkan(true);
        }
      }
      bolehSimpan.current = true;
      if (hidup) setSiap(true);
    })();
    return () => {
      hidup = false;
    };
  }, [db]);

  const terlihat = useMemo(() => cariItem(katalog, kueri), [katalog, kueri]);
  const subtotal = subtotalKeranjang(keranjang);
  /* ⛔ Dihitung ulang pada SETIAP render, terhadap subtotal sekarang — bukan
     dibekukan saat diskon dipasang. Keranjang yang bertambah setelah manajer
     menyetujui membuat potongannya tumbuh melewati angka yang ia lihat, dan
     kasir harus mengetahuinya di sini, bukan setelah menekan Bayar. */
  const diskon = statusDiskon(subtotal, keranjang.diskon, ambangDiskon);

  /* ⛔ Hook dipasang SEBELUM setiap `return` bersyarat di bawah — aturan hooks
     React. Penanganannya (`dipindai`) baru terdefinisi di bawah, jadi ia
     dipanggil lewat ref: memindahkan `dipindai` ke atas berarti memindahkan
     `pilihVariation` dan seluruh keputusan stok bersamanya. */
  /* KEP-21 — setiap perubahan keranjang ditulis ke perangkat.

     ⛔ Kegagalannya DITELAN, dan itu disengaja. Keranjang tersimpan adalah
     kenyamanan; disk penuh atau tabel yang belum bermigrasi tidak boleh
     menghentikan penjualan yang sedang berjalan. Aturan yang sama dengan
     `rekam()` di jalur telemetri (`ARCH:307`).

     ⛔ TIDAK di-debounce. Ketukan yang hilang karena perangkat mati 200 ms
     setelahnya adalah persis kasus yang fitur ini ada untuk menutupnya, dan
     satu UPSERT satu baris jauh di bawah ambang yang terlihat kasir. */
  useEffect(() => {
    if (!bolehSimpan.current || !shift) return;
    void simpanKeranjang(db, shift.id, keranjang, () => new Date()).catch(() => {});
  }, [db, shift, keranjang]);

  const pindai = useRef<(kode: string) => void>(() => {});
  /* Penanda awal pengukuran latensi keranjang. `null` = tidak ada ketukan
     yang sedang diukur; lihat `pilihVariation`. */
  const mulaiKetuk = useRef<number | null>(null);
  usePemindaiGlobal({
    onScan: (kode) => pindai.current(kode),
    /* Dimatikan saat dialog mana pun terbuka atau saat layar pembayaran
       aktif. Semuanya punya masukan sendiri, dan K-06 khususnya menerima
       angka yang diketik cepat lalu Enter — bentuk yang PERSIS sama dengan
       scan.

       ⛔ Dialog juga dihitung meski kolom teksnya sendiri sudah diabaikan
       (`usePemindaiGlobal`): fokus yang sedang berada di radio button TIDAK
       diabaikan, dan scan di sana menambahkan produk ke keranjang di
       BELAKANG dialog — perubahan yang tidak terlihat siapa pun sampai
       struk tercetak. */
    aktif: pilihan === null && !membayar && !dialogDiskon && !bukaLaci && !dialogKas,
  });

  if (!siap) return <EmptyState title="Menyiapkan kasir" body="Membaca katalog dari perangkat." />;

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
      <div className="kasir-shift">
        <h1 className="t-title">Shift belum dibuka</h1>
        <p className="t-body-md kasir-login-sub">
          Penjualan tidak dapat disimpan tanpa shift — setiap transaksi tercatat di dalamnya.
        </p>
        <Tombol varian="primary" kritis onClick={() => navigasi(`${BASIS}/shift/buka`)}>
          Buka Shift
        </Tombol>
      </div>
    );
  }

  /* Katalog kosong: keadaan yang HARUS punya layarnya sendiri (aturan design
     system #7). Perangkat baru menampilkan ini sampai katalog turun, dan
     tanpa teks ini kasir melihat grid kosong yang tidak dapat dibedakan dari
     aplikasi yang rusak. */
  if (katalog.length === 0) {
    return (
      <EmptyState
        title="Katalog belum ada di perangkat ini"
        body="Hubungkan ke internet sekali untuk mengunduh daftar produk."
      />
    );
  }

  const pilihVariation = (
    item: ItemKatalog,
    variation: VariationKatalog,
    modifier: ModifierTerpilih[]
  ) => {
    /* FR-E4. Yang diperiksa adalah kuantitas KUMULATIF variation ini di
       keranjang, bukan satu ketukan — modifier berbeda memisahkan baris,
       tapi stoknya satu. */
    /* FR-E5 — diperiksa SEBELUM stok terhitung, dan tidak pernah disimpulkan
       darinya. `spec-e:217`: produk yang ditandai habis "diblokir dengan
       pesan, TETAPI manajer dapat menimpanya". Penimpaan manajer belum ada
       jalurnya di layar ini; sampai ada, penandaan memblokir. */
    if (habis.has(variation.id)) {
      setPesanStok(`${item.nama} ditandai habis. Manajer dapat membuka kembali penandaannya.`);
      setPilihan(null);
      return;
    }

    const diminta = qtyDiKeranjang(keranjang, variation.id) + 1000;
    const k = keputusanStok({
      stokMilli: stok.get(variation.id) ?? 0,
      dimintaMilli: diminta,
      bolehNegatif,
      lacakStok: variation.lacakStok,
    });

    if (!k.boleh) {
      /* `spec-e:152` menuntut pembatasan disertai "pesan yang menjelaskan" —
         jadi angkanya ikut, bukan sekadar penolakan. */
      setPesanStok(
        `${item.nama} tersisa ${k.sisaMilli / 1000}. Tidak dapat menambah lagi.`
      );
      setPilihan(null);
      return;
    }

    /* ⛔ Peringatan TIDAK memblokir (`spec-e:146`: "penjualan TETAP dapat
       diselesaikan"). Melarang penjualan karena sistem mengira stok habis
       akan menghentikan penjualan nyata, dan kasir mencari jalan pintas —
       memindahkan masalah ke tempat yang tidak terlihat sistem. */
    setPesanStok(k.peringatan ? `Stok ${item.nama} tersisa ${k.sisaMilli / 1000}` : null);
    setKeranjang((c) => tambah(c, { item, variation, modifier, idBaris: () => crypto.randomUUID() }));
    setPilihan(null);

    /* `ARCH:300` — latensi p95 tambah item ke keranjang.

       ⛔ Diukur HANYA untuk jalur langsung. `mulaiKetuk` dikosongkan begitu
       dialog modifier terbuka, jadi waktu kasir MEMILIH tidak pernah ikut
       terhitung — angka yang memuat waktu berpikir orang mengukur menu, bukan
       aplikasi, dan ambang alarm di atasnya akan menyala untuk kasir yang
       sedang bertanya ke pelanggan. */
    if (mulaiKetuk.current !== null) {
      catat('latensi_keranjang_ms', performance.now() - mulaiKetuk.current);
      mulaiKetuk.current = null;
    }
  };

  /* K-17 — barcode dari scanner HID.

     ⛔ `cariBarcode`, BUKAN `cariItem`. Pencarian menyaring daftar untuk
     dilihat kasir; scan harus memutuskan SATU produk tanpa kasir melihat apa
     pun. Barcode yang tidak dikenal — atau yang cocok dua produk — jatuh ke
     kotak pencarian, jadi kasir melihat apa yang terjadi alih-alih menerima
     produk yang salah. */
  const dipindai = (kode: string) => {
    mulaiKetuk.current = performance.now();
    const cocok = cariBarcode(katalog, kode);
    if (cocok === null) {
      setKueri(kode);
      setPesanStok(`Barcode ${kode} tidak dikenali. Cari manual di daftar.`);
      return;
    }
    setPesanStok(null);
    /* Langsung ke `pilihVariation`, melewati dialog modifier: scan menunjuk
       VARIATION tertentu, dan barcode yang menunjuk varian sudah menjawab
       pertanyaan yang K-05 ajukan. Modifier tetap dapat ditambahkan dari
       keranjang. */
    pilihVariation(cocok.item, cocok.variation, []);
  };
  pindai.current = dipindai;

  const ketuk = async (item: ItemKatalog) => {
    mulaiKetuk.current = performance.now();
    const daftar = await bacaModifier(db, item.id);
    // K-04/K-05 muncul HANYA bila ada yang harus dipilih (`IA:63-64`).
    // Dialog yang selalu muncul menambah satu ketukan pada setiap penjualan.
    if (daftar.length === 0 && item.variations.length === 1) {
      pilihVariation(item, item.variations[0], []);
      return;
    }
    /* Dialog terbuka: pengukuran DIBATALKAN, bukan ditunda. Yang menyusul
       adalah waktu kasir memilih modifier — lihat `pilihVariation`. */
    mulaiKetuk.current = null;
    setPilihan({ item, daftar });
  };

  if (membayar) return <Pembayaran onKembali={() => setMembayar(false)} />;

  return (
    <div className="kasir-utama">
      <div className="kasir-grid-panel">
        <Bidang
          label="Cari produk"
          value={kueri}
          onChange={setKueri}
          placeholder="Nama produk atau barcode"
        />

        {terlihat.length === 0 ? (
          <EmptyState title="Tidak ada produk yang cocok" body={`Tidak ada hasil untuk "${kueri}".`} />
        ) : (
          <div className="kasir-grid">
            {terlihat.map((item) => (
              <button key={item.id} type="button" className="kasir-kartu" onClick={() => void ketuk(item)}>
                <span className="t-body-md">{item.nama}</span>
                <span className="t-caption num">
                  {item.variations.length > 1
                    ? `dari ${rupiah(Math.min(...item.variations.map((v) => v.harga)))}`
                    : rupiah(item.variations[0].harga)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="kasir-keranjang">
        <h2 className="t-body-md">Keranjang</h2>

        {/* FR-E4 — peringatan stok. Aturan design system #5: status TIDAK
            PERNAH warna saja, selalu ada teks; di sini teksnya memang
            seluruh pesannya, dan angkanya ikut karena `spec-e:152` menuntut
            pembatasan disertai penjelasan.

            Ia dapat ditutup: peringatan yang tidak dapat dihilangkan akan
            menetap di layar sepanjang shift dan berhenti dibaca. */}
        {pesanStok && (
          <p className="t-caption kasir-login-galat">
            {pesanStok}{' '}
            <span
              role="button"
              tabIndex={0}
              onClick={() => setPesanStok(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setPesanStok(null);
              }}
            >
              Tutup
            </span>
          </p>
        )}

        {/* ⛔ KEP-21 — pemulihan DISEBUTKAN, tidak pernah diam-diam.

            Keranjang yang muncul sendiri tanpa penjelasan terbaca seperti
            pesanan pelanggan yang sedang berdiri di depan kasir, dan kasir
            yang tidak tahu asalnya akan menjualnya kepada orang yang salah.
            Ia dapat ditutup: peringatan yang menetap sepanjang shift berhenti
            dibaca. */}
        {dipulihkan && keranjang.baris.length > 0 && (
          <p className="t-caption" role="status">
            Pesanan ini dipulihkan dari sebelum aplikasi dimuat ulang. Periksa sebelum menagih.{' '}
            <span
              role="button"
              tabIndex={0}
              onClick={() => setDipulihkan(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setDipulihkan(false);
              }}
            >
              Tutup
            </span>
          </p>
        )}

        {keranjang.baris.length === 0 ? (
          <p className="t-caption kasir-login-sub">Belum ada item. Ketuk produk untuk menambahkan.</p>
        ) : (
          <ul className="kasir-baris-daftar">
            {keranjang.baris.map((b) => (
              <li key={b.id} className="kasir-baris">
                <div className="grow">
                  <span className="t-body-md">
                    {b.itemName}
                    {b.variationName !== 'Regular' ? ` · ${b.variationName}` : ''}
                  </span>
                  {b.modifier.length > 0 && (
                    <span className="t-caption kasir-login-sub">
                      {' '}
                      {/* ⛔ `×2` ikut terlihat. Modifier ber-kuantitas yang
                          ditampilkan seperti modifier biasa membuat kasir
                          membaca "Extra Shot" pada baris yang menagih dua. */}
                      {b.modifier
                        .map((m) => (m.qtyMilli === 1000 ? m.nama : `${m.nama} ×${m.qtyMilli / 1000}`))
                        .join(', ')}
                    </span>
                  )}
                </div>
                <span className="t-caption num">{b.quantityMilli / 1000}×</span>
                {/* ⛔ `satuanKeranjang`, bukan penjumlahan kedua di sini.
                    Salinan yang ada sebelumnya mengabaikan kuantitas modifier,
                    jadi baris menagih satu shot sementara subtotal di bawahnya
                    menagih dua — dua angka di layar yang sama, tanpa error. */}
                <span className="t-body-md num">
                  {rupiah((satuanKeranjang(b) * BigInt(b.quantityMilli)) / 1000n)}
                </span>
                <Tombol
                  varian="ghost"
                  onClick={() => setKeranjang((k) => ubahQty(k, b.id, b.quantityMilli - 1000))}
                >
                  −
                </Tombol>
                <Tombol varian="ghost" onClick={() => setKeranjang((k) => hapusBaris(k, b.id))}>
                  Hapus
                </Tombol>
              </li>
            ))}
          </ul>
        )}

        <div className="kasir-subtotal">
          <span className="t-body-md">Subtotal</span>
          <span className="t-title num">{rupiah(subtotal)}</span>
        </div>

        {/* FR-B8 — baris diskon. Alasannya ikut ditampilkan: potongan tanpa
            alasan yang terlihat adalah potongan yang tidak dapat diperiksa
            siapa pun di layar, dan `spec-b:293` menjadikan alasan bagian dari
            diskon, bukan pelengkapnya. */}
        {keranjang.diskon !== null && diskon !== null && (
          <div className="kasir-subtotal">
            <span className="t-body-md">
              Diskon ·{' '}
              {LABEL_ALASAN_DISKON[
                keranjang.diskon.alasanKode as keyof typeof LABEL_ALASAN_DISKON
              ] ?? keranjang.diskon.alasanKode}
            </span>
            <span className="t-body-md num">− {rupiah(diskon.nominal)}</span>
          </div>
        )}

        {/* ⛔ Peringatan persetujuan-ulang. Aturan design system #5: status
            tidak pernah warna saja — teksnya menyebut angkanya, karena yang
            berubah justru angka itu. */}
        {diskon?.perluPersetujuan && (
          <p className="t-caption kasir-login-galat" role="alert">
            Potongan kini {rupiah(diskon.nominal)} — melewati batas dan belum disetujui manajer.
            Buka Diskon untuk meminta persetujuan.
          </p>
        )}

        {/* Satu aksi utama per layar (aturan #2), 56px karena menyangkut uang.
            Pajak dan pembulatan ditambahkan di K-06 — subtotal di atas
            sengaja TIDAK menyebut dirinya total. */}
        <Tombol
          varian="primary"
          kritis
          disabled={keranjang.baris.length === 0 || diskon?.perluPersetujuan === true}
          onClick={() => setMembayar(true)}
        >
          Bayar
        </Tombol>

        {/* ⛔ `ghost`: aksi utama K-03 tetap Bayar. Diskon adalah pengurangan
            uang merchant dan tidak boleh terlihat seperti langkah biasa dalam
            setiap penjualan. */}
        {/* ⛔ Tombolnya HILANG saat fitur dimatikan, bukan dinonaktifkan.
            Tombol mati yang tetap terlihat mengundang kasir menekannya
            berulang lalu menelepon merchant support; fitur yang dimatikan
            operator memang tidak ada untuk merchant itu. Yang menegakkannya
            tetap `statusDiskon` di jalur penulisan — layar tidak pernah jadi
            satu-satunya penjaga. */}
        {fiturAktif(fitur, 'diskon_kasir') && (
          <Tombol
            varian="ghost"
            disabled={keranjang.baris.length === 0 || sesi === null}
            onClick={() => setDialogDiskon(true)}
          >
            {keranjang.diskon === null ? 'Diskon' : 'Ubah diskon'}
          </Tombol>
        )}

        {/* K-16 — Buka laci (no-sale). `IA:102` menempatkannya di menu ⋮,
            tapi menu itu diturunkan dari `TABEL_RUTE` dan K-16 BUKAN rute
            (`IA:66`: "Dialog, bukan layar"). Ia diletakkan di sini karena
            layar ini yang memegang shift, konfig, dan sesi — dan karena
            "maksimal 2 tap dari K-03" (`IA:104`) terpenuhi dengan satu.

            ⛔ `ghost`, bukan `primary`: satu aksi utama per layar (aturan
            design system #2), dan aksi utama K-03 adalah Bayar. Membuka laci
            adalah pola fraud paling dasar (`spec-d:229`); ia tidak boleh
            terlihat seperti langkah biasa. */}
        {fiturAktif(fitur, 'buka_laci_no_sale') && (
          <Tombol varian="ghost" disabled={sesi === null} onClick={() => setBukaLaci(true)}>
            Buka laci
          </Tombol>
        )}

        {pesanLaci && (
          <p className="t-caption" role="status">
            {pesanLaci}
          </p>
        )}

        {/* FR-D5 — kas masuk/keluar. `ghost` dengan alasan yang sama dengan
            "Buka laci": satu aksi utama per layar, dan aksi utama K-03 adalah
            Bayar. Ia TIDAK di balik kill switch — kill switch tidak boleh
            menyentuh audit maupun menghentikan penjualan (`spec-f:369`), dan
            mematikan pencatatan kas berarti uang yang tetap keluar tanpa
            jejak, lalu muncul sebagai selisih yang menuduh kasirnya. */}
        <Tombol varian="ghost" disabled={sesi === null} onClick={() => setDialogKas(true)}>
          Kas masuk / keluar
        </Tombol>

        {pesanKas && (
          <p className="t-caption" role="status">
            {pesanKas}
          </p>
        )}
      </aside>

      {dialogKas && konfig && sesi && (
        <DialogKasManual
          shiftId={shift.id}
          konfig={konfig}
          sesi={sesi}
          onBatal={() => setDialogKas(false)}
          onSelesai={(h, arah) => {
            setDialogKas(false);
            /* ⛔ Kalimatnya menyebut ARAHNYA dan angkanya. `delta` bertanda,
               dan konfirmasi yang hanya menyebut angkanya membuat kasir yang
               salah memilih arah tidak punya cara mengetahuinya sampai tutup
               kas. */
            // ⛔ Nilai MUTLAK, dan arahnya dibawa KATANYA. Tandanya sudah
            // ada di kalimat ("masuk"/"keluar"); menampilkannya lagi sebagai
            // `− Rp 50.000` di kalimat "Kas keluar" membacakan arah yang sama
            // dua kali, dan yang membacanya cepat menyimpulkan dua arah.
            const nilai = rupiah(h.delta < 0n ? -h.delta : h.delta);
            setPesanKas(
              arah === 'masuk'
                ? `Kas masuk ${nilai} tercatat. Saldo laci bertambah.`
                : `Kas keluar ${nilai} tercatat. Saldo laci berkurang.`
            );
          }}
        />
      )}

      {bukaLaci && konfig && sesi && (
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

      {dialogDiskon && sesi && (
        <DialogDiskon
          subtotal={subtotal}
          ambang={ambangDiskon}
          aktorId={sesi.userId}
          awal={keranjang.diskon}
          onBatal={() => setDialogDiskon(false)}
          onSimpan={(d) => {
            setKeranjang((k) => setelDiskon(k, d));
            setDialogDiskon(false);
          }}
        />
      )}

      {pilihan && (
        <DialogModifier
          item={pilihan.item}
          daftar={pilihan.daftar}
          onBatal={() => setPilihan(null)}
          onPilih={pilihVariation}
        />
      )}
    </div>
  );
}
