import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import {
  CATATAN_RETAIL,
  CATATAN_SINKRONISASI,
  JUDUL_LAYAR,
  alasanTidakDapatDicabut,
  asalProfil,
  kalimatStokNegatif,
  labelAsal,
  type OutletProfil,
  type ProfilVertikal,
} from './b24.ts';

/**
 * B-24 — Profil Vertikal (`IA:203`, Owner). OQ-09.
 *
 * ## ⛔ Layar ini mengubah perilaku KASIR, bukan tampilan back-office
 *
 * Satu-satunya setelan yang benar-benar dibaca kode hari ini adalah
 * `allowNegativeStock` (FR-E4) — dan ia dibaca **di perangkat, offline**.
 * Karena itu layar menyebutkan akibatnya dalam kalimat yang menggambarkan apa
 * yang berbeda di tablet, bukan nama kolomnya.
 *
 * ## ⛔ Lima kolom perilaku lain TIDAK ada di layar
 *
 * `default_channel`, `requires_barcode_flow`, `default_tax_type`,
 * `modules_enabled` tidak dibaca satu baris kode pun di luar pendaftaran
 * tenant. Membukanya adalah persis cacat yang B-26 ada untuk menghindari:
 * setelan yang tersimpan dengan benar, ditampilkan kembali dengan benar, dan
 * tidak mengubah apa pun.
 *
 * ## ⛔ Retail dinyatakan, bukan disembunyikan
 *
 * `IA:291` menulis retail sebagai kolom v1.3 dan `PRD` § 4 menaruh UI-nya di
 * v1.1+. Merchant yang membaca materi produk dan mencari "retail" akan
 * menyimpulkan layarnya rusak kalau pilihannya sekadar tidak ada.
 */

type Keadaan = { jenis: 'memuat' } | { jenis: 'siap' } | { jenis: 'galat'; pesan: string };

interface Resp {
  profiles: ProfilVertikal[];
  outlets: OutletProfil[];
}

/**
 * Nama profil yang dapat dibaca orang.
 *
 * ⛔ Layar ini menampilkan UUID sebagai identitas utama profil di TIGA tempat —
 * baris tabel, kolom "profil yang berlaku", dan label tombol ("Pakai
 * 010b13bb…"). Merchant tidak punya cara mengenali profilnya dari deretan hex,
 * dan tombol yang berlabel potongan UUID tidak dapat dibaca sebelum ditekan.
 *
 * Kelas yang sama dengan `sesi.userId` di topbar back-office (31 Agustus
 * 2026): id dipakai karena ia PASTI ada, sementara nama yang dapat dibaca
 * justru yang dicari orang.
 */
function namaProfil(p: { name: string; isTenantDefault?: boolean }): string {
  return p.name === 'fnb' ? 'F&B' : p.name;
}

