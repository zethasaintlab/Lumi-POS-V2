import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { PinHasher } from '../../../../packages/domain/src/pin.ts';

/**
 * Login PIN offline (FR-F3) dan penguncian (FR-F4).
 *
 * ## Kenapa modul murni dengan port
 *
 * `spec-f:190` menyebut ini pembeda utama versus Toast, "yang secara eksplisit
 * menyatakan pengguna tidak dapat login kembali sampai koneksi pulih". Kalau
 * alur ini hanya dapat dijalankan di browser dengan database sungguhan, ia
 * hanya akan diuji pada keadaan yang mudah — dan keadaan yang menentukan di
 * sini adalah yang sulit dibuat: penguncian yang bertahan melewati restart,
 * jendela eskalasi satu jam, pengguna yang dicabut.
 *
 * Seluruh I/O lewat `DbLokal`; waktu di-inject. Sama seperti lapisan sync.
 */

/** `spec-f:218-219`. */
const BATAS_GAGAL = 5;
const KUNCI_DETIK = 60;
const KUNCI_ESKALASI_DETIK = 900;
const ESKALASI_SETELAH = 3;
const JENDELA_MS = 60 * 60 * 1000;

/**
 * Kunci baris untuk hitungan kegagalan yang TIDAK dapat dinisbatkan ke
 * pengguna mana pun. Bukan user id, dan tidak akan pernah bentrok dengan
 * satu pun -- id pengguna adalah ULID/UUID.
 */
const KUNCI_PERANGKAT = '@perangkat';

export interface Sesi {
  userId: string;
  nama: string;
  peran: string[];
  masukPada: string;
  wajibGantiPin: boolean;
}

export type HasilLogin =
  | { status: 'berhasil'; sesi: Sesi }
  | { status: 'pin_salah'; pesan: string }
  | { status: 'terkunci'; pesan: string; detikTersisa: number };

export interface BarisKunci {
  gagal_berturut?: number;
  terkunci_sampai?: string | null;
  jumlah_penguncian?: number;
  jendela_mulai?: string | null;
}

/**
 * Satu pesan untuk SEMUA kegagalan PIN.
 *
 * `spec-f:161`: "pesan netral: 'PIN salah' — tidak menyebut apakah pengguna
 * ada". Perangkat kasir berdiri di ruang publik; pesan yang membedakan
 * "pengguna tidak ada" dari "PIN salah" memberi tahu siapa pun yang berdiri
 * di sana PIN mana yang mendekati.
 *
 * Berlaku juga untuk pengguna NONAKTIF dan pengguna TANPA PIN — keduanya
 * jatuh ke pesan yang sama persis.
 */
const PESAN_SALAH = 'PIN salah.';

/**
 * Menghitung durasi penguncian berikutnya (`spec-f:229`).
 *
 * Terpisah dan murni supaya eskalasinya dapat diuji tanpa menjalankan lima
 * belas login gagal — dan supaya jendela satu jamnya dapat diuji sama sekali,
 * yang lewat `masuk()` menuntut menggerakkan jam.
 */
export function hitungPenguncian(
  kunci: BarisKunci | null,
  sekarang: Date
): { detik: number; jumlah: number; jendelaMulai: string } {
  const mulai = kunci?.jendela_mulai ? Date.parse(kunci.jendela_mulai) : null;
  const jendelaHabis = mulai === null || sekarang.getTime() - mulai > JENDELA_MS;

  const jumlah = jendelaHabis ? 1 : (kunci?.jumlah_penguncian ?? 0) + 1;
  const detik = jumlah >= ESKALASI_SETELAH ? KUNCI_ESKALASI_DETIK : KUNCI_DETIK;
  const jendelaMulai = jendelaHabis
    ? sekarang.toISOString()
    : (kunci?.jendela_mulai as string);

  return { detik, jumlah, jendelaMulai };
}


/** Bentuk jawaban terkunci, dengan hitung mundur (`spec-f:220`). */
function terkunci(sampaiMs: number, sekarang: Date): HasilLogin {
  const detikTersisa = Math.ceil((sampaiMs - sekarang.getTime()) / 1000);
  return {
    status: 'terkunci',
    pesan: `PIN terkunci. Coba lagi dalam ${detikTersisa} detik.`,
    detikTersisa,
  };
}

async function bacaKunci(db: DbLokal, userId: string): Promise<BarisKunci | null> {
  const baris = await db.getAll<BarisKunci>(
    `SELECT gagal_berturut, terkunci_sampai, jumlah_penguncian, jendela_mulai
       FROM pin_lockout_lokal WHERE user_id = ?`,
    [userId]
  );
  return baris[0] ?? null;
}

