// H2-4 -- latensi indikator sinkronisasi, diukur terhadap DOM sungguhan.
//
// `spec-h:224`: "Indikator diperbarui < 1 detik setelah perubahan status."
//
// Kenapa halaman terpisah, bukan pengukuran dari konsol: `import()` dari
// konsol devtools mendapat INSTANCE MODUL KEDUA -- Vite menambahkan `?t=`
// pada modul yang sudah lewat HMR, dan `buka()` memoisasi per instance. Ukuran
// yang diambil begitu melaporkan jalur `watch()` (~1.000 ms) sambil terlihat
// seperti mengukur jalur `pemberitahu`. Terjadi sekali; sejak itu pengukurannya
// tinggal di sini, tempat impornya tunggal.
//
// Yang dirender di bawah adalah `ShellKasir` SUNGGUHAN, bukan tiruan: yang
// diuji AC-nya adalah indikator yang benar-benar dilihat kasir.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'ds/styles.css';
import '../kasir.css';
import { ShellKasir } from '../ShellKasir.tsx';
import { DbLokalProvider, lokalSekarang } from '../konteks/DbLokalProvider.tsx';

const NAMA_DB_CATATAN = 'lumi-kasir.db (database aplikasi)';

function tunggu(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tungguSampai(syarat: () => boolean, batasMs = 8_000): Promise<boolean> {
  const batas = performance.now() + batasMs;
  while (performance.now() < batas) {
    if (syarat()) return true;
    await tunggu(10);
  }
  return syarat();
}

/**
 * Menunggu perubahan DOM lewat `MutationObserver`, bukan lewat polling timer.
 *
 * ⛔ Ini bukan pilihan gaya. Versi pertama memakai `setTimeout` 10 ms dan
 * melaporkan latensi indikator **~991 ms** secara konsisten -- angka yang
 * nyaris sama dengan jalur `watch()`, dan yang membuat jalur `pemberitahu`
 * terlihat tidak ada gunanya. Probe di dalam test yang sama membuktikan
 * sebaliknya: callback 0,0 ms, query 1,4 ms, DOM ~111 ms.
 *
 * Penyebabnya browser, bukan aplikasi: di tab yang tidak di depan,
 * `setTimeout` DI-CLAMP ke minimal ~1.000 ms. Jadi 991 ms itu granularitas
 * alat ukurnya sendiri. `MutationObserver` menyala pada perubahan DOM dan
 * tidak lewat timer sama sekali.
 */
function tungguDom(syarat: () => boolean, batasMs = 8_000): Promise<number | null> {
  const t0 = performance.now();
  return new Promise((selesai) => {
    if (syarat()) {
      selesai(performance.now() - t0);
      return;
    }
    const pengamat = new MutationObserver(() => {
      if (syarat()) {
        pengamat.disconnect();
        clearTimeout(jam);
        selesai(performance.now() - t0);
      }
    });
    pengamat.observe(document.body, { subtree: true, childList: true, characterData: true });
    const jam = setTimeout(() => {
      pengamat.disconnect();
      selesai(syarat() ? performance.now() - t0 : null);
    }, batasMs);
  });
}

/* Spasi dinormalkan: `SyncIndicator` menyusun teksnya dari beberapa elemen,
   dan pemisah "·" pada state `failed` adalah `<span className="dot" />` --
   sebuah titik VISUAL tanpa teks. Karena itu `textContent` state failed
   berbunyi "Gagal kirim (2) Coba lagi", bukan "Gagal kirim (2) · Coba lagi"
   seperti tertulis di spec-h:216. Yang dituntut spec ada di layar; yang tidak
   ada hanya glifnya di `textContent`. */
const teksIndikatorDom = () =>
  (document.querySelector('.sync')?.textContent ?? '').replace(/\s+/g, ' ').trim();

function lapor(nama: string, nilai: string, lulus: boolean) {
  const tbody = document.querySelector('#hasil') as HTMLElement;
  const tr = document.createElement('tr');
  for (const isi of [lulus ? 'LULUS' : 'GAGAL', nama, nilai]) {
    const td = document.createElement('td');
    td.textContent = isi;
    tr.append(td);
  }
  tbody.append(tr);
  console.log(`HASIL\t${lulus ? 'LULUS' : 'GAGAL'}\t${nama}\t${nilai}`);
}

async function jalankan() {
  const status = document.querySelector('#status') as HTMLElement;
  status.textContent = 'menjalankan…';
  let gagal = 0;
  const periksa = (n: string, v: string, l: boolean) => {
    if (!l) gagal += 1;
    lapor(n, v, l);
  };

  createRoot(document.querySelector('#app') as HTMLElement).render(
    <StrictMode>
      <DbLokalProvider>
        <ShellKasir
          outlet="Outlet uji"
          device="K1"
          pengguna="Harness"
          ruteAktif={null}
        >
          <p className="t-caption">isi</p>
        </ShellKasir>
      </DbLokalProvider>
    </StrictMode>
  );

  const { db, pemberitahu } = await lokalSekarang();
  periksa('H2-4a database aplikasi terbuka', NAMA_DB_CATATAN, true);

  // Bersih dulu supaya angka awalnya pasti "Tersinkron".
  await db.execute(`DELETE FROM outbox_local`);
  pemberitahu.beritahu();
  await tungguSampai(() => teksIndikatorDom() === 'Tersinkron');
  periksa('H2-4b indikator awal', teksIndikatorDom(), teksIndikatorDom() === 'Tersinkron');

  // Bukti bahwa yang diukur benar-benar indikator milik aplikasi: komponennya
  // sudah berlangganan SEBELUM harness menambah apa pun.
  periksa(
    'H2-4c komponen aplikasi berlangganan pemberitahu',
    `${pemberitahu.jumlahPelanggan} pelanggan`,
    pemberitahu.jumlahPelanggan >= 1
  );

  // --- yang menentukan: latensi dari perubahan ke DOM --------------------
  const ukur = async (
    nama: string,
    siapkan: () => Promise<void>,
    harap: string,
    { pakaiIsyarat }: { pakaiIsyarat: boolean }
  ) => {
    const sebelum = teksIndikatorDom();
    await siapkan();
    // Pengamat dipasang SEBELUM isyarat dikirim, kalau tidak perubahan yang
    // datang dalam milidetik pertama terlewat dan yang terukur perubahan
    // berikutnya.
    const tunggu = tungguDom(() => teksIndikatorDom() !== sebelum);
    if (pakaiIsyarat) pemberitahu.beritahu();
    const ms = await tunggu;
    const teks = teksIndikatorDom();
    periksa(
      nama,
      `${sebelum} -> ${teks} dalam ${ms === null ? 'TIDAK BERUBAH' : `${Math.round(ms)} ms`}`,
      ms !== null && teks === harap && (!pakaiIsyarat || ms < 1000)
    );
    return ms === null ? Number.POSITIVE_INFINITY : ms;
  };

  const tulis = (n: number, awalan: string, status: string) => async () => {
    for (let i = 0; i < n; i += 1) {
      await db.execute(
        `INSERT OR REPLACE INTO outbox_local
           (id,entity_type,entity_id,operation,payload,idempotency_key,status,attempts,created_at)
         VALUES (?,'order',?,'create','{}',?,?,0,'2026-08-08T09:00:00Z')`,
        [`${awalan}-${i}`, `ord-${awalan}-${i}`, `key-${awalan}-${i}`, status]
      );
    }
  };

  // Probe: memisahkan tiga hal yang bisa jadi penyebab lambat -- pengiriman
  // isyarat, query ringkasan, dan render React. Tanpa ini, "993 ms" hanya
  // memberi tahu bahwa sesuatu lambat.
  {
    await db.execute(`DELETE FROM outbox_local`);
    pemberitahu.beritahu();
    await tungguSampai(() => teksIndikatorDom() === 'Tersinkron');

    await db.execute(
      `INSERT OR REPLACE INTO outbox_local
         (id,entity_type,entity_id,operation,payload,idempotency_key,status,attempts,created_at)
       VALUES ('probe','order','ord-probe','create','{}','key-probe','pending',0,'2026-08-08T09:00:00Z')`
    );
    const t0 = performance.now();
    let msCallback = -1;
    const lepasProbe = pemberitahu.langgan(() => {
      msCallback = performance.now() - t0;
    });
    pemberitahu.beritahu();
    lepasProbe();

    const tq = performance.now();
    const { ringkasanAntrean } = await import('../../../../packages/sync-client/src/status.ts');
    const r = await ringkasanAntrean(db);
    const msQuery = performance.now() - tq;

    const berubah = await tungguSampai(() => teksIndikatorDom() !== 'Tersinkron');
    const msDom = performance.now() - t0;

    periksa(
      'H2-4d1 probe: isyarat / query / DOM',
      `callback ${msCallback.toFixed(1)} ms · query ${msQuery.toFixed(1)} ms (menunggu=${r.menunggu}) · DOM ${Math.round(msDom)} ms`,
      berubah && msCallback >= 0 && r.menunggu === 1
    );

    await db.execute(`DELETE FROM outbox_local`);
    pemberitahu.beritahu();
    await tungguSampai(() => teksIndikatorDom() === 'Tersinkron');
  }

  const msIsyarat = await ukur('H2-4d tiga item mengantre (jalur pemberitahu)', tulis(3, 'q', 'pending'), 'Offline · 3 menunggu', {
    pakaiIsyarat: true,
  });

  // Teks `failed` design system memuat "· Coba lagi" HANYA bila `onRetry`
  // diberikan -- ia bagian dari tombol di dalam komponen, bukan label statis.
  // `spec-h:216` menuliskan teks itu utuh, jadi indikator tanpa `onRetry`
  // tidak memenuhi AC-nya.
  await ukur(
    'H2-4e dua item gagal: failed menang, teks lengkap sesuai spec-h:216',
    tulis(2, 'f', 'failed'),
    'Gagal kirim (2) Coba lagi',
    { pakaiIsyarat: true }
  );

  await ukur(
    'H2-4f antrean dikosongkan',
    async () => {
      await db.execute(`DELETE FROM outbox_local`);
    },
    'Tersinkron',
    { pakaiIsyarat: true }
  );

  // Jalur `watch()` diukur juga -- TANPA isyarat. Ia yang berlaku untuk
  // perubahan dari luar kode kita (katalog turun, tab lain), dan angkanya
  // yang menjelaskan kenapa `pemberitahu` harus ada.
  const msWatch = await ukur(
    'H2-4g tanpa isyarat: hanya watch() yang melihatnya',
    tulis(1, 'w', 'pending'),
    'Offline · 1 menunggu',
    { pakaiIsyarat: false }
  );

  periksa(
    'H2-4h isyarat jauh lebih cepat daripada watch()',
    `pemberitahu ${Math.round(msIsyarat)} ms vs watch ${Math.round(msWatch)} ms`,
    msIsyarat < msWatch
  );

  // Indikator adalah entry point ke K-14 (IA §2.4) -- ia harus dapat diklik.
  const tombol = document.querySelector('.kasir-indikator');
  periksa(
    'H2-4i indikator dapat diklik menuju K-14',
    tombol ? (tombol.getAttribute('aria-label') ?? '') : '(tidak ada)',
    Boolean(tombol)
  );

  await db.execute(`DELETE FROM outbox_local`);
  pemberitahu.beritahu();

  status.textContent = gagal === 0 ? 'selesai — semua uji LULUS' : `selesai — ${gagal} uji GAGAL`;
  console.log(`SELESAI\t${gagal} gagal`);
}

jalankan().catch((e) => {
  const status = document.querySelector('#status') as HTMLElement;
  status.textContent = `GAGAL: ${e.name}: ${e.message}`;
  console.error(e);
});
