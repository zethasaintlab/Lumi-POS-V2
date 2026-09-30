import {
  bolehTambah,
  kosongkanPilihan,
  kurangPilihan,
  kurangnya,
  pesanKurang,
  QTY_MODIFIER,
  tambahPilihan,
  togglePilihan,
  type AturanModifier,
  type PilihanModifier,
} from '../../../../packages/domain/src/modifier-pilihan.ts';
import type { DaftarModifier } from '../katalog/baca.ts';
import type { ModifierTerpilih } from '../kasir/keranjang.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* Pemilih modifier (K-04) — diekstrak dari `DialogModifier.tsx` (Task 6) dan
   dipakai DUA layar: dialog tambah item dan Edit Item.

   ⛔ Aturan pemilihannya (FR-A3) hidup di
   `packages/domain/src/modifier-pilihan.ts`, bukan di sini. Satu pemilih untuk
   dua layar: dua salinan berarti aturan "maksimal N" yang ditegakkan di satu
   layar dan lolos di yang lain. */

/** Pilihan per DAFTAR modifier: `daftar.id` → { modifier.id → qtyMilli }. */
export type PilihanPerDaftar = Record<string, PilihanModifier>;

export function aturanDari(d: DaftarModifier): AturanModifier {
  return {
    tipe: d.tipe,
    wajib: d.wajib,
    minPilih: d.minPilih,
    maxPilih: d.maxPilih,
    bolehGanda: d.bolehGanda,
  };
}

/** `is_default` terpilih otomatis (AC FR-A3 kedua) — kuantitas satu. */
export function pilihanBawaan(daftar: readonly DaftarModifier[]): PilihanPerDaftar {
  return Object.fromEntries(
    daftar.map((d) => [
      d.id,
      Object.fromEntries(d.modifier.filter((m) => m.bawaan).map((m) => [m.id, QTY_MODIFIER])),
    ])
  );
}

/** Pilihan yang SUDAH ada di sebuah baris keranjang (Edit Item). */
export function pilihanDariBaris(
  daftar: readonly DaftarModifier[],
  modifier: readonly ModifierTerpilih[]
): PilihanPerDaftar {
  return Object.fromEntries(
    daftar.map((d) => [
      d.id,
      Object.fromEntries(
        d.modifier
          .map((m) => [m.id, modifier.find((x) => x.id === m.id)?.qtyMilli ?? 0] as const)
          .filter(([, qty]) => qty > 0)
      ),
    ])
  );
}

/* ⛔ Baris terpilih diurutkan mengikuti KATALOG, bukan urutan penekanan
   tombol. Sidik jari keranjang mengurutkan sendiri, tapi struk dan layar
   membaca daftar ini apa adanya — barista yang membaca "Es, Gula" pada satu
   struk dan "Gula, Es" pada struk berikutnya untuk pesanan yang sama akan
   berhenti membaca urutannya. */
export function modifierTerpilihDari(
  daftar: readonly DaftarModifier[],
  terpilih: PilihanPerDaftar
): ModifierTerpilih[] {
  return daftar.flatMap((d) =>
    d.modifier
      .filter((m) => ((terpilih[d.id] ?? {})[m.id] ?? 0) > 0)
      .map((m) => ({
        id: m.id,
        nama: m.nama,
        harga: m.harga,
        qtyMilli: (terpilih[d.id] ?? {})[m.id],
      }))
  );
}

export function pesanKurangSemua(daftar: readonly DaftarModifier[], terpilih: PilihanPerDaftar): string[] {
  return daftar
    .map((d) => pesanKurang(d.nama, aturanDari(d), terpilih[d.id] ?? {}))
    .filter((p): p is string => p !== null);
}

export function PemilihModifier({
  daftar,
  terpilih,
  onUbah,
}: {
  daftar: readonly DaftarModifier[];
  terpilih: PilihanPerDaftar;
  onUbah: (d: DaftarModifier, f: (p: PilihanModifier) => PilihanModifier) => void;
}) {
  return (
    <>
      {daftar.map((d) => {
        const aturan = aturanDari(d);
        const pilihan = terpilih[d.id] ?? {};
        const sisaKurang = kurangnya(aturan, pilihan);
        return (
          <fieldset key={d.id} className="kasir-alasan">
            <legend className="t-body-md">
              {d.nama}
              {d.wajib ? ' · wajib' : ''}
              {/* AC FR-A3 pertama menuntut batasnya TERLIHAT, bukan hanya
                  ditegakkan. Kasir yang tombolnya mati tanpa penjelasan akan
                  menyimpulkan aplikasinya rusak. */}
              {d.maxPilih !== null ? ` · maksimal ${d.maxPilih}` : ''}
              {sisaKurang > 0 ? ` · kurang ${sisaKurang}` : ''}
            </legend>

            {/* `single` yang TIDAK wajib mendapat "Tanpa pilihan"
                (`spec-a:119`). Tanpanya, radio yang sudah ditekan tidak dapat
                dibatalkan sama sekali. */}
            {d.tipe === 'single' && !d.wajib && d.minPilih === 0 && (
              <label className="kasir-alasan-opsi t-body-md">
                <input
                  type="radio"
                  name={d.id}
                  checked={Object.keys(pilihan).length === 0}
                  onChange={() => onUbah(d, kosongkanPilihan)}
                />
                Tanpa pilihan
              </label>
            )}

            {d.modifier.map((m) => {
              const qty = pilihan[m.id] ?? 0;
              const penuh = qty === 0 && !bolehTambah(aturan, pilihan, m.id);
              return (
                <label key={m.id} className="kasir-alasan-opsi t-body-md">
                  <input
                    type={d.tipe === 'single' ? 'radio' : 'checkbox'}
                    name={d.id}
                    checked={qty > 0}
                    /* ⛔ DINONAKTIFKAN, bukan diterima lalu ditolak
                       (`spec-a:126`). */
                    disabled={penuh}
                    onChange={() => onUbah(d, (p) => togglePilihan(aturan, p, m.id))}
                  />
                  {m.nama}
                  {m.harga !== 0 && <span className="num"> · +{rupiah(m.harga)}</span>}

                  {/* `allow_duplicate` → stepper (`spec-a:121`). Hanya untuk
                      yang SUDAH dipilih: stepper pada modifier yang belum
                      dipilih adalah dua cara memilih hal yang sama. */}
                  {d.bolehGanda && qty > 0 && (
                    <>
                      <Tombol varian="ghost" onClick={() => onUbah(d, (p) => kurangPilihan(p, m.id))}>
                        −
                      </Tombol>
                      <span className="num">×{qty / QTY_MODIFIER}</span>
                      <Tombol
                        varian="ghost"
                        disabled={!bolehTambah(aturan, pilihan, m.id)}
                        onClick={() => onUbah(d, (p) => tambahPilihan(aturan, p, m.id))}
                      >
                        +
                      </Tombol>
                    </>
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </>
  );
}