interface BarisPengguna {
  id: string;
  name: string;
  pin_hash: string | null;
  pin_must_change: number;
  is_active: number;
}

/**
 * Mencoba masuk dengan satu PIN.
 *
 * ## Kenapa ia mencoba SETIAP pengguna outlet
 *
 * Kasir mengetik PIN saja — tidak ada nama pengguna di layar K-01
 * (`IA:2.2`). Jadi PIN-lah yang mengidentifikasi orangnya, dan itu hanya
 * bekerja karena PIN unik per outlet (`spec-f:126`, ditegakkan server saat
 * PIN diset).
 *
 * Biayanya n × ~36 ms Argon2 dengan n = staf outlet. Untuk kafe 2–20 outlet
 * itu di bawah satu detik pada kasus terburuk, dan hanya terjadi sekali per
 * shift.
 *
 * ⛔ Penguncian diperiksa SETELAH pengguna dikenali, bukan sebelum — kita
 * belum tahu siapa yang mengetik sampai PIN-nya cocok. Konsekuensinya
 * penguncian per pengguna (`spec-f:236`) benar-benar mungkin; memeriksanya
 * lebih dulu menuntut penanda per perangkat, dan satu orang yang salah ketik
 * lima kali akan menghentikan seluruh outlet di tengah antrean.
 */
export async function masuk({
  db,
  hasher,
  waktu,
  pin,
}: {
  db: DbLokal;
  hasher: PinHasher;
  waktu: () => Date;
  pin: string;
}): Promise<HasilLogin> {
  const sekarang = waktu();

  const pengguna = await db.getAll<BarisPengguna>(
    `SELECT id, name, pin_hash, pin_must_change, is_active
       FROM "user" WHERE is_active = 1 AND pin_hash IS NOT NULL`
  );

  let cocok: BarisPengguna | null = null;
  for (const u of pengguna) {
    // Pengguna nonaktif dan pengguna tanpa PIN sudah tersaring query di atas.
    // Diperiksa lagi di sini karena `getAll` palsu di test dan implementasi
    // sungguhan tidak dijamin menyaring hal yang sama — dan yang lolos di
    // sini berarti siapa pun dapat masuk sebagai akuntan yang hanya punya
    // password.
    if (u.is_active !== 1 || !u.pin_hash) continue;
    if (await hasher.verifikasi(pin, u.pin_hash)) {
      cocok = u;
      break;
    }
  }

  if (!cocok) {
    // ⛔ [ASUMSI] Resolusi ketegangan di dalam spec, ditandai karena ia
    // keputusan produk yang belum divalidasi ke merchant.
    //
    // `spec-f:218` menulis "PERANGKAT mengunci input PIN selama 60 detik".
    // `spec-f:236` menulis "penguncian PER PENGGUNA, bukan per perangkat --
    // tidak menghalangi kasir lain yang PIN-nya benar". Keduanya tidak dapat
    // benar apa adanya: PIN yang salah tidak cocok dengan siapa pun, jadi
    // kegagalannya TIDAK DAPAT dinisbatkan ke pengguna mana pun.
    //
    // Yang dibangun memenuhi maksud keduanya:
    //
    //   - hitungan kegagalan tak-ternisbat disimpan pada PERANGKAT, dan pada
    //     kegagalan kelima input PIN terkunci — itu yang menghentikan
    //     penebakan (spec-f:218);
    //   - penguncian itu hanya berlaku untuk PIN yang TIDAK cocok. PIN yang
    //     cocok tetap diperiksa terhadap penguncian PENGGUNANYA sendiri, jadi
    //     kasir lain yang PIN-nya benar tidak terhalang (spec-f:236).
    //
    // Konsekuensinya jujur: penguncian ini memperlambat penebakan, tidak
    // menutupnya bagi orang yang sudah tahu satu PIN yang sah. Itu sesuai
    // dengan `spec-f:118` — PIN adalah atribusi, bukan batas keamanan.
    const kunciPerangkat = await bacaKunci(db, KUNCI_PERANGKAT);
    const sampaiPerangkat = kunciPerangkat?.terkunci_sampai
      ? Date.parse(kunciPerangkat.terkunci_sampai)
      : null;
    if (sampaiPerangkat !== null && sampaiPerangkat > sekarang.getTime()) {
      return terkunci(sampaiPerangkat, sekarang);
    }

    const hasil = await catatGagal(db, KUNCI_PERANGKAT, sekarang);
    if (hasil.terkunci) {
      return {
        status: 'terkunci',
        pesan: `PIN terkunci. Coba lagi dalam ${hasil.detik} detik.`,
        detikTersisa: hasil.detik,
      };
    }
    return { status: 'pin_salah', pesan: PESAN_SALAH };
  }

  const kunci = await bacaKunci(db, cocok.id);
  const sampai = kunci?.terkunci_sampai ? Date.parse(kunci.terkunci_sampai) : null;
  if (sampai !== null && sampai > sekarang.getTime()) {
    // PIN yang BENAR pun ditolak selama penguncian aktif. Kalau tidak,
    // penguncian hanya memperlambat orang yang menebak alih-alih
    // menghentikannya.
    const detikTersisa = Math.ceil((sampai - sekarang.getTime()) / 1000);
    return {
      status: 'terkunci',
      pesan: `PIN terkunci. Coba lagi dalam ${detikTersisa} detik.`,
      detikTersisa,
    };
  }

  return db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM pin_lockout_lokal WHERE user_id = ?`, [cocok.id]);

    const peranBaris = await tx.getAll<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = ?`,
      [cocok.id]
    );
    const peran = peranBaris.map((p) => p.role);

    const sesi: Sesi = {
      userId: cocok.id,
      nama: cocok.name,
      peran,
      masukPada: sekarang.toISOString(),
      wajibGantiPin: cocok.pin_must_change === 1,
    };

    await tx.execute(
      `INSERT OR REPLACE INTO sesi_lokal (id, user_id, nama, peran, masuk_pada, wajib_ganti_pin)
       VALUES (1, ?, ?, ?, ?, ?)`,
      [sesi.userId, sesi.nama, JSON.stringify(peran), sesi.masukPada, sesi.wajibGantiPin ? 1 : 0]
    );

    return { status: 'berhasil' as const, sesi };
  });
}