export function VertikalLayar() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [data, setData] = useState<Resp | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      setData(await api.minta<Resp>('/vertical-profiles'));
      setKeadaan({ jenis: 'siap' });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan: err instanceof GalatHttp ? err.message : 'Profil vertikal tidak dapat dimuat.',
      });
    }
  }, [api]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function kirim(jalan: () => Promise<unknown>, sukses: string) {
    setPesan(null);
    setKabar(null);
    setSedangKirim(true);
    try {
      await jalan();
      setKabar(sukses);
      await muat();
    } catch (err) {
      // `DEFAULT_PROFILE_REQUIRED` dan `VERTICAL_NOT_AVAILABLE` mendarat di
      // sini, dan keduanya sudah menjelaskan dirinya.
      setPesan(err instanceof GalatHttp ? err.message : 'Perubahan tidak dapat disimpan.');
    } finally {
      setSedangKirim(false);
    }
  }

  const ubahStok = (p: ProfilVertikal) =>
    kirim(
      () =>
        api.minta(`/vertical-profiles/${p.id}`, {
          metode: 'PATCH',
          body: { allowNegativeStock: !p.allowNegativeStock },
        }),
      `Aturan stok profil ${p.id} diperbarui. ${CATATAN_SINKRONISASI}`
    );

  const jadikanBawaan = (p: ProfilVertikal) =>
    kirim(
      () =>
        api.minta(`/vertical-profiles/${p.id}`, {
          metode: 'PATCH',
          body: { isTenantDefault: true },
        }),
      'Bawaan tenant dipindahkan. Outlet tanpa profil sendiri kini mengikuti profil ini.'
    );

  const setelOutlet = (o: OutletProfil, profilId: string | null) =>
    kirim(
      () =>
        api.minta(`/outlets/${o.id}/vertical-profile`, {
          metode: 'PUT',
          body: { verticalProfileId: profilId },
        }),
      profilId === null
        ? `${o.name} kembali mengikuti bawaan tenant.`
        : `${o.name} kini memakai profilnya sendiri. ${CATATAN_SINKRONISASI}`
    );

  const buatProfil = () =>
    kirim(
      () =>
        api.minta('/vertical-profiles', {
          metode: 'POST',
          // ⛔ Id di-generate KLIEN, konvensi repo ini. Percobaan ulang setelah
          // respons hilang menjawab 409, bukan membuat profil kedua.
          body: { id: crypto.randomUUID(), allowNegativeStock: true },
        }),
      'Profil baru dibuat. Tetapkan sebagai bawaan tenant, atau pilihkan ke satu outlet.'
    );

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '92ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">{JUDUL_LAYAR}</span>
        <span className="t-caption">
          Aturan yang berbeda antar cabang. Pusat menetapkan bawaannya; cabang boleh memakai
          profilnya sendiri.
        </span>
      </div>

      {kabar ? (
        <Card>
          <div className="card-pad">
            <span className="t-body-md" role="status">
              {kabar}
            </span>
          </div>
        </Card>
      ) : null}

      {pesan ? (
        <Card>
          <div className="card-pad">
            <span className="t-body-md" role="alert" style={{ color: 'var(--danger)' }}>
              {pesan}
            </span>
          </div>
        </Card>
      ) : null}

      {keadaan.jenis === 'galat' ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Profil vertikal tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          </div>
        </Card>
      ) : null}

      {keadaan.jenis === 'siap' && data !== null ? (
        <>
          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-4)' }}>
                <div className="row between">
                  <span className="t-body-md">Profil</span>
                  <Tombol varian="primary" disabled={sedangKirim} onClick={() => void buatProfil()}>
                    Tambah profil
                  </Tombol>
                </div>

                {data.profiles.length === 0 ? (
                  <EmptyState
                    icon={<Icon name="layers" size={32} />}
                    title="Belum ada profil"
                    body="Tanpa profil, seluruh outlet memakai aturan bawaan sistem — aturan yang tidak dipilih siapa pun. Tambahkan satu dan tetapkan sebagai bawaan."
                  />
                ) : (
                  <Table
                    columns={[
                      { key: 'profil', header: 'Profil' },
                      { key: 'stok', header: 'Saat stok tercatat habis' },
                      { key: 'aksi', header: '', align: 'right' },
                    ]}
                    rows={data.profiles.map((p) => ({
                      profil: (
                        <div className="stack" style={{ gap: 'var(--space-1)' }}>
                          {/* Nama dulu, id sebagai baris kecil di bawahnya —
                              id tetap ditampilkan karena dua profil boleh
                              bernama sama, tapi ia bukan yang dibaca orang. */}
                          <span className="t-body-md">
                            {namaProfil(p)}
                            {p.isTenantDefault ? ' · bawaan tenant' : ''}
                          </span>
                          <span className="num t-caption">{p.id}</span>
                        </div>
                      ),
                      // ⛔ Kalimat akibatnya, bukan nama kolom. Owner kafe
                      // tidak tahu apa yang "izinkan stok negatif" ubah di
                      // tablet kasirnya besok pagi.
                      stok: <span className="t-caption">{kalimatStokNegatif(p.allowNegativeStock)}</span>,
                      aksi: (
                        <div
                          className="row"
                          style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}
                        >
                          <Tombol disabled={sedangKirim} onClick={() => void ubahStok(p)}>
                            {p.allowNegativeStock ? 'Larang jual saat habis' : 'Izinkan jual saat habis'}
                          </Tombol>
                          {p.isTenantDefault ? (
                            // ⛔ Bukan tombol yang mati tanpa penjelasan.
                            // Lihat `alasanTidakDapatDicabut`.
                            <Badge tone="neutral">Bawaan tenant</Badge>
                          ) : (
                            <Tombol disabled={sedangKirim} onClick={() => void jadikanBawaan(p)}>
                              Jadikan bawaan
                            </Tombol>
                          )}
                        </div>
                      ),
                    }))}
                  />
                )}

                {data.profiles.find((p) => p.isTenantDefault) ? null : (
                  <span className="t-caption" role="alert">
                    Tenant ini belum punya profil bawaan. Outlet tanpa profil sendiri memakai
                    aturan bawaan sistem — aturan yang tidak dipilih siapa pun.
                  </span>
                )}
                {data.profiles.some((p) => p.isTenantDefault)
                  ? (() => {
                      const bawaan = data.profiles.find((p) => p.isTenantDefault) as ProfilVertikal;
                      return (
                        <span className="t-caption">{alasanTidakDapatDicabut(bawaan) ?? ''}</span>
                      );
                    })()
                  : null}
              </div>
            </div>
          </Card>

          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-4)' }}>
                <span className="t-body-md">Outlet</span>

                <Table
                  columns={[
                    { key: 'outlet', header: 'Outlet' },
                    { key: 'asal', header: 'Profil yang berlaku' },
                    { key: 'stok', header: 'Saat stok tercatat habis' },
                    { key: 'aksi', header: '', align: 'right' },
                  ]}
                  rows={data.outlets.map((o) => ({
                    outlet: o.name,
                    // ⛔ TIGA keadaan, bukan dua. Lihat `asalProfil`.
                    asal: (
                      <div className="stack" style={{ gap: 'var(--space-1)' }}>
                        <Badge tone="neutral">{labelAsal(asalProfil(o))}</Badge>
                        <span className="t-caption">{namaProfil(o.berlaku)}</span>
                      </div>
                    ),
                    stok: (
                      <span className="t-caption">
                        {kalimatStokNegatif(o.berlaku.allowNegativeStock)}
                      </span>
                    ),
                    aksi: (
                      <div
                        className="row"
                        style={{ gap: 'var(--space-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}
                      >
                        {o.verticalProfileId === null ? null : (
                          <Tombol disabled={sedangKirim} onClick={() => void setelOutlet(o, null)}>
                            Ikuti bawaan
                          </Tombol>
                        )}
                        {data.profiles
                          .filter((p) => p.id !== o.verticalProfileId)
                          .map((p) => (
                            <Tombol
                              key={p.id}
                              disabled={sedangKirim}
                              onClick={() => void setelOutlet(o, p.id)}
                            >
                              Pakai {namaProfil(p)}
                            </Tombol>
                          ))}
                      </div>
                    ),
                  }))}
                />
              </div>
            </div>
          </Card>
        </>
      ) : null}

      <span className="t-caption">{CATATAN_RETAIL}</span>
      <span className="t-caption">{CATATAN_SINKRONISASI}</span>
      <span className="t-caption">
        Setiap perubahan tercatat di <strong>Audit &amp; Aktivitas</strong> beserta nilai lama,
        nilai baru, dan siapa yang mengubahnya.
      </span>
    </div>
  );
}
