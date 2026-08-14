import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { EmptyState } from 'ds';
import { bacaKonfigPerangkat, type KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import {
  bacaKatalog,
  bacaModifier,
  cariItem,
  type DaftarModifier,
  type ItemKatalog,
  type ModifierPilihan,
  type VariationKatalog,
} from '../katalog/baca.ts';
import { hapusBaris, qtyDiKeranjang, subtotalKeranjang, tambah, ubahQty } from '../kasir/keranjang.ts';
import { bacaStokBanyak } from '../inventori/stok.ts';
import { bacaProfilVertikal } from '../inventori/profil.ts';
import { keputusanStok } from '../../../../packages/domain/src/profil-vertikal.ts';
import { keranjangSekarang, langgananKeranjang, setelKeranjang } from '../kasir/simpanan.ts';
import { shiftAktif, type ShiftAktif } from '../kas/shift.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { Pembayaran } from './Pembayaran.tsx';
import { navigasi } from '../rute/navigasi.ts';
import { BASIS } from '../rute/tabel.ts';

/* K-03 — layar kasir: grid produk + keranjang (IA §2.1, §2.2).

   "Layar utama; ≥12 kartu tanpa scroll" (`IA:62`).

   ⛔ Layar ini MENUNTUT shift terbuka. `IA:2.3` menempatkan K-02 sebelum
   K-03, dan alasannya di database: `order.shift_id` adalah NOT NULL, jadi
   penjualan tanpa shift tidak dapat disimpan sama sekali. Menampilkan grid
   yang tombol Bayar-nya pasti gagal adalah cara terburuk menyampaikan itu. */

function rupiah(n: number | bigint): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

export function Kasir() {
  const { db } = useDbLokal();
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
     dan itu bukan kelalaian dokumen: keranjang hanya hidup di memori
     (`kasir/simpanan.ts`), jadi `/bayar` akan menjadi alamat yang TIDAK
     PERNAH dapat dipulihkan — memuat ulang di sana menampilkan layar
     pembayaran untuk keranjang yang sudah hilang. Ditemukan oleh test yang
     mengikat TABEL_RUTE ke IA §7, setelah saya sempat menambahkan rutenya. */
  const [membayar, setMembayar] = useState(false);
  /* FR-E4 — stok dan aturannya. Keduanya dibaca sekali saat layar dibuka;
     penjualan berikutnya menulis movement sendiri, jadi angkanya diperbarui
     lewat pembacaan ulang setelah setiap penjualan, bukan lewat watch(). */
  const [stok, setStok] = useState<Map<string, number>>(new Map());
  const [bolehNegatif, setBolehNegatif] = useState(true);
  const [pesanStok, setPesanStok] = useState<string | null>(null);

  useEffect(() => {
    let hidup = true;
    void (async () => {
      const k = await bacaKonfigPerangkat(db);
      if (!hidup) return;
      setKonfig(k);
      if (k) setShift(await shiftAktif(db, k.deviceId));
      // Harga diresolusi pada SEKARANG di layar. Saat order ditulis, ia
      // diresolusi ulang pada `occurred_at` (FR-H6) — keduanya sama selama
      // kasir tidak menahan keranjang melewati jadwal perubahan harga.
      const daftar = await bacaKatalog(db, { outletId: k?.outletId ?? null, pada: new Date() });
      if (!hidup) return;
      setKatalog(daftar);

      if (k) {
        const profil = await bacaProfilVertikal(db, { tenantId: k.tenantId, outletId: k.outletId });
        const ids = daftar.flatMap((i) => i.variations.map((v) => v.id));
        const peta = await bacaStokBanyak(db, { tenantId: k.tenantId, outletId: k.outletId }, ids);
        if (!hidup) return;
        setBolehNegatif(profil.allowNegativeStock);
        setStok(peta);
      }
      if (hidup) setSiap(true);
    })();
    return () => {
      hidup = false;
    };
  }, [db]);

  const terlihat = useMemo(() => cariItem(katalog, kueri), [katalog, kueri]);
  const subtotal = subtotalKeranjang(keranjang);

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

  const pilihVariation = (item: ItemKatalog, variation: VariationKatalog, modifier: ModifierPilihan[]) => {
    /* FR-E4. Yang diperiksa adalah kuantitas KUMULATIF variation ini di
       keranjang, bukan satu ketukan — modifier berbeda memisahkan baris,
       tapi stoknya satu. */
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
  };

  const ketuk = async (item: ItemKatalog) => {
    const daftar = await bacaModifier(db, item.id);
    // K-04/K-05 muncul HANYA bila ada yang harus dipilih (`IA:63-64`).
    // Dialog yang selalu muncul menambah satu ketukan pada setiap penjualan.
    if (daftar.length === 0 && item.variations.length === 1) {
      pilihVariation(item, item.variations[0], []);
      return;
    }
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
                    <span className="t-caption kasir-login-sub"> {b.modifier.map((m) => m.nama).join(', ')}</span>
                  )}
                </div>
                <span className="t-caption num">{b.quantityMilli / 1000}×</span>
                <span className="t-body-md num">
                  {rupiah(
                    ((BigInt(b.unitPrice) + b.modifier.reduce((s, m) => s + BigInt(m.harga), 0n)) *
                      BigInt(b.quantityMilli)) /
                      1000n
                  )}
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

        {/* Satu aksi utama per layar (aturan #2), 56px karena menyangkut uang.
            Pajak dan pembulatan ditambahkan di K-06 — subtotal di atas
            sengaja TIDAK menyebut dirinya total. */}
        <Tombol
          varian="primary"
          kritis
          disabled={keranjang.baris.length === 0}
          onClick={() => setMembayar(true)}
        >
          Bayar
        </Tombol>
      </aside>

      {pilihan && (
        <PilihModifier
          item={pilihan.item}
          daftar={pilihan.daftar}
          onBatal={() => setPilihan(null)}
          onPilih={pilihVariation}
        />
      )}
    </div>
  );
}

