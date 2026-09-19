/**
 * Penanda MEMUAT — satu komponen untuk kesembilan layar kasir. TEMUAN B1.
 *
 * ## ⛔ Yang ini gantikan, dan kenapa ia salah
 *
 * Kesembilan layar memakai `<EmptyState title="Membaca …">`. `EmptyState`
 * bundle dirancang untuk keadaan **KOSONG** — "tidak ada apa-apa di sini" —
 * dan bentuknya menyatakan itu: ikon besar di tengah, ruang kosong lapang,
 * kalimat yang terdengar final.
 *
 * Keadaan MEMUAT berarti kebalikannya: "ada sesuatu, tunggu sebentar". Kasir
 * yang melihat bentuk "kosong" pada perangkat yang sebenarnya sedang membaca
 * katalog menyimpulkan katalognya hilang — dan pada perangkat lambat ia
 * menyimpulkannya setiap pagi.
 *
 * ⛔ **`/ds-bundle` TIDAK mengirim skeleton maupun spinner.** Diperiksa di
 * sumbernya (`docs/verifikasi/BUNDLE.md`), bukan diasumsikan dari namanya. Ini
 * salah satu dari tiga butir peninjauan yang memang harus dibangun sendiri.
 *
 * ## ⛔ Kerangka, bukan spinner
 *
 * Spinner tidak mengatakan apa pun tentang APA yang sedang datang, dan ia
 * membuat tata letak MELOMPAT saat isinya tiba — kartu grid muncul dari
 * ketiadaan dan mendorong segalanya. Kerangka menempati ruang yang akan diisi,
 * jadi kedatangan isi tidak memindahkan satu pun elemen.
 *
 * ## ⛔ Animasinya menghormati `prefers-reduced-motion`
 *
 * Denyut yang berjalan terus di layar yang dipandangi sepanjang shift adalah
 * beban, bukan informasi. Yang menyetel pengurangan gerak mendapat kerangka
 * DIAM — bentuknya tetap menyampaikan "sedang datang".
 */
export function Memuat({
  judul,
  /** Bentuk kerangkanya. `grid` untuk K-03, `baris` untuk daftar, `blok` untuk form. */
  bentuk = 'baris',
  /** Berapa banyak kerangka. Bukan angka sebenarnya — ia tidak diketahui. */
  jumlah = 6,
}: {
  judul: string;
  bentuk?: 'grid' | 'baris' | 'blok';
  jumlah?: number;
}) {
  return (
    <div className="kasir-memuat">
      {/* ⛔ `role="status"` + `aria-live`: pembaca layar tidak melihat kerangka
          sama sekali. Tanpa kalimat ini, keadaan memuat SENYAP — dan senyap
          tidak dapat dibedakan dari layar yang tidak merespons. */}
      <p className="t-body-md kasir-login-sub" role="status" aria-live="polite">
        {judul}
      </p>
      <div className={`kasir-memuat-${bentuk}`} aria-hidden="true">
        {Array.from({ length: jumlah }, (_, i) => (
          <div key={i} className="kasir-rangka" />
        ))}
      </div>
    </div>
  );
}
