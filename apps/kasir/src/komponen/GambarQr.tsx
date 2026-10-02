import qrcode from 'qrcode-generator';

/* G-QR: gambar ini WAJIB dapat dipindai dan terdekode SAMA PERSIS dengan `isi`
   (`tests/kasir-dom/k06-qr.test.js` mendekode `<svg>` ini di peramban). Tidak
   ada normalisasi `isi` di sini — `trim()` mengubah kode yang dibayar pelanggan.
   Gambar yang tidak dapat dipindai lebih buruk daripada tidak ada gambar (user,
   P3b): bila matriks tak dapat dibuat, tidak ada `<svg>` sama sekali. */

/* Bawaan pustaka memotong tiap karakter ke 8 bit; UTF-8 menjaga byte aslinya. */
/* (Berkas ESM pustaka tidak mengekspor `stringToBytesFuncs`; hanya yang CommonJS.) */
qrcode.stringToBytes = (t: string) => Array.from(new TextEncoder().encode(t));

const ZONA_TENANG = 4; // modul, minimum spesifikasi QR

export function GambarQr({ isi, ukuran = 192 }: { isi: string; ukuran?: number }) {
  let qr: ReturnType<typeof qrcode>;
  try {
    qr = qrcode(0, 'M');
    qr.addData(isi, 'Byte');
    qr.make();
  } catch {
    return null;
  }
  const n = qr.getModuleCount();
  const total = n + ZONA_TENANG * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; ) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      let akhir = c;
      while (akhir < n && qr.isDark(r, akhir)) akhir++;
      d += `M${c + ZONA_TENANG} ${r + ZONA_TENANG}h${akhir - c}v1h-${akhir - c}z`;
      c = akhir;
    }
  }
  return (
    <svg
      role="img"
      aria-label="Kode QRIS"
      className="kasir-qr"
      width={ukuran}
      height={ukuran}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
    >
      <rect className="kasir-qr-latar" width={total} height={total} />
      <path className="kasir-qr-modul" d={d} />
    </svg>
  );
}

/** Keadaan `memuat`: kerangka seukuran QR selagi kode diminta (spec § 7). */
export function KerangkaQr({ ukuran = 192 }: { ukuran?: number }) {
  return (
    <div
      className="kasir-rangka kasir-qr"
      style={{ width: ukuran, height: ukuran }}
      role="status"
      aria-label="Meminta kode QR"
    />
  );
}