/**
 * Mencatat satu percobaan gagal dan menguncinya bila sudah mencapai batas.
 *
 * Terpisah dari `masuk` karena PIN yang salah tidak dapat diikat ke pengguna
 * mana pun — itu justru yang membuat pesannya netral (`spec-f:161`). Yang
 * dapat dihitung hanyalah kegagalan pada PERANGKAT ini, dan ia dinisbatkan ke
 * pengguna hanya ketika PIN-nya akhirnya cocok.
 */
export async function catatGagal(
  db: DbLokal,
  userId: string,
  sekarang: Date
): Promise<{ terkunci: boolean; detik: number }> {
  const kunci = await bacaKunci(db, userId);
  const gagal = (kunci?.gagal_berturut ?? 0) + 1;

  if (gagal < BATAS_GAGAL) {
    await db.execute(
      `INSERT INTO pin_lockout_lokal (user_id, gagal_berturut) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET gagal_berturut = ?`,
      [userId, gagal, gagal]
    );
    return { terkunci: false, detik: 0 };
  }

  const { detik, jumlah, jendelaMulai } = hitungPenguncian(kunci, sekarang);
  const sampai = new Date(sekarang.getTime() + detik * 1000).toISOString();

  await db.execute(
    `INSERT INTO pin_lockout_lokal (user_id, gagal_berturut, terkunci_sampai, jumlah_penguncian, jendela_mulai)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       gagal_berturut = ?, terkunci_sampai = ?, jumlah_penguncian = ?, jendela_mulai = ?`,
    [userId, gagal, sampai, jumlah, jendelaMulai, gagal, sampai, jumlah, jendelaMulai]
  );

  return { terkunci: true, detik };
}

/**
 * FR-H4 — logout diblokir saat antrean upload tidak kosong.
 *
 * `spec-f:207` menyebut alasannya langsung: "pelajaran dari Toast, di mana
 * logout offline mengunci pengguna". Antrean yang belum terkirim adalah
 * penjualan yang hanya ada di perangkat ini; logout yang mengizinkan
 * pergantian kasir di atasnya membuat penjualan itu dinisbatkan ke orang yang
 * salah — atau, kalau perangkat di-reset, hilang tanpa jejak di mana pun.
 *
 * Pesannya menyebut JUMLAH. Kasir yang tidak tahu berapa banyak tidak dapat
 * menilai apakah menunggu sebentar cukup atau harus memanggil manajer.
 */
export function bolehLogout({ jumlahBelumTerkirim }: { jumlahBelumTerkirim: number }): {
  boleh: boolean;
  pesan: string;
} {
  if (jumlahBelumTerkirim > 0) {
    return {
      boleh: false,
      pesan:
        `${jumlahBelumTerkirim} transaksi belum terkirim ke server. ` +
        'Tunggu sampai antrean kosong sebelum keluar — transaksi ini hanya ada di perangkat ini.',
    };
  }
  return { boleh: true, pesan: '' };
}