/* K-04 (modifier) dan K-05 (variation) dalam SATU dialog.

   IA memisahkannya jadi dua layar, dan itu benar sebagai inventaris. Tapi
   keduanya menjawab pertanyaan yang sama pada momen yang sama — "produk ini,
   yang mana persisnya?" — dan dua dialog berurutan menambah satu ketukan
   pada setiap penjualan yang punya keduanya. Digabung, bukan dihilangkan:
   masing-masing tetap punya bagiannya sendiri di layar. */
function PilihModifier({
  item,
  daftar,
  onBatal,
  onPilih,
}: {
  item: ItemKatalog;
  daftar: DaftarModifier[];
  onBatal: () => void;
  onPilih: (item: ItemKatalog, variation: VariationKatalog, modifier: ModifierPilihan[]) => void;
}) {
  /* ⛔ Yang TERMURAH dipilih lebih dulu, bukan yang pertama di katalog.
     Ditemukan dengan menjalankan aplikasi: kartu grid mengiklankan
     "dari Rp 15.000" (harga terendah), lalu dialog memilih Large Rp 25.000
     karena `sort_order` keduanya sama dan "Large" menang secara alfabet.
     Kasir yang menekan Tambahkan tanpa membaca akan MENAGIH LEBIH — dan
     angka yang salah itu sudah masuk struk sebelum ada yang sadar.
     Preseleksi termurah membuat kedua angka sepakat, dan menyalahkannya
     hanya bisa ke arah yang tidak merugikan pelanggan. */
  const [variation, setVariation] = useState(
    item.variations.reduce((a, b) => (b.harga < a.harga ? b : a))
  );
  const [terpilih, setTerpilih] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      daftar.map((d) => [d.id, d.modifier.filter((m) => m.bawaan).map((m) => m.id)])
    )
  );

  const togglePilihan = (d: DaftarModifier, modifierId: string) => {
    setTerpilih((t) => {
      const kini = t[d.id] ?? [];
      if (d.tipe === 'single') return { ...t, [d.id]: [modifierId] };
      return {
        ...t,
        [d.id]: kini.includes(modifierId)
          ? kini.filter((x) => x !== modifierId)
          : [...kini, modifierId],
      };
    });
  };

  /* FR-A3/A5 (aturan pemilihan modifier) belum digarap — `CLAUDE.md`
     menandainya "sengaja belum digarap". Yang ditegakkan di sini hanya
     `is_required` + `min_selections`, karena tanpanya dialog dapat ditutup
     dengan pesanan yang barista tidak bisa buat. Sisanya (max, duplikat)
     menunggu FR-A3/A5 dan TIDAK dikarang di sini. */
  const kurang = daftar.filter(
    (d) => (d.wajib || d.minPilih > 0) && (terpilih[d.id]?.length ?? 0) < Math.max(d.minPilih, d.wajib ? 1 : 0)
  );

  const semuaModifier = daftar.flatMap((d) =>
    d.modifier.filter((m) => (terpilih[d.id] ?? []).includes(m.id))
  );

  return (
    <div className="kasir-dialog-latar" role="dialog" aria-modal="true" aria-label={item.nama}>
      <div className="kasir-dialog">
        <h2 className="t-title">{item.nama}</h2>

        {item.variations.length > 1 && (
          <fieldset className="kasir-alasan">
            <legend className="t-body-md">Ukuran</legend>
            {item.variations.map((v) => (
              <label key={v.id} className="kasir-alasan-opsi t-body-md">
                <input
                  type="radio"
                  name="variation"
                  checked={variation.id === v.id}
                  onChange={() => setVariation(v)}
                />
                {v.nama} · <span className="num">{rupiah(v.harga)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {daftar.map((d) => (
          <fieldset key={d.id} className="kasir-alasan">
            <legend className="t-body-md">
              {d.nama}
              {d.wajib ? ' · wajib' : ''}
            </legend>
            {d.modifier.map((m) => (
              <label key={m.id} className="kasir-alasan-opsi t-body-md">
                <input
                  type={d.tipe === 'single' ? 'radio' : 'checkbox'}
                  name={d.id}
                  checked={(terpilih[d.id] ?? []).includes(m.id)}
                  onChange={() => togglePilihan(d, m.id)}
                />
                {m.nama}
                {m.harga !== 0 && <span className="num"> · +{rupiah(m.harga)}</span>}
              </label>
            ))}
          </fieldset>
        ))}

        {kurang.length > 0 && (
          <p className="t-body-md kasir-login-galat" role="alert">
            Pilih dulu: {kurang.map((d) => d.nama).join(', ')}.
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol
            varian="primary"
            kritis
            disabled={kurang.length > 0}
            onClick={() => onPilih(item, variation, semuaModifier)}
          >
            Tambahkan
          </Tombol>
        </div>
      </div>
    </div>
  );
}
