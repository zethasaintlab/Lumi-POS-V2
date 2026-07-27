/* @ds-bundle: {"format":4,"namespace":"LumiPOSDesignSystem_dae7d1","components":[{"name":"Avatar","sourcePath":"components/data/Avatar.jsx"},{"name":"Badge","sourcePath":"components/data/Badge.jsx"},{"name":"Card","sourcePath":"components/data/Card.jsx"},{"name":"EmptyState","sourcePath":"components/data/EmptyState.jsx"},{"name":"StatCard","sourcePath":"components/data/StatCard.jsx"},{"name":"SyncIndicator","sourcePath":"components/data/SyncIndicator.jsx"},{"name":"Table","sourcePath":"components/data/Table.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Chip","sourcePath":"components/forms/Chip.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"Icon","sourcePath":"components/forms/Icon.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},{"name":"Stepper","sourcePath":"components/forms/Stepper.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"AppShell","sourcePath":"components/navigation/AppShell.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"ConfirmDialog","sourcePath":"components/overlays/ConfirmDialog.jsx"},{"name":"Modal","sourcePath":"components/overlays/Modal.jsx"},{"name":"CartRow","sourcePath":"components/pos/CartRow.jsx"},{"name":"ProductCard","sourcePath":"components/pos/ProductCard.jsx"},{"name":"Ticket","sourcePath":"components/pos/Ticket.jsx"}],"sourceHashes":{"components/data/Avatar.jsx":"6ca1704427ff","components/data/Badge.jsx":"488345e44acd","components/data/Card.jsx":"14140af7c80c","components/data/EmptyState.jsx":"8dcbf931343f","components/data/StatCard.jsx":"2fdad12c3207","components/data/SyncIndicator.jsx":"d709aafad626","components/data/Table.jsx":"9c324ec868d6","components/forms/Button.jsx":"2677cfa5dc02","components/forms/Chip.jsx":"2fadce9ea814","components/forms/Field.jsx":"f48cef0168c2","components/forms/Icon.jsx":"df64a4d6449d","components/forms/SegmentedControl.jsx":"4ed22da1ad67","components/forms/Stepper.jsx":"be3130771cd9","components/forms/Switch.jsx":"c01722d68691","components/navigation/AppShell.jsx":"2cf31f086be7","components/navigation/Tabs.jsx":"f14e8afc33a3","components/overlays/ConfirmDialog.jsx":"b2fbc815c2c0","components/overlays/Modal.jsx":"59d094113d1e","components/pos/CartRow.jsx":"3cfecb056cef","components/pos/ProductCard.jsx":"42211bdc947d","components/pos/Ticket.jsx":"19a8d09e39a5","ui_kits/pos/KasirScreen.jsx":"7c1e013883b4","ui_kits/pos/KdsScreen.jsx":"de2bb804760e","ui_kits/pos/LaporanScreen.jsx":"9b046e72a2a0","ui_kits/pos/TutupKasScreen.jsx":"9ced160ef02a","ui_kits/rekanara/AccessControlScreen.jsx":"e9cad0bfbc5d","ui_kits/rekanara/CustomersScreen.jsx":"ec3b7a5eb6a7","ui_kits/rekanara/DashboardScreen.jsx":"677c245de4c0","ui_kits/rekanara/KdsScreen2.jsx":"4230354c8359","ui_kits/rekanara/LandingScreen.jsx":"dde5e4f1969c","ui_kits/rekanara/PosScreen.jsx":"893b3f35a52a","ui_kits/rekanara/QrStickerScreen.jsx":"101c11355e8a","ui_kits/rekanara/ReservationsScreen.jsx":"70fe41659467","ui_kits/rekanara/SelectTableScreen.jsx":"4694b9c5a245","ui_kits/rekanara/SettingsScreen.jsx":"ead6b5bdf194","ui_kits/rekanara/ShiftScheduleScreen.jsx":"207951111ae1","ui_kits/rekanara/TableManagementScreen.jsx":"44393baf6785","ui_kits/rekanara/TableMonitoringScreen.jsx":"fe4bfbae2660","ui_kits/rekanara/data.js":"be431e6c9145","ui_kits/rekanara/doc-page.js":"371bab66f42d","ui_kits/rekanara/image-slot.js":"fff26d081c8d"},"inlinedExternals":[],"unexposedExports":[{"name":"iconNames","sourcePath":"components/forms/Icon.jsx"}]} */

(() => {

const __ds_ns = (window.LumiPOSDesignSystem_dae7d1 = window.LumiPOSDesignSystem_dae7d1 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/data/Avatar.jsx
try { (() => {
/* Avatar inisial. Ukuran bebas; default aksen-soft. Dipakai di sidebar
   user, profil karyawan, baris customer. */
function Avatar({
  name = '',
  size = 36,
  tone
}) {
  const initials = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.4)
  };
  if (tone) {
    style.background = `var(--${tone}-soft)`;
    style.color = `var(--${tone})`;
  }
  return /*#__PURE__*/React.createElement("span", {
    className: "avatar",
    style: style,
    "aria-hidden": "true"
  }, initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/data/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Badge status. Status TIDAK PERNAH warna saja — `children` (teks) wajib,
   `icon` opsional (dipakai di KDS untuk keterbacaan di bawah glare).
   Warna semantik hanya untuk status, tidak pernah dekoratif. */
function Badge({
  tone = 'neutral',
  icon,
  children,
  className = '',
  ...rest
}) {
  const cls = ['badge', `badge-${tone}`, className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls
  }, rest), icon, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Badge.jsx", error: String((e && e.message) || e) }); }

// components/data/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Kartu — pembeda visual utama adalah border, bukan bayangan. Kafe terang;
   bayangan tebal hilang di bawah glare. `pad` menambah padding standar. */
function Card({
  pad = true,
  className = '',
  children,
  ...rest
}) {
  const cls = ['card', pad ? 'card-pad' : '', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Card.jsx", error: String((e && e.message) || e) }); }

// components/data/EmptyState.jsx
try { (() => {
/* Keadaan kosong — setiap komponen wajib punya ini, bukan grid kosong.
   `action` menawarkan jalan keluar ("Tambah produk pertama"). Untuk KDS
   tanpa order, sertakan `clock` (jam berjalan) agar terbukti layar hidup,
   bukan hang. */
function EmptyState({
  icon,
  title,
  body,
  action,
  clock
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, icon && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--border-strong)'
    }
  }, icon), title && /*#__PURE__*/React.createElement("div", {
    className: "t-title",
    style: {
      color: 'var(--ink-muted)'
    }
  }, title), body && /*#__PURE__*/React.createElement("div", {
    className: "t-body",
    style: {
      maxWidth: '32ch'
    }
  }, body), clock && /*#__PURE__*/React.createElement("div", {
    className: "t-display num",
    style: {
      color: 'var(--ink-subtle)',
      marginTop: 'var(--space-2)'
    }
  }, clock), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-2)'
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/data/Table.jsx
try { (() => {
/* Tabel data dengan zebra baris. Kolom uang wajib rata-kanan + tabular
   (align: 'right' menambah kelas .right). Selalu punya keadaan kosong —
   bedakan "tidak ada data" dari "tidak ada yang cocok dengan filter". */
function Table({
  columns,
  rows,
  empty,
  keyField,
  caption
}) {
  if (!rows || rows.length === 0) {
    return empty || /*#__PURE__*/React.createElement(__ds_scope.EmptyState, {
      title: "Belum ada data"
    });
  }
  return /*#__PURE__*/React.createElement("table", {
    className: "table"
  }, caption && /*#__PURE__*/React.createElement("caption", {
    className: "sr-only"
  }, caption), /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: c.align === 'right' ? {
      textAlign: 'right'
    } : undefined
  }, c.header)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((row, i) => /*#__PURE__*/React.createElement("tr", {
    key: keyField ? row[keyField] : i
  }, columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    className: c.align === 'right' ? 'right' : undefined
  }, c.render ? c.render(row) : row[c.key]))))));
}
Object.assign(__ds_scope, { Table });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Table.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Tombol Lumi. Varian menandai peran, ukuran menandai risiko.
   `critical` = 56px untuk aksi yang menyangkut uang (Bayar, Tutup Kas,
   konfirmasi void) — kasir berdiri, satu tangan, tangan sering basah.
   Aksen dibatasi < 5% area: hanya SATU tombol `primary` per layar. */
function Button({
  variant = 'secondary',
  critical = false,
  fullWidth = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const cls = ['btn', `btn-${variant}`, critical ? 'btn-critical' : '', className].filter(Boolean).join(' ');
  const style = fullWidth ? {
    width: '100%',
    ...(rest.style || {})
  } : rest.style;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    className: cls
  }, rest, {
    style: style
  }), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Chip pilihan tunggal dalam satu grup — kategori katalog, rentang waktu
   laporan. Terpilih = aksen penuh. Tinggi 44px (target sentuh). Pakai di
   dalam grup horizontal yang bisa di-scroll. */
function Chip({
  selected = false,
  children,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: ['chip', className].filter(Boolean).join(' '),
    "aria-pressed": selected
  }, rest), children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Chip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Field teks dengan label + state error opsional. Tinggi minimum 44px
   (target sentuh). `size="lg"` = 56px, angka besar rata kanan — untuk
   input nominal uang (uang diterima, hitungan laci). `prefix` menaruh
   penanda "Rp" di dalam field tanpa mengganggu tabular-nums. */
function Field({
  label,
  id,
  size = 'md',
  error,
  prefix,
  as = 'input',
  className = '',
  required = false,
  ...rest
}) {
  const multiline = as === 'textarea';
  const inputCls = ['field', size === 'lg' ? 'field-lg' : '', error ? 'field-invalid' : '', className].filter(Boolean).join(' ');
  const shared = {
    id,
    className: inputCls,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error && id ? `${id}-err` : undefined,
    ...rest
  };
  const input = multiline ? /*#__PURE__*/React.createElement("textarea", _extends({}, shared, {
    style: {
      minHeight: 80,
      padding: 'var(--space-3)',
      resize: 'vertical',
      lineHeight: 'var(--leading-body)',
      ...(rest.style || {})
    }
  })) : /*#__PURE__*/React.createElement("input", shared);
  return /*#__PURE__*/React.createElement("div", {
    className: "stack"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "label",
    htmlFor: id
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--danger)'
    }
  }, " *")), prefix ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 14,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--ink-subtle)',
      fontSize: 'var(--text-title)'
    }
  }, prefix), React.cloneElement(input, {
    style: {
      paddingLeft: 56,
      ...(rest.style || {})
    }
  })) : input, error && /*#__PURE__*/React.createElement("span", {
    className: "field-error",
    id: id ? `${id}-err` : undefined
  }, error));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/forms/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Ikon Lumi = stroke SVG inline, gaya Lucide: viewBox 24, stroke-width 2,
   round cap/join, tanpa fill. Ukuran mewarisi `currentColor` sehingga ikon
   di dalam badge/tombol otomatis mengikuti warna teksnya.
   Hanya glyph yang benar-benar dipakai POS yang disertakan. */
const PATHS = {
  search: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m20 20-3.5-3.5"
  })),
  'chevron-down': /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  }),
  'chevron-left': /*#__PURE__*/React.createElement("path", {
    d: "m15 18-6-6 6-6"
  }),
  'chevron-right': /*#__PURE__*/React.createElement("path", {
    d: "m9 18 6-6-6-6"
  }),
  alert: /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
  }),
  check: /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }),
  x: /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }),
  plus: /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }),
  minus: /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14"
  }),
  'wifi-off': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M20.6 11.9A15 15 0 0 0 15 7.8M1 1l22 22"
  })),
  refresh: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 12a9 9 0 0 1 15-6.7L21 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 21v-5h5"
  })),
  clock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 7v5l3 2"
  })),
  receipt: /*#__PURE__*/React.createElement("path", {
    d: "M4 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1Zm4 5h8M8 12h8"
  }),
  lock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "4",
    y: "11",
    width: "16",
    height: "10",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 11V7a4 4 0 0 1 8 0v4"
  })),
  // --- nav & modul (produk penuh) ---
  dashboard: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "3",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "14",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "14",
    width: "7",
    height: "7",
    rx: "1"
  })),
  register: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "2",
    y: "3",
    width: "20",
    height: "14",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 21h8M12 17v4"
  })),
  chef: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 13.87A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.87V21H6Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M6 17h12"
  })),
  layers: /*#__PURE__*/React.createElement("path", {
    d: "m12 2 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5"
  }),
  package: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 2 3 7v10l9 5 9-5V7l-9-5Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 7l9 5 9-5M12 12v10"
  })),
  sliders: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M1 14h6M9 8h6M17 16h6"
  })),
  tag: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M20 12 12 20l-9-9V3h8Z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "7.5",
    cy: "7.5",
    r: "1.2"
  })),
  truck: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M1 5h13v12H1zM14 8h4l3 3v6h-7"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "5.5",
    cy: "18.5",
    r: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "17.5",
    cy: "18.5",
    r: "2"
  })),
  clipboard: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "4",
    width: "12",
    height: "17",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 4V3h6v1M9 10h6M9 14h6"
  })),
  file: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 2h8l4 4v16H6Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 2v4h4M9 13h6M9 17h6"
  })),
  gift: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "8",
    width: "18",
    height: "4",
    rx: "1"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 8v13M5 12v9h14v-9M12 8S10 3 7.5 4.5 9.5 8 12 8Zm0 0s2-5 4.5-3.5S14.5 8 12 8Z"
  })),
  book: /*#__PURE__*/React.createElement("path", {
    d: "M4 4a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2ZM4 20a2 2 0 0 1 2-2h13"
  }),
  user: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "8",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 21a8 8 0 0 1 16 0"
  })),
  users: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "8",
    r: "3.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2.5 21a6.5 6.5 0 0 1 13 0M17 5a3.5 3.5 0 0 1 0 6.5M21.5 21a6.5 6.5 0 0 0-4-6"
  })),
  table: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "18",
    height: "16",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 10h18M9 10v10M15 10v10"
  })),
  calendar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "5",
    width: "18",
    height: "16",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 9h18M8 3v4M16 3v4"
  })),
  shield: /*#__PURE__*/React.createElement("path", {
    d: "M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5Z"
  }),
  activity: /*#__PURE__*/React.createElement("path", {
    d: "M3 12h4l3 8 4-16 3 8h4"
  }),
  settings: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H2a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 3.6 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V2a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17.4 3.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"
  })),
  message: /*#__PURE__*/React.createElement("path", {
    d: "M4 4h16v12H8l-4 4Z"
  }),
  image: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "18",
    height: "18",
    rx: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "9",
    r: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m21 15-5-5L5 21"
  })),
  bell: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10 20a2 2 0 0 0 4 0"
  })),
  swap: /*#__PURE__*/React.createElement("path", {
    d: "M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"
  }),
  download: /*#__PURE__*/React.createElement("path", {
    d: "M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"
  }),
  printer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 9V3h12v6M6 18H4v-6h16v6h-2"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "8",
    y: "15",
    width: "8",
    height: "6",
    rx: "1"
  })),
  filter: /*#__PURE__*/React.createElement("path", {
    d: "M3 5h18l-7 8v6l-4-2v-4Z"
  }),
  more: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "5",
    cy: "12",
    r: "1.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "1.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "19",
    cy: "12",
    r: "1.5"
  })),
  edit: /*#__PURE__*/React.createElement("path", {
    d: "M4 20h4L18 10l-4-4L4 16Zm10-14 4 4"
  }),
  coffee: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 8h14v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18 9h2a2 2 0 0 1 0 4h-2M7 4V2M11 4V2M15 4V2"
  })),
  star: /*#__PURE__*/React.createElement("path", {
    d: "m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 21l1.1-6.5L2.6 9.8l6.5-.9Z"
  }),
  phone: /*#__PURE__*/React.createElement("path", {
    d: "M4 4h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2Z"
  }),
  mail: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "5",
    width: "18",
    height: "14",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m3 7 9 6 9-6"
  })),
  'map-pin': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "10",
    r: "3"
  })),
  qr: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "3",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "14",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 14h3v3M20 14v7M14 20h3M20 20h1"
  }))
};
function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  className,
  style,
  ...rest
}) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className,
    style: style,
    "aria-hidden": "true"
  }, rest), glyph);
}
const iconNames = Object.keys(PATHS);
Object.assign(__ds_scope, { Icon, iconNames });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Icon.jsx", error: String((e && e.message) || e) }); }

// components/data/StatCard.jsx
try { (() => {
/* Kartu statistik KPI. Garis-atas aksen menandai identitas modul (tone).
   Angka besar tabular. Delta opsional (naik=success, turun=danger). */
const TONE = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  violet: 'var(--violet)',
  neutral: 'var(--border-strong)'
};
const SOFT = {
  accent: 'var(--accent-soft)',
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)',
  info: 'var(--info-soft)',
  violet: 'var(--violet-soft)',
  neutral: 'var(--surface-alt)'
};
function StatCard({
  label,
  value,
  icon,
  tone = 'accent',
  delta,
  deltaDir,
  hint
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "stat",
    style: {
      '--stat-accent': TONE[tone]
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-caption",
    style: {
      textTransform: 'uppercase',
      letterSpacing: '.04em'
    }
  }, label), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 28,
      height: 28,
      borderRadius: 8,
      background: SOFT[tone],
      color: TONE[tone]
    }
  }, icon)), /*#__PURE__*/React.createElement("div", {
    className: "t-title-lg num"
  }, value), delta != null && /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      marginTop: 2,
      color: deltaDir === 'down' ? 'var(--danger)' : 'var(--success)',
      fontWeight: 'var(--weight-medium)'
    }
  }, deltaDir === 'down' ? '↓' : '↑', " ", delta), hint && /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      marginTop: 2
    }
  }, hint));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/data/SyncIndicator.jsx
try { (() => {
/* Indikator sync — tiga keadaan yang harus bisa dibedakan sekilas, karena
   aplikasi ini offline-first dan sebagian besar waktunya bukan di state
   normal:
     ok      → tenang, tidak menarik perhatian.
     queued  → warning + JUMLAH ("Offline · 3 menunggu").
     failed  → danger + jumlah + TOMBOL tindakan ("Gagal kirim (2) · Coba lagi").
   Fungsi yang memang tidak bisa offline menampilkan ALASANNYA, bukan spinner. */
function SyncIndicator({
  state,
  count,
  onRetry,
  reason
}) {
  if (state === 'ok') {
    return /*#__PURE__*/React.createElement("span", {
      className: "sync sync-ok",
      role: "status"
    }, /*#__PURE__*/React.createElement("span", {
      className: "dot"
    }), " Tersinkron");
  }
  if (state === 'queued') {
    return /*#__PURE__*/React.createElement("span", {
      className: "sync sync-queued",
      role: "status",
      title: `${count} order menunggu dikirim`
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "wifi-off",
      size: 14
    }), " Offline \xB7 ", count, " menunggu");
  }
  if (state === 'offline-only') {
    return /*#__PURE__*/React.createElement("span", {
      className: "sync sync-queued",
      role: "status",
      title: reason
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "wifi-off",
      size: 14
    }), " ", reason || 'Butuh koneksi');
  }
  // failed
  return /*#__PURE__*/React.createElement("span", {
    className: "sync sync-failed",
    role: "status",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "row",
    style: {
      gap: 'var(--space-1)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), " Gagal kirim (", count, ")"), onRetry && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onRetry,
    className: "btn btn-danger",
    style: {
      minHeight: 28,
      padding: '0 var(--space-2)',
      fontSize: 'var(--text-caption)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "refresh",
    size: 13
  }), " Coba lagi"));
}
Object.assign(__ds_scope, { SyncIndicator });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/SyncIndicator.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl.jsx
try { (() => {
/* Segmented control berkotak — pilihan biner/terner yang mengubah mode,
   bukan filter (Dine In / Takeaway). Berbeda dari Chip: tidak memakai
   aksen, tetap netral, karena ini bukan aksi utama layar. */
function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "segmented",
    role: "group",
    "aria-label": ariaLabel
  }, options.map(opt => {
    const val = typeof opt === 'string' ? opt : opt.value;
    const lbl = typeof opt === 'string' ? opt : opt.label;
    return /*#__PURE__*/React.createElement("button", {
      key: val,
      type: "button",
      "aria-pressed": value === val,
      onClick: () => onChange?.(val)
    }, lbl);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/forms/Stepper.jsx
try { (() => {
/* Stepper qty. Tiap tombol tetap 44×44px meski komponennya ringkas —
   tombol kecil di dalam keranjang tetap harus bisa ditekan tangan basah.
   Berhenti di `min` (default 0); di 0 tombol kurang nonaktif, bukan hilang. */
function Stepper({
  value,
  min = 0,
  max = 999,
  onChange,
  label = 'item',
  disabled = false
}) {
  const dec = () => !disabled && value > min && onChange?.(value - 1);
  const inc = () => !disabled && value < max && onChange?.(value + 1);
  return /*#__PURE__*/React.createElement("div", {
    className: "stepper",
    role: "group",
    "aria-label": `Jumlah ${label}`
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: dec,
    disabled: disabled || value <= min,
    "aria-label": `Kurangi ${label}`
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "minus",
    size: 20
  })), /*#__PURE__*/React.createElement("span", {
    className: "num",
    "aria-live": "polite"
  }, value), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: inc,
    disabled: disabled || value >= max,
    "aria-label": `Tambah ${label}`
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "plus",
    size: 20
  })));
}
Object.assign(__ds_scope, { Stepper });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Stepper.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
/* Switch setelan on/off. Track 44px = target sentuh minimum. Selalu
   didampingi label + deskripsi (setelan tidak pernah ikon telanjang). */
function Switch({
  checked = false,
  onChange,
  disabled = false,
  label,
  ariaLabel
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "switch",
    style: disabled ? {
      opacity: .4,
      cursor: 'not-allowed'
    } : undefined
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    role: "switch",
    checked: checked,
    disabled: disabled,
    "aria-label": ariaLabel || (typeof label === 'string' ? label : undefined),
    onChange: e => onChange?.(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", {
    className: "track"
  }), /*#__PURE__*/React.createElement("span", {
    className: "thumb"
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/AppShell.jsx
try { (() => {
/* App shell admin: sidebar berkelompok + topbar breadcrumb + area konten.
   Nav diberikan konsumen (produk ini diturunkan dari alur kerja, bukan dari
   satu-menu-per-tabel). `nav` = daftar { group, items:[{id,label,icon}] }. */
function AppShell({
  brand,
  nav = [],
  active,
  onNavigate,
  user,
  breadcrumb,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "shell"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "shell-side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "shell-brand"
  }, brand?.logo || /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      background: 'var(--accent)',
      color: 'var(--on-accent)',
      display: 'grid',
      placeItems: 'center',
      fontWeight: 600,
      flex: 'none'
    }
  }, (brand?.name || 'R')[0]), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md truncate"
  }, brand?.name || 'The Cafe by ORIGEN')), /*#__PURE__*/React.createElement("nav", {
    className: "shell-nav"
  }, nav.map(grp => /*#__PURE__*/React.createElement("div", {
    key: grp.group || 'top'
  }, grp.group && /*#__PURE__*/React.createElement("div", {
    className: "shell-group"
  }, grp.group), grp.items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.id,
    className: "shell-link",
    "aria-current": active === it.id ? 'page' : undefined,
    onClick: () => onNavigate?.(it.id)
  }, it.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon,
    size: 18
  }), /*#__PURE__*/React.createElement("span", {
    className: "truncate"
  }, it.label)))))), /*#__PURE__*/React.createElement("div", {
    className: "shell-user"
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    name: user?.name || 'User',
    size: 32
  }), /*#__PURE__*/React.createElement("div", {
    className: "grow",
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md truncate"
  }, user?.name || 'User'), user?.role && /*#__PURE__*/React.createElement("div", {
    className: "t-caption truncate"
  }, user.role)), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16
  }))), /*#__PURE__*/React.createElement("main", {
    className: "shell-main"
  }, breadcrumb && /*#__PURE__*/React.createElement("div", {
    className: "shell-top"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "dashboard",
    size: 14
  }), (Array.isArray(breadcrumb) ? breadcrumb : [breadcrumb]).map((b, i, arr) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    style: i === arr.length - 1 ? {
      color: 'var(--ink)'
    } : undefined
  }, b), i < arr.length - 1 && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 12
  })))), /*#__PURE__*/React.createElement("div", {
    className: "shell-body"
  }, children)));
}
Object.assign(__ds_scope, { AppShell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/AppShell.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/* Bilah tab. Dua varian: 'pill' (berkotak, di dalam panel) dan
   'underline' (garis-bawah, untuk header halaman seperti Settings /
   Access Control). Tab aktif = aksen. */
function Tabs({
  tabs,
  value,
  onChange,
  variant = 'pill',
  ariaLabel
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: variant === 'underline' ? 'tabs tabs-underline' : 'tabs',
    role: "tablist",
    "aria-label": ariaLabel
  }, tabs.map(t => {
    const val = typeof t === 'string' ? t : t.value;
    const lbl = typeof t === 'string' ? t : t.label;
    const badge = typeof t === 'object' ? t.badge : undefined;
    return /*#__PURE__*/React.createElement("button", {
      key: val,
      role: "tab",
      "aria-selected": value === val,
      onClick: () => onChange?.(val)
    }, lbl, badge != null && /*#__PURE__*/React.createElement("span", {
      className: "badge badge-accent",
      style: {
        marginLeft: 'var(--space-2)'
      }
    }, badge));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/overlays/ConfirmDialog.jsx
try { (() => {
/* Dialog konfirmasi aksi merusak — berbeda dari dialog biasa. Void, refund,
   dan tutup sesi kas butuh PIN owner + alasan dari DAFTAR TERTUTUP. "Lainnya"
   mewajibkan catatan. Tombol konfirmasi = danger, 56px (aksi menyangkut uang),
   dan nonaktif sampai PIN & alasan terisi. */
const REASONS = ['Salah input', 'Tamu batal', 'Item habis', 'Kualitas', 'Lainnya'];
function ConfirmDialog({
  open = true,
  title,
  description,
  detail,
  pin,
  onPin,
  reason,
  onReason,
  note,
  onNote,
  reasons = REASONS,
  pinError,
  confirmLabel = 'Konfirmasi',
  onConfirm,
  onCancel
}) {
  if (!open) return null;
  const needsNote = reason === 'Lainnya';
  const ready = pin && pin.length >= 4 && reason && (!needsNote || note && note.trim());
  return /*#__PURE__*/React.createElement("div", {
    className: "overlay",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog dialog-danger"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog-pad stack",
    style: {
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-title"
  }, title), description && /*#__PURE__*/React.createElement("div", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)'
    }
  }, description)), detail && /*#__PURE__*/React.createElement("div", {
    className: "card card-pad",
    style: {
      background: 'var(--surface-sunk)',
      boxShadow: 'none'
    }
  }, detail), /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "label",
    style: {
      margin: 0
    }
  }, "Alasan ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--danger)'
    }
  }, "*")), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      flexWrap: 'wrap',
      gap: 'var(--space-2)'
    }
  }, reasons.map(r => /*#__PURE__*/React.createElement(__ds_scope.Chip, {
    key: r,
    selected: reason === r,
    onClick: () => onReason?.(r)
  }, r)))), needsNote && /*#__PURE__*/React.createElement(__ds_scope.Field, {
    label: "Catatan",
    id: "cd-note",
    required: true,
    as: "textarea",
    placeholder: "Wajib diisi untuk alasan Lainnya\u2026",
    value: note || '',
    onChange: e => onNote?.(e.target.value)
  }), /*#__PURE__*/React.createElement(__ds_scope.Field, {
    label: "PIN Owner",
    id: "cd-pin",
    type: "password",
    inputMode: "numeric",
    autoComplete: "off",
    placeholder: "\u2022\u2022\u2022\u2022",
    required: true,
    error: pinError,
    value: pin || '',
    onChange: e => onPin?.(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "dialog-foot"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "ghost",
    fullWidth: true,
    onClick: onCancel
  }, "Batal"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "danger",
    critical: true,
    fullWidth: true,
    disabled: !ready,
    onClick: onConfirm
  }, confirmLabel))));
}
Object.assign(__ds_scope, { ConfirmDialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/ConfirmDialog.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Modal.jsx
try { (() => {
/* Modal umum (bukan aksi merusak — untuk itu pakai ConfirmDialog).
   New Customer, Add Table, dsb. Header + body (children) + footer aksi. */
function Modal({
  open = true,
  title,
  onClose,
  children,
  footer,
  width = 460
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "overlay",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": typeof title === 'string' ? title : undefined,
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "dialog",
    style: {
      maxWidth: width
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-4) var(--space-6)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-title"
  }, title), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    style: {
      minHeight: 36,
      minWidth: 36,
      padding: 0
    },
    onClick: onClose,
    "aria-label": "Tutup"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 18
  }))), /*#__PURE__*/React.createElement("div", {
    className: "dialog-pad stack",
    style: {
      gap: 'var(--space-4)'
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "dialog-foot"
  }, footer)));
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Modal.jsx", error: String((e && e.message) || e) }); }

// components/pos/CartRow.jsx
try { (() => {
/* Baris keranjang. Nama + modifier + harga satuan di kiri; stepper qty +
   subtotal di kanan. Subtotal tabular. Qty 0 memicu onRemove lewat Stepper. */
function rupiah(n) {
  const s = 'Rp ' + Math.abs(n).toLocaleString('id-ID');
  return n < 0 ? '− ' + s : s;
}
function CartRow({
  name,
  modifiers,
  unitPrice,
  qty,
  onQty,
  onRemove
}) {
  const handle = next => {
    if (next <= 0) onRemove?.();else onQty?.(next);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "cart-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow stack",
    style: {
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, name), modifiers && /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, modifiers), /*#__PURE__*/React.createElement("span", {
    className: "t-caption num"
  }, rupiah(unitPrice))), /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-2)',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Stepper, {
    value: qty,
    min: 0,
    onChange: handle,
    label: name
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md num"
  }, rupiah(unitPrice * qty))));
}
Object.assign(__ds_scope, { CartRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/pos/CartRow.jsx", error: String((e && e.message) || e) }); }

// components/pos/ProductCard.jsx
try { (() => {
/* Kartu produk grid kasir. Tinggi 96px diturunkan dari density: min 12
   kartu tanpa scroll di 1024×768 (bukan selera). Nama di-truncate; habis
   diredupkan + badge "Habis" (state, bukan warna saja). */
function rupiah(n) {
  return 'Rp ' + n.toLocaleString('id-ID');
}
function ProductCard({
  name,
  sku,
  price,
  available = true,
  onAdd
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "product-card",
    "data-out": !available,
    onClick: available ? onAdd : undefined,
    "aria-disabled": !available
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body-md truncate",
    style: {
      width: '100%'
    }
  }, name), sku && /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, sku), /*#__PURE__*/React.createElement("span", {
    className: "grow"
  }), /*#__PURE__*/React.createElement("span", {
    className: "row between",
    style: {
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body-md num"
  }, rupiah(price)), !available && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "danger"
  }, "Habis")));
}
Object.assign(__ds_scope, { ProductCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/pos/ProductCard.jsx", error: String((e && e.message) || e) }); }

// components/pos/Ticket.jsx
try { (() => {
/* Tiket KDS. Dibaca dari 2 meter di dalam .kds-scale (semua teks ×1.6).
   Nomor order = display, nama item = title. Fulfillment dilacak PER ITEM
   (checkbox), status order diturunkan darinya ("1 dari 2 item selesai").
   Keterlambatan ditandai border + ikon + teks, bukan warna saja. */
function Ticket({
  code,
  orderNo,
  orderType,
  waited,
  late = false,
  items,
  doneCount,
  primaryLabel,
  onPrimary,
  status
}) {
  return /*#__PURE__*/React.createElement("article", {
    className: "ticket",
    "data-late": late
  }, /*#__PURE__*/React.createElement("div", {
    className: "ticket-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-display num"
  }, code), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md num"
  }, waited), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, orderNo, " \xB7 ", orderType))), /*#__PURE__*/React.createElement("div", {
    className: "ticket-items"
  }, items.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: `item${it.done ? ' done' : ''}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "qty t-title num"
  }, it.qty, "\xD7"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-title"
  }, it.name), it.note && /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, it.note))))), /*#__PURE__*/React.createElement("div", {
    className: "ticket-foot stack",
    style: {
      gap: 'var(--space-2)'
    }
  }, late && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "warning",
    icon: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "alert",
      size: 14
    })
  }, "Lewat 10 menit"), status === 'ready' && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "success",
    icon: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "check",
      size: 14
    })
  }, "Siap diantar"), typeof doneCount === 'number' && /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, doneCount, " dari ", items.length, " item selesai"), primaryLabel && /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: status === 'processing' ? 'secondary' : 'primary',
    fullWidth: true,
    onClick: onPrimary
  }, primaryLabel)));
}
Object.assign(__ds_scope, { Ticket });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/pos/Ticket.jsx", error: String((e && e.message) || e) }); }

// ui_kits/pos/KasirScreen.jsx
try { (() => {
// Kasir — layar terpadat. Target utama tablet counter 1024×768.
// Keranjang = kolom kanan tetap di ≥900px; jadi bottom sheet di HP.
const {
  ProductCard,
  CartRow,
  SegmentedControl,
  Chip,
  Button,
  SyncIndicator,
  Icon
} = window.LumiPOSDesignSystem_dae7d1;
const PRODUK = [['Americano', 'KOP-01', 8000, 1, 'Kopi'], ['Cappuccino', 'KOP-02', 22000, 1, 'Kopi'], ['Latte', 'KOP-03', 24000, 1, 'Kopi'], ['Espresso', 'KOP-04', 15000, 1, 'Kopi'], ['Kopi Susu Gula Aren', 'KOP-05', 25000, 1, 'Kopi'], ['V60 Single Origin', 'KOP-06', 32000, 1, 'Kopi'], ['Matcha Latte', 'NKP-01', 28000, 1, 'Non-Kopi'], ['Chocolate', 'NKP-02', 24000, 1, 'Non-Kopi'], ['Lemon Tea', 'NKP-03', 18000, 1, 'Non-Kopi'], ['Butter Croissant', 'PST-01', 22000, 1, 'Pastry'], ['Pain au Chocolat', 'PST-02', 26000, 0, 'Pastry'], ['Cinnamon Roll', 'PST-03', 24000, 1, 'Pastry'], ['Nasi Goreng Kampung', 'MKN-01', 35000, 1, 'Makanan'], ['Chicken Sandwich', 'MKN-02', 38000, 1, 'Makanan'], ['French Fries', 'MKN-03', 20000, 1, 'Makanan'], ['Banana Bread', 'PST-04', 19000, 1, 'Pastry']];
const CATS = ['Semua', 'Kopi', 'Non-Kopi', 'Makanan', 'Pastry'];
const rupiah = n => 'Rp ' + n.toLocaleString('id-ID');
function KasirScreen() {
  const [cat, setCat] = React.useState('Semua');
  const [mode, setMode] = React.useState('Dine In');
  const [q, setQ] = React.useState('');
  const [cart, setCart] = React.useState([{
    name: 'Americano',
    mod: 'Extra shot · Less ice',
    price: 13000,
    qty: 2
  }, {
    name: 'Butter Croissant',
    mod: 'Dipanaskan',
    price: 22000,
    qty: 1
  }]);
  const add = (name, price) => setCart(c => {
    const i = c.findIndex(x => x.name === name && !x.mod);
    if (i >= 0) {
      const n = [...c];
      n[i] = {
        ...n[i],
        qty: n[i].qty + 1
      };
      return n;
    }
    return [...c, {
      name,
      price,
      qty: 1
    }];
  });
  const setQty = (idx, qty) => setCart(c => c.map((x, i) => i === idx ? {
    ...x,
    qty
  } : x));
  const remove = idx => setCart(c => c.filter((_, i) => i !== idx));
  const items = PRODUK.filter(([n, sku,,, c]) => (cat === 'Semua' || c === cat) && (!q || n.toLowerCase().includes(q.toLowerCase()) || sku.toLowerCase().includes(q.toLowerCase())));
  const count = cart.reduce((s, x) => s + x.qty, 0);
  const subtotal = cart.reduce((s, x) => s + x.price * x.qty, 0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--surface-sunk)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-2) var(--space-3)',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--ink-subtle)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  })), /*#__PURE__*/React.createElement("input", {
    className: "field",
    style: {
      paddingLeft: 40
    },
    type: "search",
    placeholder: "Cari nama produk atau SKU\u2026",
    value: q,
    onChange: e => setQ(e.target.value),
    "aria-label": "Cari produk"
  })), /*#__PURE__*/React.createElement(SyncIndicator, {
    state: "queued",
    count: 3
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary"
  }, "Sesi: Andi \xB7 07:02")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flex: 1,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    },
    "aria-label": "Katalog produk"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-2)',
      padding: 'var(--space-3)',
      overflowX: 'auto',
      flex: 'none'
    }
  }, CATS.map(c => /*#__PURE__*/React.createElement(Chip, {
    key: c,
    selected: cat === c,
    onClick: () => setCat(c)
  }, c))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '0 var(--space-3) var(--space-3)',
      display: 'grid',
      gap: 'var(--space-2)',
      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
      alignContent: 'start'
    }
  }, items.map(([n, sku, h, ada]) => /*#__PURE__*/React.createElement(ProductCard, {
    key: sku,
    name: n,
    sku: sku,
    price: h,
    available: !!ada,
    onAdd: () => add(n, h)
  })))), /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 380,
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)'
    },
    "aria-label": "Keranjang"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-3)',
      borderBottom: '1px solid var(--border)',
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-title"
  }, "Keranjang"), /*#__PURE__*/React.createElement(SegmentedControl, {
    options: ['Dine In', 'Takeaway'],
    value: mode,
    onChange: setMode,
    ariaLabel: "Tipe pesanan"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    style: {
      width: '100%',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Meja A04 \u2014 Dekat Pintu"), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '0 var(--space-3)'
    }
  }, cart.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "receipt",
    size: 32
  }), /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      color: 'var(--ink-muted)'
    }
  }, "Keranjang kosong"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Pilih produk dari katalog")) : cart.map((x, i) => /*#__PURE__*/React.createElement(CartRow, {
    key: i,
    name: x.name,
    modifiers: x.mod,
    unitPrice: x.price,
    qty: x.qty,
    onQty: qt => setQty(i, qt),
    onRemove: () => remove(i)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-3)',
      borderTop: '1px solid var(--border)',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      color: 'var(--ink-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Subtotal (", count, " item)"), /*#__PURE__*/React.createElement("span", null, rupiah(subtotal))), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      color: 'var(--ink-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Diskon"), /*#__PURE__*/React.createElement("span", null, "\u2212 Rp 0")), /*#__PURE__*/React.createElement("div", {
    className: "row between t-title"
  }, /*#__PURE__*/React.createElement("span", null, "Total"), /*#__PURE__*/React.createElement("span", null, rupiah(subtotal)))), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true
  }, "Open Bill"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true
  }, "Diskon")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    critical: true,
    fullWidth: true,
    disabled: cart.length === 0,
    style: {
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Bayar"), /*#__PURE__*/React.createElement("span", {
    className: "num"
  }, rupiah(subtotal)))))));
}
window.KasirScreen = KasirScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/pos/KasirScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/pos/KdsScreen.jsx
try { (() => {
// Kitchen Display — monitor dapur 1920×1080, tanpa login, dibaca dari 2 m.
// Seluruh layar dalam .kds-scale (--scale 1.6). Fulfillment per item.
const {
  Ticket,
  Badge,
  Icon,
  EmptyState
} = window.LumiPOSDesignSystem_dae7d1;
function Clock() {
  const [t, setT] = React.useState(() => new Date().toLocaleTimeString('id-ID', {
    hour12: false
  }));
  React.useEffect(() => {
    const id = setInterval(() => setT(new Date().toLocaleTimeString('id-ID', {
      hour12: false
    })), 1000);
    return () => clearInterval(id);
  }, []);
  return /*#__PURE__*/React.createElement("span", {
    className: "t-body num"
  }, t);
}
function Col({
  title,
  count,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      padding: '0 var(--space-1) var(--space-3)',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, title), /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      minWidth: 32,
      height: 32,
      display: 'grid',
      placeItems: 'center',
      padding: '0 8px',
      borderRadius: 999,
      background: 'var(--surface-alt)',
      fontSize: 'var(--text-caption)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--ink-muted)'
    }
  }, count)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }
  }, children));
}
function KdsScreen() {
  return /*#__PURE__*/React.createElement("div", {
    className: "kds-scale",
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--surface-sunk)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-title"
  }, "Kitchen Display"), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    icon: /*#__PURE__*/React.createElement("span", {
      className: "dot"
    })
  }, "Tersambung"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Clock, null)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 'var(--space-3)',
      padding: 'var(--space-3)',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(Col, {
    title: "Mengantre",
    count: 2
  }, /*#__PURE__*/React.createElement(Ticket, {
    code: "A04",
    orderNo: "ORD-0231",
    orderType: "Dine In",
    waited: "12m 04s",
    late: true,
    items: [{
      qty: 2,
      name: 'Americano',
      note: 'Extra shot · Less ice'
    }, {
      qty: 1,
      name: 'Butter Croissant',
      note: 'Dipanaskan'
    }],
    status: "queued",
    primaryLabel: "Mulai Proses"
  }), /*#__PURE__*/React.createElement(Ticket, {
    code: "TA-7",
    orderNo: "ORD-0232",
    orderType: "Takeaway",
    waited: "1m 46s",
    items: [{
      qty: 1,
      name: 'Kopi Susu Gula Aren'
    }],
    status: "queued",
    primaryLabel: "Mulai Proses"
  })), /*#__PURE__*/React.createElement(Col, {
    title: "Diproses",
    count: 1
  }, /*#__PURE__*/React.createElement(Ticket, {
    code: "A01",
    orderNo: "ORD-0230",
    orderType: "Dine In",
    waited: "3m 12s",
    items: [{
      qty: 1,
      name: 'Latte',
      done: true
    }, {
      qty: 1,
      name: 'Nasi Goreng Kampung',
      note: 'Tidak pedas'
    }],
    doneCount: 1,
    status: "processing",
    primaryLabel: "Tandai Semua Siap"
  })), /*#__PURE__*/React.createElement(Col, {
    title: "Siap",
    count: 1
  }, /*#__PURE__*/React.createElement(Ticket, {
    code: "A02",
    orderNo: "ORD-0229",
    orderType: "Dine In",
    waited: "0m 18s",
    items: [{
      qty: 2,
      name: 'Cappuccino'
    }],
    status: "ready",
    primaryLabel: "Sudah Diserahkan"
  }))));
}
window.KdsScreen = KdsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/pos/KdsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/pos/LaporanScreen.jsx
try { (() => {
// Laporan — owner buka HP jam 23:00. Mobile-first; anomali di ATAS, grafik di bawah.
const {
  Card,
  Chip,
  Badge
} = window.LumiPOSDesignSystem_dae7d1;
const KPI = ({
  label,
  value,
  delta,
  dir
}) => /*#__PURE__*/React.createElement(Card, {
  className: "kpi"
}, /*#__PURE__*/React.createElement("div", {
  className: "t-caption"
}, label), /*#__PURE__*/React.createElement("div", {
  className: "v t-display num",
  style: {
    margin: 'var(--space-1) 0 2px'
  }
}, value), /*#__PURE__*/React.createElement("div", {
  className: "delta",
  style: {
    fontSize: 'var(--text-caption)',
    fontWeight: 'var(--weight-medium)',
    color: dir === 'up' ? 'var(--success)' : 'var(--danger)'
  }
}, dir === 'up' ? '↑' : '↓', " ", delta));
const Rank = ({
  badge,
  tone,
  title,
  sub
}) => /*#__PURE__*/React.createElement("div", {
  className: "row",
  style: {
    gap: 'var(--space-3)',
    padding: 'var(--space-3) 0',
    borderBottom: '1px solid var(--border)',
    alignItems: 'flex-start'
  }
}, /*#__PURE__*/React.createElement(Badge, {
  tone: tone
}, badge), /*#__PURE__*/React.createElement("div", {
  className: "grow"
}, /*#__PURE__*/React.createElement("div", {
  className: "t-body"
}, title), /*#__PURE__*/React.createElement("div", {
  className: "t-caption"
}, sub)));
const BARS = [['08', 22], ['10', 38], ['12', 55], ['14', 42], ['15', 100], ['17', 71], ['19', 48], ['21', 26]];
const TOP = [['Kopi Susu Gula Aren', '31 terjual · Rp 775.000'], ['Americano', '24 terjual · Rp 192.000'], ['Butter Croissant', '19 terjual · Rp 418.000'], ['Matcha Latte', '15 terjual · Rp 420.000'], ['Nasi Goreng Kampung', '12 terjual · Rp 420.000']];
function LaporanScreen() {
  const [range, setRange] = React.useState('Hari ini');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: 'var(--space-4) var(--space-3) var(--space-12)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    className: "t-title",
    style: {
      margin: '0 0 var(--space-1)'
    }
  }, "Laporan"), /*#__PURE__*/React.createElement("p", {
    className: "t-caption",
    style: {
      margin: 0
    }
  }, "The Cafe by ORIGEN \xB7 hari bisnis 26 Juli 2026 (04:00\u201304:00)")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-2)',
      overflowX: 'auto',
      marginBottom: 'var(--space-4)'
    }
  }, ['Hari ini', '7 hari', '30 hari', 'Pilih tanggal'].map(r => /*#__PURE__*/React.createElement(Chip, {
    key: r,
    selected: range === r,
    onClick: () => setRange(r)
  }, r))), /*#__PURE__*/React.createElement("div", {
    className: "lap-kpis"
  }, /*#__PURE__*/React.createElement(KPI, {
    label: "Penjualan neto",
    value: "Rp 3.501.000",
    delta: "12% vs kemarin",
    dir: "up"
  }), /*#__PURE__*/React.createElement(KPI, {
    label: "Transaksi",
    value: "86",
    delta: "7% vs kemarin",
    dir: "up"
  }), /*#__PURE__*/React.createElement(KPI, {
    label: "Rata-rata / transaksi",
    value: "Rp 40.709",
    delta: "4%",
    dir: "up"
  }), /*#__PURE__*/React.createElement(KPI, {
    label: "Profit kasar",
    value: "Rp 1.918.000",
    delta: "3% vs kemarin",
    dir: "down"
  })), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      margin: 'var(--space-4) 0',
      borderColor: 'var(--warning)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "Perlu perhatian"), /*#__PURE__*/React.createElement(Badge, {
    tone: "warning"
  }, "3 hal")), /*#__PURE__*/React.createElement(Rank, {
    badge: "Oversell",
    tone: "danger",
    title: /*#__PURE__*/React.createElement(React.Fragment, null, "Butter Croissant \u2014 stok jadi ", /*#__PURE__*/React.createElement("span", {
      className: "num"
    }, "\u22121")),
    sub: "14:12 \xB7 dua kasir menjual item terakhir saat offline (K1 & K2)"
  }), /*#__PURE__*/React.createElement(Rank, {
    badge: "Selisih kas",
    tone: "danger",
    title: /*#__PURE__*/React.createElement(React.Fragment, null, "Kas kurang ", /*#__PURE__*/React.createElement("span", {
      className: "num"
    }, "Rp 8.000")),
    sub: '22:04 · sesi Andi · "kembalian kurang hitung sore"'
  }), /*#__PURE__*/React.createElement(Rank, {
    badge: "Refund",
    tone: "warning",
    title: /*#__PURE__*/React.createElement(React.Fragment, null, "2 refund tunai \xB7 ", /*#__PURE__*/React.createElement("span", {
      className: "num"
    }, "Rp 33.000")),
    sub: "Alasan: salah input (1), kualitas (1) \xB7 diotorisasi Dimas"
  })), /*#__PURE__*/React.createElement("div", {
    className: "lap-grid2"
  }, /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      marginBottom: 'var(--space-1)'
    }
  }, "Penjualan per jam"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, "Puncak 15:00\u201316:00"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 'var(--space-2)',
      height: 140,
      paddingTop: 'var(--space-2)'
    },
    role: "img",
    "aria-label": "Grafik penjualan per jam, puncak pukul 15.00"
  }, BARS.map(([h, pct]) => /*#__PURE__*/React.createElement("div", {
    key: h,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: pct + '%',
      background: 'var(--accent-soft)',
      borderRadius: '4px 4px 0 0',
      borderTop: '3px solid var(--accent)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-caption num"
  }, h))))), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, "Produk terlaris"), TOP.map(([n, s], i) => /*#__PURE__*/React.createElement("div", {
    key: n,
    className: "row",
    style: {
      gap: 'var(--space-3)',
      padding: 'var(--space-3) 0',
      borderBottom: i < TOP.length - 1 ? '1px solid var(--border)' : 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      width: 24,
      height: 24,
      borderRadius: 6,
      background: 'var(--surface-alt)',
      display: 'grid',
      placeItems: 'center',
      fontSize: 'var(--text-caption)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--ink-muted)',
      flex: 'none'
    }
  }, i + 1), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body"
  }, n), /*#__PURE__*/React.createElement("div", {
    className: "t-caption num"
  }, s)))))), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      marginTop: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, "Metode pembayaran"), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) 0',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body"
  }, "Tunai"), /*#__PURE__*/React.createElement("span", {
    className: "t-body num"
  }, "Rp 1.555.000")), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) 0',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body"
  }, "QRIS"), /*#__PURE__*/React.createElement("span", {
    className: "t-body num"
  }, "Rp 1.242.000")), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body"
  }, "Kartu"), /*#__PURE__*/React.createElement("span", {
    className: "t-body num"
  }, "Rp 704.000"))));
}
window.LaporanScreen = LaporanScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/pos/LaporanScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/pos/TutupKasScreen.jsx
try { (() => {
// Tutup Kas — hitung fisik DULU, angka sistem menyusul. Form bertahap.
// Panel selisih tiga keadaan (kurang/lebih/pas). Menutup butuh PIN owner.
const {
  Card,
  Field,
  Button,
  Badge,
  Icon,
  ConfirmDialog
} = window.LumiPOSDesignSystem_dae7d1;
const StepBadge = ({
  n,
  done
}) => /*#__PURE__*/React.createElement("span", {
  style: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: done ? 'var(--success)' : 'var(--accent)',
    color: 'var(--on-accent)',
    display: 'grid',
    placeItems: 'center',
    fontSize: 'var(--text-caption)',
    fontWeight: 'var(--weight-medium)',
    flex: 'none'
  }
}, n);
const KV = ({
  k,
  sub,
  v,
  strong
}) => /*#__PURE__*/React.createElement("div", {
  className: "row between",
  style: {
    gap: 'var(--space-4)',
    padding: 'var(--space-3) 0',
    borderBottom: '1px solid var(--border)'
  }
}, /*#__PURE__*/React.createElement("span", {
  className: strong ? 't-body-md' : 't-body'
}, k, sub && /*#__PURE__*/React.createElement("span", {
  className: "t-caption"
}, " \xB7 ", sub)), /*#__PURE__*/React.createElement("span", {
  className: 'num ' + (strong ? 't-body-md' : 't-body')
}, v));
function TutupKasScreen() {
  const [counted] = React.useState('1.847.000');
  const [note, setNote] = React.useState('');
  const [confirm, setConfirm] = React.useState(false);
  const [pin, setPin] = React.useState('');
  const [reason, setReason] = React.useState('');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 720,
      margin: '0 auto',
      padding: 'var(--space-4) var(--space-3) var(--space-12)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      marginBottom: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    style: {
      padding: '0 var(--space-2)',
      minHeight: 32,
      marginBottom: 'var(--space-1)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 16
  }), " Kembali"), /*#__PURE__*/React.createElement("h1", {
    className: "t-title",
    style: {
      margin: '0 0 var(--space-1)'
    }
  }, "Tutup Kas"), /*#__PURE__*/React.createElement("p", {
    className: "t-caption",
    style: {
      margin: 0
    }
  }, "Sesi dibuka Andi \xB7 07:02 \xB7 Register K1 \xB7 berjalan 14j 58m")), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(StepBadge, {
    n: 1
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md"
  }, "Hitung uang fisik di laci"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Hitung dulu, baru sistem menampilkan angkanya."))), /*#__PURE__*/React.createElement(Field, {
    label: "Total uang tunai yang dihitung",
    id: "counted",
    size: "lg",
    prefix: "Rp",
    inputMode: "numeric",
    defaultValue: counted
  }), /*#__PURE__*/React.createElement("p", {
    className: "t-caption",
    style: {
      margin: 'var(--space-3) 0 0',
      padding: 'var(--space-3)',
      background: 'var(--surface-sunk)',
      borderRadius: 'var(--radius-control)'
    }
  }, "Angka ekspektasi sistem sengaja disembunyikan sampai kolom ini terisi. Kalau ditampilkan lebih dulu, hitungan fisik cenderung disesuaikan agar cocok \u2014 dan selisih yang seharusnya ketahuan jadi tidak pernah muncul.")), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(StepBadge, {
    n: 2,
    done: true
  }), /*#__PURE__*/React.createElement("div", {
    className: "t-body-md"
  }, "Perbandingan")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(KV, {
    k: "Modal awal",
    v: "Rp 300.000"
  }), /*#__PURE__*/React.createElement(KV, {
    k: "Penjualan tunai",
    sub: "47 transaksi",
    v: "Rp 1.588.000"
  }), /*#__PURE__*/React.createElement(KV, {
    k: "Refund tunai",
    sub: "2 transaksi",
    v: "\u2212 Rp 33.000"
  }), /*#__PURE__*/React.createElement(KV, {
    k: "Kas diharapkan",
    v: "Rp 1.855.000",
    strong: true
  }), /*#__PURE__*/React.createElement(KV, {
    k: "Uang dihitung",
    v: "Rp 1.847.000"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 'var(--radius-card)',
      padding: 'var(--space-4)',
      border: '1px solid var(--danger-border)',
      background: 'var(--danger-soft)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      alignItems: 'baseline',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      color: 'var(--danger)'
    }
  }, "Selisih \u2014 kas kurang"), /*#__PURE__*/React.createElement("div", {
    className: "t-display num",
    style: {
      color: 'var(--danger)'
    }
  }, "\u2212 Rp 8.000")), /*#__PURE__*/React.createElement(Badge, {
    tone: "danger"
  }, "Wajib diberi catatan"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Field, {
    as: "textarea",
    label: "Catatan selisih",
    id: "note",
    required: true,
    value: note,
    onChange: e => setNote(e.target.value),
    placeholder: "Contoh: kembalian kurang hitung sore, sudah dicek CCTV jam 16.40"
  }))), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, "Non-tunai ", /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "\xB7 tidak masuk hitungan selisih")), /*#__PURE__*/React.createElement(KV, {
    k: "QRIS",
    sub: "31 transaksi",
    v: "Rp 1.242.000"
  }), /*#__PURE__*/React.createElement(KV, {
    k: "Kartu",
    sub: "8 transaksi",
    v: "Rp 704.000"
  })), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      marginBottom: 'var(--space-4)',
      borderColor: 'var(--warning)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-3)',
      color: 'var(--warning)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 20
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md",
    style: {
      color: 'var(--ink)'
    }
  }, "Perlu diselesaikan sebelum menutup")), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) 0',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body"
  }, "2 open bill belum dibayar ", /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "\xB7 Meja A02, A05")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    style: {
      minHeight: 38
    }
  }, "Lihat")), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body"
  }, "3 order belum tersinkron ", /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "\xB7 menunggu koneksi")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    style: {
      minHeight: 38
    }
  }, "Coba kirim"))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    critical: true,
    fullWidth: true,
    onClick: () => setConfirm(true)
  }, "Tutup Sesi Kas"), /*#__PURE__*/React.createElement("p", {
    className: "t-caption",
    style: {
      textAlign: 'center',
      marginTop: 'var(--space-3)'
    }
  }, "Sesi yang sudah ditutup tidak dapat diedit. Koreksi memerlukan sesi penyesuaian baru."), /*#__PURE__*/React.createElement(ConfirmDialog, {
    open: confirm,
    title: "Tutup sesi kas dengan selisih \u2212 Rp 8.000?",
    description: "Sesi terkunci setelah ditutup. Butuh PIN owner untuk mengesahkan selisih.",
    detail: /*#__PURE__*/React.createElement("div", {
      className: "row between"
    }, /*#__PURE__*/React.createElement("span", {
      className: "t-body-md"
    }, "Selisih kas"), /*#__PURE__*/React.createElement("span", {
      className: "t-body-md num",
      style: {
        color: 'var(--danger)'
      }
    }, "\u2212 Rp 8.000")),
    reason: reason,
    onReason: setReason,
    pin: pin,
    onPin: setPin,
    confirmLabel: "Tutup Sesi",
    onCancel: () => setConfirm(false),
    onConfirm: () => setConfirm(false)
  }));
}
window.TutupKasScreen = TutupKasScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/pos/TutupKasScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/AccessControlScreen.jsx
try { (() => {
// Access Control — profil karyawan + analisis kepatuhan. (dalam AppShell)
const {
  Card,
  Tabs,
  Button,
  Avatar,
  Icon,
  StatCard
} = window.LumiPOSDesignSystem_dae7d1;
function AccessControlScreen() {
  const [tab, setTab] = React.useState('Users');
  const [sub, setSub] = React.useState('Analisis');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "t-heading",
    style: {
      margin: '0 0 var(--space-1)'
    }
  }, "Access Control Management"), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-4)'
    }
  }, "Manage users, define roles, and assign granular permissions across the system."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    variant: "underline",
    value: tab,
    onChange: setTab,
    tabs: ['Users', 'Roles', 'Permissions']
  })), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    style: {
      minHeight: 36,
      padding: '0 var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 16
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-title-lg"
  }, "Profil Karyawan"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Detail informasi, kehadiran, dan analisis kepatuhan."))), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "edit",
    size: 16
  }), " Edit User")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '280px 1fr',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      alignItems: 'center',
      gap: 'var(--space-2)',
      paddingBottom: 'var(--space-4)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Super Admin User",
    size: 88
  }), /*#__PURE__*/React.createElement("div", {
    className: "t-title",
    style: {
      marginTop: 'var(--space-2)'
    }
  }, "Super Admin User"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption num"
  }, "1001"), /*#__PURE__*/React.createElement("span", {
    className: "badge badge-neutral"
  }, "Super Admin")), /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-3)',
      paddingTop: 'var(--space-4)'
    }
  }, [['mail', 'superadmin@example.com'], ['phone', '081234567890'], ['calendar', 'Bergabung: -'], ['map-pin', '901 Sheila Island Lake, Ofeliafort, CT 82248-8267']].map(([ic, tx]) => /*#__PURE__*/React.createElement("div", {
    key: tx,
    className: "row",
    style: {
      gap: 'var(--space-2)',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-subtle)',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    className: "t-body"
  }, tx))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    variant: "underline",
    value: sub,
    onChange: setSub,
    tabs: [{
      value: 'Analisis',
      label: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
        name: "activity",
        size: 14
      }), " Analisis")
    }, {
      value: 'Kehadiran',
      label: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
        name: "clock",
        size: 14
      }), " Kehadiran")
    }, {
      value: 'Jadwal',
      label: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
        name: "calendar",
        size: 14
      }), " Jadwal Shift")
    }, {
      value: 'Cuti',
      label: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
        name: "file",
        size: 14
      }), " Cuti & Izin")
    }, {
      value: 'Profil',
      label: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
        name: "user",
        size: 14
      }), " Detail Profil")
    }]
  })), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      background: 'var(--success-soft)',
      borderColor: 'var(--success-border)',
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--success)',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 20
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      color: 'var(--success)'
    }
  }, "Status Kepatuhan: Good"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Semua metrik kehadiran dan cuti dalam kondisi baik. \u2713")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Tingkat Kehadiran",
    value: "100%",
    tone: "success",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "activity",
      size: 16
    }),
    hint: "Dari 0 jadwal bulan ini"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Keterlambatan",
    value: "0x",
    tone: "accent",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "clock",
      size: 16
    }),
    hint: "Bulan ini (Toleransi 15m)"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Absen / Mangkir",
    value: "0x",
    tone: "warning",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "alert",
      size: 16
    }),
    hint: "Tanpa keterangan bulan ini"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Sisa Cuti",
    value: "12 / 12",
    tone: "violet",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "calendar",
      size: 16
    }),
    hint: "Belum eligible cuti tahunan"
  })))));
}
window.AccessControlScreen = AccessControlScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/AccessControlScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/CustomersScreen.jsx
try { (() => {
// Customers — daftar + modal New Customer. (dalam AppShell)
const {
  Card,
  Button,
  Modal,
  Field,
  Icon,
  EmptyState,
  Avatar
} = window.LumiPOSDesignSystem_dae7d1;
const SAMPLE = [{
  name: 'Rara Anjani',
  phone: '0812 3456 7890',
  visits: 8,
  spent: 'Rp 412.000',
  last: '24 Jul 2026',
  source: 'POS'
}, {
  name: 'Dimas Prawira',
  phone: '0857 1122 3344',
  visits: 3,
  spent: 'Rp 138.000',
  last: '21 Jul 2026',
  source: 'QR Order'
}];
function CustomersScreen() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const rows = SAMPLE.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-1)'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    className: "t-heading",
    style: {
      margin: 0
    }
  }, "Customers"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => setOpen(true)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 16
  }), " Add Customer")), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-4)'
    }
  }, "Manage your customer database."), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      marginBottom: 'var(--space-4)',
      maxWidth: 420
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--ink-subtle)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  })), /*#__PURE__*/React.createElement("input", {
    className: "field",
    style: {
      paddingLeft: 40
    },
    placeholder: "Search by name, phone, or email\u2026",
    value: q,
    onChange: e => setQ(e.target.value)
  })), /*#__PURE__*/React.createElement(Card, {
    pad: false
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '2fr 1.4fr .8fr 1fr 1fr .8fr',
      gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border)'
    }
  }, ['Customer', 'Phone', 'Visits', 'Spent', 'Last Visit', 'Source'].map(h => /*#__PURE__*/React.createElement("span", {
    key: h,
    className: "t-caption"
  }, h))), rows.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "users",
      size: 32
    }),
    title: q ? 'Tidak ada yang cocok' : 'Belum ada customer',
    body: q ? 'Coba kata kunci lain.' : 'Tambah customer pertama.'
  }) : rows.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.name,
    style: {
      display: 'grid',
      gridTemplateColumns: '2fr 1.4fr .8fr 1fr 1fr .8fr',
      gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: c.name,
    size: 32
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md truncate"
  }, c.name)), /*#__PURE__*/React.createElement("span", {
    className: "t-body num"
  }, c.phone), /*#__PURE__*/React.createElement("span", {
    className: "t-body num"
  }, c.visits), /*#__PURE__*/React.createElement("span", {
    className: "t-body num"
  }, c.spent), /*#__PURE__*/React.createElement("span", {
    className: "t-body num"
  }, c.last), /*#__PURE__*/React.createElement("span", {
    className: "badge badge-neutral"
  }, c.source)))), /*#__PURE__*/React.createElement(Modal, {
    open: open,
    title: "New Customer",
    onClose: () => setOpen(false),
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      fullWidth: true,
      onClick: () => setOpen(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      fullWidth: true,
      onClick: () => setOpen(false)
    }, "Create Customer"))
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Name",
    id: "c-name",
    required: true,
    placeholder: "Customer name"
  }), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Phone",
    id: "c-phone",
    placeholder: "08xxxxxxxx",
    inputMode: "tel"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Email",
    id: "c-email",
    placeholder: "email@example.com",
    type: "email"
  })), /*#__PURE__*/React.createElement("p", {
    className: "t-caption",
    style: {
      margin: 0
    }
  }, "At least one of phone or email is required. Existing customers with the same phone/email will be automatically matched."), /*#__PURE__*/React.createElement(Field, {
    label: "Address",
    id: "c-addr",
    as: "textarea",
    placeholder: "Address (optional)"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Notes",
    id: "c-notes",
    as: "textarea",
    placeholder: "Internal notes (optional)"
  })));
}
window.CustomersScreen = CustomersScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/CustomersScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/DashboardScreen.jsx
try { (() => {
// Dashboard — sambutan + absensi hari ini + ringkasan shift. (dalam AppShell)
const {
  Card,
  Button,
  StatCard,
  Icon,
  Badge
} = window.LumiPOSDesignSystem_dae7d1;
function DashboardScreen() {
  const [clockedIn, setClockedIn] = React.useState(false);
  const days = Array.from({
    length: 30
  }, (_, i) => i + 1);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1080
    }
  }, /*#__PURE__*/React.createElement("h1", {
    className: "t-heading",
    style: {
      margin: '0 0 var(--space-1)'
    }
  }, "Dashboard"), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-6)'
    }
  }, "Welcome, ", /*#__PURE__*/React.createElement("strong", {
    style: {
      fontWeight: 'var(--weight-medium)',
      color: 'var(--ink)'
    }
  }, "Super Admin User"), "! Here is a summary of your schedules & activities."), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      background: 'var(--accent-soft)',
      borderColor: 'var(--accent-border)',
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      gap: 'var(--space-4)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 10,
      background: 'var(--surface)',
      color: 'var(--accent)',
      display: 'grid',
      placeItems: 'center',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 20
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md"
  }, "Today's Attendance"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, clockedIn ? 'Sesi kerja berjalan sejak 07:02.' : 'Please click Clock In to start or continue your work session.'))), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: clockedIn ? 'secondary' : 'primary',
    onClick: () => setClockedIn(true),
    disabled: clockedIn
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16
  }), " Clock In"), /*#__PURE__*/React.createElement(Button, {
    variant: clockedIn ? 'primary' : 'ghost',
    onClick: () => setClockedIn(false),
    disabled: !clockedIn
  }, "Clock Out")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 'var(--space-4)',
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Shifts This Month",
    value: "0",
    tone: "success",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "calendar",
      size: 16
    }),
    hint: "April 2026"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Incoming Requests",
    value: "0",
    tone: "warning",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "bell",
      size: 16
    }),
    hint: "Waiting for your approval"
  }), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, "Quick Actions"), /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    fullWidth: true,
    style: {
      justifyContent: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "swap",
    size: 16
  }), " Swap Shift"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    style: {
      justifyContent: 'flex-start',
      color: 'var(--warning)',
      borderColor: 'var(--warning-border)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 16
  }), " Swap Day Off")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '3fr 2fr',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 16,
    style: {
      color: 'var(--accent)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "Shift Schedule \u2014 April 2026")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gap: 2
    }
  }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => /*#__PURE__*/React.createElement("div", {
    key: d,
    className: "t-caption",
    style: {
      textAlign: 'center',
      padding: 'var(--space-2) 0',
      background: 'var(--surface-alt)',
      fontWeight: 'var(--weight-medium)'
    }
  }, d)), Array.from({
    length: 3
  }).map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: 'e' + i
  })), days.map(d => /*#__PURE__*/React.createElement("div", {
    key: d,
    className: "t-caption num",
    style: {
      minHeight: 36,
      padding: 'var(--space-1)',
      border: '1px solid var(--border)',
      color: 'var(--ink-muted)'
    }
  }, d)))), /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      background: 'var(--warning-soft)',
      borderColor: 'var(--warning-border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot",
    style: {
      background: 'var(--warning)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "Incoming Requests")), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      textAlign: 'center',
      padding: 'var(--space-4) 0'
    }
  }, "No incoming requests.")), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "My Requests"), /*#__PURE__*/React.createElement(Badge, null, "0")), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      textAlign: 'center',
      padding: 'var(--space-4) 0'
    }
  }, "No swap requests yet.")))));
}
window.DashboardScreen = DashboardScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/DashboardScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/KdsScreen2.jsx
try { (() => {
// Kitchen Display (varian ORIGEN) — Pending / Preparing / Ready to Serve.
// Layar penuh. Auto-refresh tiap 15s.
const {
  Button,
  Icon,
  Badge
} = window.LumiPOSDesignSystem_dae7d1;
function KdsCol({
  dot,
  title,
  count,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '2px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "row t-body-md",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot",
    style: {
      background: dot,
      width: 10,
      height: 10
    }
  }), " ", title), /*#__PURE__*/React.createElement("span", {
    className: "num t-body-md",
    style: {
      color: 'var(--ink-muted)'
    }
  }, count)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: 'var(--space-3)'
    }
  }, children));
}
function KdsScreen2({
  onExit
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--surface)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    className: "row between",
    style: {
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: onExit,
    style: {
      minWidth: 36,
      padding: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 18
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chef",
    size: 20
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-title"
  }, "Kitchen Display"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Live order queue \xB7 Auto-refreshes every 15s"))), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 16
  }), " Refresh Now")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(KdsCol, {
    dot: "var(--danger)",
    title: "Pending",
    count: 1
  }, /*#__PURE__*/React.createElement("article", {
    className: "card",
    style: {
      borderColor: 'var(--warning-border)',
      background: 'var(--warning-soft)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-2) var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-caption num",
    style: {
      fontWeight: 600
    }
  }, "ORD-20260430-JXAG5"), /*#__PURE__*/React.createElement("span", {
    className: "t-caption num"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 12
  }), " 09:11 (0m ago)")), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      padding: '0 var(--space-3) var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "warning"
  }, "A04 \u2014 Dekat Pintu"), /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "by Super Admin User")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-2) var(--space-3)',
      borderTop: '1px solid var(--warning-border)',
      background: 'var(--surface)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between"
  }, /*#__PURE__*/React.createElement("label", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    style: {
      width: 18,
      height: 18
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md num"
  }, "1\xD7 Americano")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-danger",
    style: {
      minHeight: 30,
      fontSize: 'var(--text-caption)'
    }
  }, "Cancel")), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      paddingLeft: 26
    }
  }, "+ Extra Sugar, Extra 2 Shot")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-2) var(--space-3) var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true
  }, "Start Preparing All ", /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      background: 'var(--border)'
    }
  }), /*#__PURE__*/React.createElement(KdsCol, {
    dot: "var(--info)",
    title: "Preparing",
    count: 0
  }, /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "No orders"))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      background: 'var(--border)'
    }
  }), /*#__PURE__*/React.createElement(KdsCol, {
    dot: "var(--success)",
    title: "Ready to Serve",
    count: 0
  }, /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "No orders")))));
}
window.KdsScreen2 = KdsScreen2;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/KdsScreen2.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/LandingScreen.jsx
try { (() => {
// Landing — halaman publik marketing (re-skin Lumi: aksen teal, Inter).
const {
  Button,
  Icon,
  Badge
} = window.LumiPOSDesignSystem_dae7d1;
function LandingScreen() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100%',
      background: 'var(--surface)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    className: "row between",
    style: {
      padding: 'var(--space-4) var(--space-8)',
      maxWidth: 1200,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "coffee",
    size: 22
  })), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "The Cafe by ORIGEN")), /*#__PURE__*/React.createElement("nav", {
    className: "row",
    style: {
      gap: 'var(--space-6)'
    }
  }, ['Menu', 'Tentang', 'Galeri', 'Testimoni', 'Meja'].map(n => /*#__PURE__*/React.createElement("a", {
    key: n,
    className: "t-body",
    href: "#",
    style: {
      color: 'var(--ink-muted)'
    }
  }, n))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Dashboard")), /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1200,
      margin: '0 auto',
      padding: 'var(--space-8)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 'var(--space-12)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "badge badge-accent",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "coffee",
    size: 14
  }), " Best coffee"), /*#__PURE__*/React.createElement("h1", {
    className: "t-hero",
    style: {
      margin: '0 0 var(--space-4)'
    }
  }, "Setiap Cangkir,", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, "Sebuah Cerita")), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-6)',
      maxWidth: '40ch'
    }
  }, "The Cafe by ORIGEN is the best coffee shop in Purbalingga."), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-8)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary btn-critical",
    style: {
      background: 'var(--ink)'
    }
  }, "Pesan Sekarang ", /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    critical: true
  }, "Lihat Menu ", /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-8)'
    }
  }, [['100%', 'Arabica'], ['5.0', 'Rating'], ['Daily', 'Roasted']].map(([v, l]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "star",
    size: 14
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md num"
  }, v), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, l)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      aspectRatio: '4/5',
      borderRadius: 'var(--radius-card)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("image-slot", {
    id: "rek-hero",
    shape: "rounded",
    radius: "16",
    placeholder: "Foto barista / interior kafe",
    fit: "cover"
  }))));
}
window.LandingScreen = LandingScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/LandingScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/PosScreen.jsx
try { (() => {
// POS — Open Register. Layar penuh (tanpa sidebar admin).
const {
  SegmentedControl,
  Button,
  Icon,
  Badge
} = window.LumiPOSDesignSystem_dae7d1;
function PosScreen({
  onExit
}) {
  const [mode, setMode] = React.useState('Dine In');
  const [cat, setCat] = React.useState('All');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      background: 'var(--surface)'
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      borderRight: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-3)',
      borderBottom: '1px solid var(--border)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 24,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--ink-subtle)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  })), /*#__PURE__*/React.createElement("input", {
    className: "field",
    style: {
      paddingLeft: 40
    },
    placeholder: "Search product name or SKU\u2026"
  })), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      padding: 'var(--space-3)'
    }
  }, ['All', 'Kopi'].map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    className: "chip",
    "aria-pressed": cat === c,
    onClick: () => setCat(c),
    style: cat === c ? {
      background: 'var(--ink)',
      borderColor: 'var(--ink)',
      color: 'var(--on-accent)'
    } : undefined
  }, c))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '0 var(--space-3) var(--space-3)',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      gap: 'var(--space-3)',
      alignContent: 'start'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "card",
    style: {
      padding: 0,
      textAlign: 'left',
      cursor: 'pointer',
      overflow: 'hidden',
      border: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      aspectRatio: '1/1',
      background: 'var(--surface-alt)',
      display: 'grid',
      placeItems: 'center',
      color: 'var(--ink-subtle)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "coffee",
    size: 32
  }), /*#__PURE__*/React.createElement("span", {
    className: "badge badge-warning",
    style: {
      position: 'absolute',
      top: 8,
      left: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "star",
    size: 12
  })), /*#__PURE__*/React.createElement("span", {
    className: "badge badge-neutral num",
    style: {
      position: 'absolute',
      top: 8,
      right: 8
    }
  }, "153")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md"
  }, "Americano"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      textDecoration: 'line-through'
    }
  }, "Rp 10.000"), /*#__PURE__*/React.createElement("div", {
    className: "t-body-md num",
    style: {
      color: 'var(--success)'
    }
  }, "Rp 8.000"))))), /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 340,
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "avatar",
    style: {
      width: 32,
      height: 32
    }
  }, "S"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md"
  }, "Super Admin User"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Register #1"))), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: onExit
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 16
  }), " Exit")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-3)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    options: ['Direct', 'Dine In', 'Takeaway'],
    value: mode,
    onChange: setMode,
    ariaLabel: "Order type"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    style: {
      justifyContent: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "qr",
    size: 16
  }), " Select Table"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-secondary",
    style: {
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "row",
    style: {
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "user",
    size: 16
  }), " Customer (Optional)"), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    className: "grow",
    style: {
      display: 'grid',
      placeItems: 'center',
      color: 'var(--ink-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      alignItems: 'center',
      gap: 'var(--space-1)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "receipt",
    size: 40
  }), /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      color: 'var(--ink-muted)'
    }
  }, "Cart is Empty"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Add items from the catalog"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-3)',
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      color: 'var(--ink-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Subtotal (0 items)"), /*#__PURE__*/React.createElement("span", null, "Rp 0")), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      color: 'var(--ink-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Tax (11%)"), /*#__PURE__*/React.createElement("span", null, "Rp 0")), /*#__PURE__*/React.createElement("div", {
    className: "row between t-title"
  }, /*#__PURE__*/React.createElement("span", null, "Total"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--success)'
    }
  }, "Rp 0"))), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    disabled: true
  }, "Save / Draft"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    disabled: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "tag",
    size: 16
  }), " Add Discount")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    critical: true,
    fullWidth: true,
    disabled: true,
    style: {
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Charge Total"), /*#__PURE__*/React.createElement("span", {
    className: "num"
  }, "Rp 0 \u203A")))));
}
window.PosScreen = PosScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/PosScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/QrStickerScreen.jsx
try { (() => {
// QR Sticker — pratinjau stiker meja untuk dicetak. Layar penuh.
const {
  Button,
  Icon
} = window.LumiPOSDesignSystem_dae7d1;
function QrStickerScreen({
  onExit
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100%',
      background: 'var(--surface-sunk)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-4) var(--space-8)',
      maxWidth: 1000,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: onExit
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 16
  }), " Back"), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-primary",
    style: {
      background: 'var(--ink)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 16
  }), " Download Sticker PDF")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      placeItems: 'center',
      padding: 'var(--space-8)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 360,
      background: 'var(--surface)',
      border: '2px solid var(--ink)',
      borderRadius: 24,
      padding: 'var(--space-8) var(--space-6)',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-title",
    style: {
      fontStyle: 'italic',
      letterSpacing: '.02em'
    }
  }, "THE CAFE BY ORIGEN"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 2,
      background: 'var(--ink)',
      margin: 'var(--space-3) auto'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'calc(72px * var(--scale))',
      fontWeight: 600,
      lineHeight: 1,
      letterSpacing: '-0.03em'
    },
    className: "num"
  }, "A01"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      letterSpacing: '.2em',
      marginTop: 'var(--space-2)'
    }
  }, "MAIN HALL"), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: 'var(--space-6) auto',
      width: 200,
      height: 200,
      border: '1px solid var(--border)',
      borderRadius: 12,
      display: 'grid',
      placeItems: 'center',
      background: 'var(--surface-sunk)',
      color: 'var(--ink-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "qr",
    size: 64
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "QR code meja"))), /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      letterSpacing: '.1em'
    }
  }, "SCAN TO ORDER"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption num",
    style: {
      marginTop: 4,
      wordBreak: 'break-all'
    }
  }, "localhost:8000/orders?t=X0dkNuRuJ50BsUosL025c11DR1TFozzT"))));
}
window.QrStickerScreen = QrStickerScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/QrStickerScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/ReservationsScreen.jsx
try { (() => {
// Reservations — KPI ringkas + daftar booking (kosong). (dalam AppShell)
const {
  Card,
  Button,
  StatCard,
  Icon,
  EmptyState
} = window.LumiPOSDesignSystem_dae7d1;
function ReservationsScreen() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-1)',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    className: "t-heading",
    style: {
      margin: 0
    }
  }, "Reservations"), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "table",
    size: 16
  }), " Monitoring"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 16
  }), " New Booking"))), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-4)'
    }
  }, "Manage table bookings and guest arrivals."), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-3)',
      flexWrap: 'wrap',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "label"
  }, "From date"), /*#__PURE__*/React.createElement("input", {
    className: "field",
    type: "date",
    defaultValue: "2026-05-08",
    style: {
      width: 180
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "label"
  }, "To date"), /*#__PURE__*/React.createElement("input", {
    className: "field",
    type: "date",
    defaultValue: "2026-05-08",
    style: {
      width: 180
    }
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "filter",
    size: 16
  }), " Filter"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Today",
    value: "0",
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "calendar",
      size: 16
    }),
    hint: "Bookings for today"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Pending",
    value: "0",
    tone: "warning",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "clock",
      size: 16
    }),
    hint: "Needs confirmation"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Seated",
    value: "0",
    tone: "success",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "users",
      size: 16
    }),
    hint: "Currently at tables"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Completed",
    value: "0",
    tone: "violet",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 16
    }),
    hint: "Sessions finished"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Cancelled",
    value: "0",
    tone: "danger",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 16
    }),
    hint: "Revoked bookings"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Total Deposit",
    value: "Rp 0",
    tone: "accent",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "receipt",
      size: 16
    }),
    hint: "Collected for range"
  })), /*#__PURE__*/React.createElement(Card, {
    pad: false
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr .6fr 1fr 1fr 1fr .8fr',
      gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border)'
    }
  }, ['Guest', 'Time', 'Pax', 'Table', 'Deposit', 'Status', 'Actions'].map(h => /*#__PURE__*/React.createElement("span", {
    key: h,
    className: "t-caption"
  }, h))), /*#__PURE__*/React.createElement(EmptyState, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "calendar",
      size: 32
    }),
    title: "No reservations found"
  })));
}
window.ReservationsScreen = ReservationsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/ReservationsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/SelectTableScreen.jsx
try { (() => {
// Select a Table — alur pesan publik (QR). Re-skin Lumi.
const {
  Button,
  Icon,
  Badge
} = window.LumiPOSDesignSystem_dae7d1;
const TABLES = [{
  name: 'Dekat Kolam Ikan',
  code: 'A01',
  seats: 2
}, {
  name: 'Dekat Kolam kiri',
  code: 'A02',
  seats: 5
}, {
  name: 'Dekat kolam kanan',
  code: 'A03',
  seats: 2
}, {
  name: 'Dekat Pintu',
  code: 'A04',
  seats: 6
}];
function SelectTableScreen() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100%',
      background: 'var(--surface)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    className: "row between",
    style: {
      padding: 'var(--space-4) var(--space-8)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "coffee",
    size: 22
  })), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "The Cafe by ORIGEN")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Dashboard")), /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1080,
      margin: '0 auto',
      padding: 'var(--space-8)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge badge-accent",
    style: {
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "table",
    size: 14
  }), " Pilih Meja"), /*#__PURE__*/React.createElement("h1", {
    className: "t-heading",
    style: {
      margin: '0 0 var(--space-1)'
    }
  }, "Select a Table"), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-2)'
    }
  }, "Pilih meja dan masukkan kode akses untuk melanjutkan."), /*#__PURE__*/React.createElement("div", {
    className: "row t-caption",
    style: {
      gap: 6,
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot",
    style: {
      background: 'var(--accent)'
    }
  }), " ", /*#__PURE__*/React.createElement("span", {
    className: "num"
  }, "4"), " tersedia"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: 'var(--space-3)'
    }
  }, TABLES.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.code,
    className: "card card-pad",
    style: {
      textAlign: 'left',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 36,
      borderRadius: 8,
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
      display: 'grid',
      placeItems: 'center',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "table",
    size: 18
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md"
  }, t.name), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Main Hall"))), /*#__PURE__*/React.createElement(Badge, {
    tone: "accent"
  }, "Available")), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "badge badge-neutral num"
  }, "# ", t.code), /*#__PURE__*/React.createElement("span", {
    className: "badge badge-neutral num"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 12
  }), " ", t.seats, " kursi"), /*#__PURE__*/React.createElement("span", {
    className: "badge badge-accent"
  }, "Reservable")))))));
}
window.SelectTableScreen = SelectTableScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/SelectTableScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/SettingsScreen.jsx
try { (() => {
// Settings — Shop Settings dengan sub-navigasi & tab modul. (dalam AppShell)
const {
  Card,
  Tabs,
  Switch,
  Icon,
  Field
} = window.LumiPOSDesignSystem_dae7d1;
function SettingRow({
  title,
  desc,
  warn,
  checked,
  onChange,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-4)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)',
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      gap: 'var(--space-4)',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '46ch'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md"
  }, title), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      marginTop: 2
    }
  }, desc), warn && /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      marginTop: 'var(--space-1)',
      color: 'var(--danger)'
    }
  }, warn)), onChange && /*#__PURE__*/React.createElement(Switch, {
    checked: checked,
    onChange: onChange,
    ariaLabel: title
  })), children);
}
function SettingsScreen() {
  const [side, setSide] = React.useState('Shop');
  const [tab, setTab] = React.useState('Inventory & Catalog');
  const [variant, setVariant] = React.useState(false);
  const [enterprise, setEnterprise] = React.useState(true);
  const [reservation, setReservation] = React.useState(true);
  const [deposit, setDeposit] = React.useState(true);
  const [tableTrack, setTableTrack] = React.useState(true);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "t-heading",
    style: {
      margin: '0 0 var(--space-1)'
    }
  }, "Settings"), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-6)'
    }
  }, "Manage your business and operational settings"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 2
    }
  }, ['Shop', 'Systems', 'Shift & Attendance'].map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    className: "shell-link",
    "aria-current": side === s ? 'page' : undefined,
    onClick: () => setSide(s),
    style: {
      minHeight: 40
    }
  }, s))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-1)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "settings",
    size: 22,
    style: {
      color: 'var(--accent)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-title-lg"
  }, "Shop Settings")), /*#__PURE__*/React.createElement("p", {
    className: "t-caption",
    style: {
      margin: '0 0 var(--space-4)'
    }
  }, "Adjust application behavior according to your business type."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: ['Inventory & Catalog', 'POS & Checkout', 'Modules & Features', 'Auto-Journal']
  })), tab === 'Inventory & Catalog' && /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      marginBottom: 'var(--space-3)'
    }
  }, "Inventory & Product Variant Methods"), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Use Variant Matrix Table",
    desc: /*#__PURE__*/React.createElement(React.Fragment, null, "Enable this if you sell ", /*#__PURE__*/React.createElement("strong", {
      style: {
        fontWeight: 500,
        color: 'var(--ink)'
      }
    }, "Physical Goods / Retail"), " where Size and Color variations have different stock in the warehouse."),
    warn: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("strong", {
      style: {
        fontWeight: 500
      }
    }, "DISABLE this option"), " if you run an F&B business. The matrix system will be replaced by the Linear Modifiers mechanism."),
    checked: variant,
    onChange: setVariant
  })), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "package",
    size: 16,
    style: {
      color: 'var(--warning)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "Advanced Inventory Management")), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Enable Enterprise Inventory Mode",
    desc: /*#__PURE__*/React.createElement(React.Fragment, null, "Locks the stock column on the Products page to ", /*#__PURE__*/React.createElement("strong", {
      style: {
        fontWeight: 500,
        color: 'var(--ink)'
      }
    }, "Read-Only"), ". All stock changes must be made through Stock Adjustment or Stock Opname modules."),
    checked: enterprise,
    onChange: setEnterprise
  }))), tab === 'Modules & Features' && /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 16,
    style: {
      color: 'var(--violet)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "Reservation System")), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Enable Reservation Module",
    desc: /*#__PURE__*/React.createElement(React.Fragment, null, "Allow customers to book tables in advance. When enabled, the ", /*#__PURE__*/React.createElement("strong", {
      style: {
        fontWeight: 500,
        color: 'var(--ink)'
      }
    }, "Reservations"), " menu appears in the sidebar."),
    checked: reservation,
    onChange: setReservation
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: '3px solid var(--violet-border)',
      paddingLeft: 'var(--space-4)',
      marginTop: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(SettingRow, {
    title: "Buffer Time (minutes)",
    desc: "Time window before and after a booking to block the table from double-booking."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 200,
      marginTop: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Field, {
    defaultValue: "30",
    inputMode: "numeric"
  }))), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Require Deposit",
    desc: "If enabled, a deposit amount must be entered before confirming.",
    checked: deposit,
    onChange: setDeposit
  }))), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "table",
    size: 16,
    style: {
      color: 'var(--success)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "Table & Dining")), /*#__PURE__*/React.createElement(SettingRow, {
    title: "Table Tracking",
    desc: "Show table number inputs on the POS sidebar so cashiers can assign orders to tables.",
    checked: tableTrack,
    onChange: setTableTrack
  }))), (tab === 'POS & Checkout' || tab === 'Auto-Journal') && /*#__PURE__*/React.createElement(Card, {
    className: "card-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "settings",
    size: 28
  }), /*#__PURE__*/React.createElement("div", {
    className: "t-body-md",
    style: {
      color: 'var(--ink-muted)'
    }
  }, tab), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Panel setelan ini di luar cakupan kit contoh."))))));
}
window.SettingsScreen = SettingsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/ShiftScheduleScreen.jsx
try { (() => {
// Shift & Schedule — Roster Board + Swap Requests. (dalam AppShell)
const {
  Card,
  Button,
  Tabs,
  Icon,
  Chip
} = window.LumiPOSDesignSystem_dae7d1;
const DAYS = [['Sun', 11], ['Mon', 12], ['Tue', 13], ['Wed', 14], ['Thu', 15], ['Fri', 16], ['Sat', 17]];
const ROWS = [{
  shift: 'Pagi',
  time: '08:00–15:00',
  min: 'Min 1',
  cells: ['Warehouse…', 'Cashier User', 'Warehouse…', null, 'Warehouse…', 'Warehouse…', 'Warehouse…']
}, {
  shift: 'Malam',
  time: '15:00–22:00',
  min: 'Min 1',
  cells: ['Cashier User', 'Warehouse…', 'Cashier User', null, 'Cashier User', 'Cashier User', 'Cashier User']
}];
function ShiftScheduleScreen() {
  const [tab, setTab] = React.useState('roster');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-1)',
      gap: 'var(--space-4)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    className: "t-heading",
    style: {
      margin: 0
    }
  }, "Shift & Schedule"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh",
    size: 16
  }), " Generate Auto-Roster")), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-4)'
    }
  }, "Auto-Rostering Management & POS Employee Schedule."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    tabs: [{
      value: 'roster',
      label: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
        name: "table",
        size: 14
      }), " Roster Board")
    }, {
      value: 'swap',
      label: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
        name: "swap",
        size: 14
      }), " Swap Requests")
    }, {
      value: 'user',
      label: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
        name: "user",
        size: 14
      }), " User Shift"),
      badge: 0
    }]
  })), tab === 'roster' ? /*#__PURE__*/React.createElement(Card, {
    pad: false,
    style: {
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    style: {
      minHeight: 38
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 16
  }), " Prev"), /*#__PURE__*/React.createElement("span", {
    className: "t-body-md num"
  }, "11 May \u2013 17 May 2026"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    style: {
      minHeight: 38
    }
  }, "Next ", /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      minWidth: 760
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'left',
      padding: 'var(--space-3)',
      borderBottom: '1px solid var(--border)',
      width: 120
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "Shift")), DAYS.map(([d, n], i) => /*#__PURE__*/React.createElement("th", {
    key: d,
    style: {
      padding: 'var(--space-2)',
      borderBottom: '1px solid var(--border)',
      background: i === 2 ? 'var(--accent-soft)' : undefined
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, d), /*#__PURE__*/React.createElement("div", {
    className: "t-body-md num"
  }, n))))), /*#__PURE__*/React.createElement("tbody", null, ROWS.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.shift
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: 'var(--space-3)',
      borderBottom: '1px solid var(--border)',
      verticalAlign: 'top'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-body-md"
  }, r.shift), /*#__PURE__*/React.createElement("div", {
    className: "t-caption num"
  }, r.time), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, r.min)), r.cells.map((c, i) => /*#__PURE__*/React.createElement("td", {
    key: i,
    style: {
      padding: 'var(--space-2)',
      borderBottom: '1px solid var(--border)',
      borderLeft: '1px solid var(--border)',
      background: i === 2 ? 'var(--accent-soft)' : undefined,
      verticalAlign: 'top'
    }
  }, c ? /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '4px 8px',
      background: 'var(--surface)',
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-caption truncate",
    style: {
      display: 'block'
    }
  }, c)) : null, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    style: {
      minHeight: 30,
      width: '100%',
      fontSize: 'var(--text-caption)',
      color: 'var(--accent)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 12
  }), " Assign"))))))))) : /*#__PURE__*/React.createElement("div", {
    className: "stack",
    style: {
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    fullWidth: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "swap",
    size: 16
  }), " Create Shift Swap"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    style: {
      color: 'var(--warning)',
      borderColor: 'var(--warning-border)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 16
  }), " Create Day Off Swap")), /*#__PURE__*/React.createElement(Card, {
    pad: false
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--warning-soft)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body-md",
    style: {
      color: 'var(--warning)'
    }
  }, "\u25CF Pending Approval"), /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "0 request")), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      textAlign: 'center',
      padding: 'var(--space-8)'
    }
  }, "No pending requests.")), /*#__PURE__*/React.createElement(Card, {
    pad: false
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-body-md"
  }, "Shift Swap History"), /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "0 entries")), /*#__PURE__*/React.createElement("div", {
    className: "t-caption",
    style: {
      textAlign: 'center',
      padding: 'var(--space-8)'
    }
  }, "No history yet."))));
}
window.ShiftScheduleScreen = ShiftScheduleScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/ShiftScheduleScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/TableManagementScreen.jsx
try { (() => {
// Table Management — data master meja. (dalam AppShell)
const {
  Card,
  Button,
  Badge,
  Icon
} = window.LumiPOSDesignSystem_dae7d1;
function TableManagementScreen() {
  const rows = window.REKANARA.tables;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-1)'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    className: "t-heading",
    style: {
      margin: 0
    }
  }, "Tables"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 16
  }), " Add Table")), /*#__PURE__*/React.createElement("p", {
    className: "t-body",
    style: {
      color: 'var(--ink-muted)',
      margin: '0 0 var(--space-4)'
    }
  }, "Manage your establishment's master table data."), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      justifyContent: 'flex-end',
      marginBottom: 'var(--space-3)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "table",
    size: 16
  }), " Monitoring"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "layers",
    size: 16
  }), " Manage Areas"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "printer",
    size: 16
  }), " Bulk Print QR"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 16
  }), " Export QR")), /*#__PURE__*/React.createElement(Card, {
    pad: false
  }, /*#__PURE__*/React.createElement("table", {
    className: "table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, ['Code', 'Area', 'Capacity', 'Type', 'Group', 'Position', 'Status', 'Reservable', 'Actions'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, rows.map(t => /*#__PURE__*/React.createElement("tr", {
    key: t.code
  }, /*#__PURE__*/React.createElement("td", {
    className: "t-body-md num"
  }, t.code), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge badge-neutral"
  }, t.area)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, t.cap), /*#__PURE__*/React.createElement("td", null, t.type), /*#__PURE__*/React.createElement("td", null, t.group === '-' ? '-' : /*#__PURE__*/React.createElement("span", {
    className: "badge badge-neutral"
  }, t.group)), /*#__PURE__*/React.createElement("td", {
    className: "num"
  }, t.pos), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Badge, {
    tone: "success"
  }, "Active")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Badge, {
    tone: "success"
  }, t.reservable ? 'Yes' : 'No')), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    style: {
      minWidth: 36,
      padding: 0
    },
    "aria-label": "Aksi"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "more",
    size: 18
  }))))))), /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      padding: 'var(--space-3) var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-caption"
  }, "Showing ", /*#__PURE__*/React.createElement("span", {
    className: "num"
  }, "1-4"), " of ", /*#__PURE__*/React.createElement("span", {
    className: "num"
  }, "4")), /*#__PURE__*/React.createElement("span", {
    className: "row t-caption",
    style: {
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "filter",
    size: 14
  }), " Per page: ", /*#__PURE__*/React.createElement("select", {
    className: "field",
    style: {
      width: 64,
      minHeight: 32
    }
  }, /*#__PURE__*/React.createElement("option", null, "10"), /*#__PURE__*/React.createElement("option", null, "25"))))));
}
window.TableManagementScreen = TableManagementScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/TableManagementScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/TableMonitoringScreen.jsx
try { (() => {
// Table Monitoring — status lantai real-time. (dalam AppShell)
const {
  Card,
  Chip,
  Badge,
  Icon
} = window.LumiPOSDesignSystem_dae7d1;
const LEGEND = [['Available', 'success'], ['Occupied', 'danger'], ['Reserved', 'violet'], ['Cleaning', 'warning']];
function TableMonitoringScreen() {
  const [area, setArea] = React.useState('Indoor Area');
  const tables = [{
    code: 'A01',
    seats: 4
  }, {
    code: 'A02',
    seats: 4
  }, {
    code: 'A03',
    seats: 4
  }, {
    code: 'A04',
    seats: 4
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-1)',
      flexWrap: 'wrap',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    style: {
      padding: '0 var(--space-2)',
      minHeight: 30,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 14
  }), " Back to Management"), /*#__PURE__*/React.createElement("div", {
    className: "t-title-lg"
  }, "Table Monitoring"), /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "Real-time status of your floor plan.")), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-3)',
      flexWrap: 'wrap'
    }
  }, LEGEND.map(([l, tone]) => /*#__PURE__*/React.createElement("span", {
    key: l,
    className: "row t-caption",
    style: {
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot",
    style: {
      background: `var(--${tone})`
    }
  }), " ", l)))), /*#__PURE__*/React.createElement("div", {
    className: "row",
    style: {
      gap: 'var(--space-2)',
      margin: 'var(--space-4) 0'
    }
  }, /*#__PURE__*/React.createElement(Chip, {
    selected: area === 'Indoor Area',
    onClick: () => setArea('Indoor Area')
  }, "Indoor Area ", /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      marginLeft: 6,
      opacity: .7
    }
  }, "4")), /*#__PURE__*/React.createElement(Chip, {
    selected: area === 'Outdoor Area',
    onClick: () => setArea('Outdoor Area')
  }, "Outdoor Area ", /*#__PURE__*/React.createElement("span", {
    className: "num",
    style: {
      marginLeft: 6,
      opacity: .7
    }
  }, "0"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: 'var(--space-3)'
    }
  }, tables.map(t => /*#__PURE__*/React.createElement(Card, {
    key: t.code,
    className: "card-pad",
    style: {
      minHeight: 140,
      display: 'flex',
      flexDirection: 'column',
      borderTop: '3px solid var(--success)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-title-lg num"
  }, t.code), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--success)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 18
  }))), /*#__PURE__*/React.createElement("div", {
    className: "t-caption num"
  }, t.seats, " Seats"), /*#__PURE__*/React.createElement("div", {
    className: "grow",
    style: {
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-caption",
    style: {
      letterSpacing: '.1em'
    }
  }, "READY")))), /*#__PURE__*/React.createElement(Card, {
    className: "card-pad",
    style: {
      minHeight: 140,
      borderStyle: 'dashed'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "row between",
    style: {
      marginBottom: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "row t-body-md",
    style: {
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 16
  }), " Pending Arrivals"), /*#__PURE__*/React.createElement(Badge, null, "0")), /*#__PURE__*/React.createElement("div", {
    className: "empty",
    style: {
      padding: 'var(--space-4) 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "t-caption"
  }, "No pending bookings for today.")), /*#__PURE__*/React.createElement("button", {
    className: "btn btn-ghost",
    style: {
      width: '100%',
      color: 'var(--accent)'
    }
  }, "View All Bookings"))));
}
window.TableMonitoringScreen = TableMonitoringScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/TableMonitoringScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/data.js
try { (() => {
/* Data bersama UI kit ORIGEN. Plain JS (bukan JSX) — dimuat sebagai
   <script> biasa sebelum skrip babel, mengekspos window.REKANARA. */
window.REKANARA = {
  brand: {
    name: 'The Cafe by ORIGEN'
  },
  user: {
    name: 'Super Admin User',
    role: 'Super Admin'
  },
  // Sidebar admin — diturunkan dari alur kerja produk. { group, items:[{id,label,icon}] }
  nav: [{
    items: [{
      id: 'dashboard',
      label: 'Dashboard',
      icon: 'dashboard'
    }]
  }, {
    group: 'Operations',
    items: [{
      id: 'pos',
      label: 'Open Register (POS)',
      icon: 'register'
    }, {
      id: 'kds',
      label: 'Kitchen Display',
      icon: 'chef'
    }]
  }, {
    group: 'Products',
    items: [{
      id: 'categories',
      label: 'Product Categories',
      icon: 'layers'
    }, {
      id: 'products',
      label: 'Products',
      icon: 'package'
    }, {
      id: 'modifiers',
      label: 'Modifiers',
      icon: 'sliders'
    }]
  }, {
    group: 'Marketing',
    items: [{
      id: 'promos',
      label: 'Promos & Discounts',
      icon: 'tag'
    }]
  }, {
    group: 'Inventory',
    items: [{
      id: 'stock-mov',
      label: 'Stock Movements',
      icon: 'truck'
    }, {
      id: 'stock-adj',
      label: 'Stock Adjustments',
      icon: 'sliders'
    }, {
      id: 'stock-opname',
      label: 'Stock Opname',
      icon: 'clipboard'
    }]
  }, {
    group: 'Accounting',
    items: [{
      id: 'transactions',
      label: 'Transactions',
      icon: 'file'
    }, {
      id: 'comp-logs',
      label: 'Complimentary Logs',
      icon: 'gift'
    }, {
      id: 'refunds',
      label: 'Refund History',
      icon: 'refresh'
    }, {
      id: 'journal',
      label: 'Auto-Journal',
      icon: 'book'
    }]
  }, {
    group: 'Customers',
    items: [{
      id: 'customers',
      label: 'Customer List',
      icon: 'users'
    }]
  }, {
    group: 'Tables',
    items: [{
      id: 'table-mon',
      label: 'Table Monitoring',
      icon: 'table'
    }, {
      id: 'table-mgmt',
      label: 'Table Management',
      icon: 'table'
    }]
  }, {
    group: 'Reservations',
    items: [{
      id: 'reservations',
      label: 'Reservation List',
      icon: 'calendar'
    }]
  }, {
    group: 'Team & Schedule',
    items: [{
      id: 'attendance',
      label: 'My Attendance',
      icon: 'clock'
    }, {
      id: 'shift',
      label: 'Shift & Schedule',
      icon: 'calendar'
    }, {
      id: 'timeoff',
      label: 'Attendance & Time Off',
      icon: 'user'
    }]
  }, {
    group: 'Settings',
    items: [{
      id: 'access',
      label: 'Access Control',
      icon: 'shield'
    }, {
      id: 'activity',
      label: 'Activity Logs',
      icon: 'activity'
    }, {
      id: 'settings',
      label: 'Settings',
      icon: 'settings'
    }, {
      id: 'testimonials',
      label: 'Testimonials',
      icon: 'message'
    }, {
      id: 'gallery',
      label: 'Gallery',
      icon: 'image'
    }]
  }],
  // Layar yang benar-benar dibangun di kit ini (sisanya placeholder jujur).
  built: ['dashboard', 'shift', 'settings', 'access', 'reservations', 'customers', 'table-mgmt', 'table-mon'],
  tables: [{
    code: 'A01',
    area: 'Main Hall',
    cap: '2 Seats',
    type: 'Regular',
    group: '-',
    pos: '-',
    reservable: true
  }, {
    code: 'A02',
    area: 'Main Hall',
    cap: '5 Seats',
    type: 'Regular',
    group: '-',
    pos: '-',
    reservable: true
  }, {
    code: 'A03',
    area: 'Main Hall',
    cap: '2 Seats',
    type: 'Regular',
    group: '-',
    pos: '-',
    reservable: true
  }, {
    code: 'A04',
    area: 'Main Hall',
    cap: '6 Seats',
    type: 'Regular',
    group: 'Keluarga',
    pos: '10.00%, 10.00%',
    reservable: true
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/data.js", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/doc-page.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).
/* BEGIN USAGE */
/**
 * <doc-page> — paged-document shell for printable HTML.
 *
 * FIRST, decide how the document paginates — up front, before building:
 *
 * - FLOWING document (the default): write the whole document as one
 *   normal HTML flow inside <doc-page>; the browser's print engine
 *   splits it onto pages at export. Use for long-form documents with a
 *   single text flow: reports, memos, letters, essays.
 * - EXPLICIT pagination: a fixed set of pre-paginated pages, one
 *   <section class="page"> child per page. Use when the user asks for a
 *   specific page count, or the design implies one: a one-page resume, a
 *   two-sided flier, a poster, a certificate, a brochure — any richly
 *   laid-out document without a single text flow.
 * - If in doubt, ask the user as part of the build.
 *
 * PAGE SIZING — paper differs by country (letter vs A4), so the printed
 * sheet is not one fixed truth:
 * - FLOWING documents pin NO paper size: the print engine paginates
 *   onto the user's real paper, and the content reflows to it.
 * - EXPLICITLY PAGINATED documents print each page at a FIXED page box
 *   with overflow hidden — letter by default, size="a4" for a clearly
 *   metric user, the user's chosen paper when they export. Design each
 *   page to FILL that box, fitting letter and A4 alike without overlap.
 * - width/height pin an explicit fixed size, ONLY when the user gives
 *   one.
 * Never write your own @page rule or hard-code paper dimensions in the
 * content.
 *
 * Sizing modes (attributes):
 *   (none)                      — portrait: flowing docs use the user's
 *           paper; explicitly paginated pages use the named size box
 *           (letter unless size="a4")
 *   orientation="landscape"     — the same, landscape
 *   width / height              — explicit fixed size, ONLY when the user
 *           gives one (e.g. width="22in" height="30in" for a 22×30
 *           poster): the page IS the design's size, printed at true
 *           dimensions (or scaled onto the user's paper at print time).
 *           Any absolute CSS length: px/in/mm/cm/pt/pc.
 * The component announces the chosen mode to the host app at runtime (a
 * meta tag it injects), so the print path can inject the user's true
 * paper size.
 *
 * On screen the document renders on a desk background: a flowing
 * document as one tall scrolling sheet (Google Docs' pageless view);
 * explicitly paginated documents as one card per page.
 *
 * EXPLICIT pagination usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page>
 *     <section class="page" id="p1">…one page's design…</section>
 *     <section class="page" id="p2">…</section>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 * How the page box works, concretely: each .page prints as ONE full-bleed
 * sheet at a FIXED physical size — letter by default (set size="a4" for
 * a clearly metric user), the user's chosen paper when they export —
 * with overflow hidden. Nothing scrolls and nothing reflows onto a next
 * sheet: content that misses the box is CLIPPED. Design each page to
 * FILL that page box, and to fit it — letter and A4 alike — without
 * overlap. Each page is a size container; don't size anything in
 * viewport units (they track the window, not the page), and never set
 * width or height on the .page section itself (the component sizes the
 * page box; an authored height like 100% is meaningless at print and is
 * overridden). The component owns the page box, the screen card chrome,
 * and the page breaks (never add your own break-before/after). Don't mix
 * .page sections with flowing content or header/footer slots in the same
 * document.
 *
 * FLOWING usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page margin="0.75in">
 *     <h1>Title</h1>
 *     <p>…body…</p>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 * There is no manual page-splitting — the browser's print engine
 * paginates at export. Standard break-hygiene rules (`break-inside:
 * avoid` on figures, code blocks, images and table rows; `orphans/
 * widows: 3`) are applied so paragraphs and groups split cleanly. On
 * screen and at print, headings default to `text-wrap: balance` and
 * body text to `text-wrap: pretty`; the defaults have zero specificity,
 * so any text-wrap you declare wins.
 *
 * Other attributes:
 *   size    — letter | a4 | legal (default letter). Flowing documents:
 *           preview proportion only — it does NOT pin their printed
 *           paper (the print dialog's paper governs); leave it alone
 *           there. Explicitly paginated documents: it sets the page box
 *           the cards and the pinned @page share (the export dialog's
 *           choice overrides both at print) — set size="a4" for a
 *           clearly metric user. Scaled-fit: names the sheet the fit is
 *           computed against, same a4-for-metric-users advice.
 *   content-width / content-height — the design's own fixed dimensions
 *           (CSS lengths), for scaling a fixed-size design ONTO the
 *           named sheet: content lays out at exactly this size, and the
 *           component scales it to fit that sheet's printable area
 *           (centered horizontally, top-aligned; the export dialog
 *           re-fits to the user's actual paper choice where available).
 *           Both must be set; they do not change the page box. For pages
 *           WITHOUT running header/footer slots.
 *   margin  — printable inset on every page of a FLOWING document
 *           (default 0.75in); margin="0" makes pages full-bleed.
 *           Explicitly paginated pages are always full-bleed.
 *
 * Running header/footer (flowing documents only): give an element
 * `slot="header"` or `slot="footer"` and it repeats on every printed
 * page via `position: fixed`. To keep body text from sliding under it,
 * the component prints inside a single-cell table whose <thead>/<tfoot>
 * are spacers sized to the header/footer height — browsers repeat
 * thead/tfoot on every page, so each sheet's content starts below the
 * header and ends above the footer. On screen the header/footer render
 * once at the top/bottom of the sheet.
 *
 * At print the component injects `@page { margin: 0 }` (which leaves
 * Chrome no margin box to draw its date/URL/page-count header in) and
 * moves the visual margin onto the sheet's own padding. It also marks
 * the document as owning its print CSS (a
 * `meta[name="omelette-owns-print"]` it injects at runtime), so the
 * PDF export never injects page-geometry CSS of its own on top.
 *
 * Print best practices for the content you author:
 * - Multi-column text: use CSS columns (`column-count` +
 *   `column-gap`), never side-by-side flex/grid columns — only real
 *   CSS columns flow and break across pages. `column-span: all` lets
 *   a heading span the columns; `hyphens: auto` (needs `lang` on
 *   the html element) keeps narrow columns readable.
 * - Page breaks in flowing documents: `break-before: page` on an
 *   element that must start a new page (a chapter, an appendix). Add
 *   your own kept-together blocks (callouts, stat tiles, cards) to a
 *   `break-inside: avoid` rule, and keep each one shorter than a page.
 * - Extend `orphans: 3; widows: 3` to any custom text blocks you add
 *   (p and li are covered by default).
 * - Give long tables a <thead> — browsers repeat it on every printed
 *   page.
 * - No `position: fixed`/`sticky` and no viewport units in content:
 *   fixed elements stamp every printed page (running headers/footers go
 *   in the component's slots) and `100vh` mis-sizes at print.
 *
 * Author content as static HTML so the user can click-to-edit any text
 * directly. Do not set width/padding/background on the document body —
 * the component owns the sheet box.
 */
/* END USAGE */

(() => {
  const PAPER = {
    letter: ['8.5in', '11in'],
    a4: ['210mm', '297mm'],
    legal: ['8.5in', '14in']
  };
  const CSS_LENGTH = /^\d+(\.\d+)?(px|in|mm|cm|pt|pc)$/;
  // Unitless "0" is a valid CSS length and the natural way to write
  // margin="0"; normalise it to 0px so max()/calc() (which reject a bare
  // number) keep working.
  const safeLen = (v, fb) => {
    v = (v || '').trim();
    return v === '0' ? '0px' : CSS_LENGTH.test(v) ? v : fb;
  };
  // WebKit (Safari and every iOS browser shell) never repeats a table's
  // thead/tfoot on printed pages (WebKit bug 17205), so the spacer-borne
  // vertical margins of a FLOWING document reach only the first page
  // there. Engine check, not browser check: vendor is 'Apple Computer,
  // Inc.' exactly for WebKit and 'Google Inc.' for Blink.
  const WK_PRINT = /apple/i.test(navigator.vendor || '');
  // CSS length → px number (CSS absolute units are exact: 1in = 96px).
  // Returns NaN for anything safeLen would reject — callers gate on it.
  const PX_PER = {
    px: 1,
    in: 96,
    mm: 96 / 25.4,
    cm: 96 / 2.54,
    pt: 96 / 72,
    pc: 16
  };
  const toPx = v => {
    const m = /^(\d+(?:\.\d+)?)(px|in|mm|cm|pt|pc)$/.exec((v || '').trim());
    return m ? parseFloat(m[1]) * PX_PER[m[2]] : NaN;
  };
  const stylesheet = `
    :host {
      position: relative;
      display: block;
      /* When the viewport is narrower than the page, grow to wrap the
       * sheet (plus this padding) instead of staying viewport-width, so
       * the desk background and right margin reach the sheet's far edge
       * in the horizontal scroll. */
      min-width: max-content;
      min-height: 100vh;
      background: #f5f5f4;
      padding: 48px 24px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      --doc-page-w: 8.5in;
      --doc-page-h: 11in;
      --doc-page-margin: 0.75in;
      --doc-hdr-h: 0px;
      --doc-ftr-h: 0px;
      --doc-hdr-pad: 0px;
      --doc-ftr-pad: 0px;
    }
    .sheet {
      width: var(--doc-page-w);
      margin: 0 auto;
      background: #fff;
      box-shadow: 0 2px 10px rgba(20, 20, 19, 0.12);
      border-radius: 7px;
      box-sizing: border-box;
      padding: var(--doc-page-margin);
    }
    .frame { width: 100%; border-collapse: collapse; }
    /* Scaled-fit mode (content-width/content-height): the inner .fit box
     * lays the content out at its authored fixed size and scales it onto
     * the printable area; .fit-box reserves the scaled footprint in flow
     * (transforms don't affect layout) and centers it. Without the mode,
     * both divs are unstyled block pass-throughs. */
    /* Explicit pagination: direct .page children are the pages. The sheet
     * becomes a transparent stack and each page carries the card look on
     * screen; at print each page is exactly one full-bleed sheet. The
     * ::slotted defaults are deliberately weak (document CSS wins), so
     * authored page styling can override any of this. */
    .sheet.paginated {
      background: transparent;
      box-shadow: none;
      border-radius: 0;
      padding: 0;
    }
    .paginated ::slotted(.page) {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: var(--doc-page-ar);
      container-type: size;
      overflow: hidden;
      box-sizing: border-box;
      background: #fff;
      border-radius: 7px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
      break-inside: avoid;
    }
    .paginated ::slotted(.page:not(:first-child)) { margin-top: 1rem; }
    @media print {
      .sheet.paginated { padding: 0; }
      /* The flowing-document vertical inset lives on the repeating
       * thead/tfoot spacers, not the sheet padding — they must go too,
       * or each full-sheet .page is pushed ~margin down and spills onto
       * a second sheet. Paginated pages are full-bleed by definition
       * (content owns its insets). */
      .sheet.paginated .hdr-space,
      .sheet.paginated .ftr-space { height: 0; }
      .paginated ::slotted(.page) {
        border-radius: 0 !important;
        box-shadow: none !important;
        margin: 0 !important;
        /* Physical page-box sizing, no viewport units: Safari resolves
         * 100vh against the window, not the page box, so a vh-sized card
         * paginates wrong there. --doc-page-w/h are the named size by
         * default and are overridden to the user's chosen paper by the
         * export path, so every card is exactly one sheet either way.
         * Width + height (same source values as @page size) rather than
         * width + aspect-ratio: the ratio is a 6-decimal rounding of the
         * same division, and a few millionths of overflow would spill a
         * blank sheet after every page. The screen-only aspect-ratio
         * (preview proportions) must not leak into print. cqh typography
         * tracks the same box.
         *
         * Every declaration is !important: per CSS Scoping, unimportant
         * shadow ::slotted rules LOSE to the document context, so a page
         * section's authored inline style would silently beat this print
         * geometry. A model-authored height:100% did exactly that — the
         * percentage resolves as auto in the all-auto print ancestry, the
         * base rule's size containment turns auto into ZERO, and
         * overflow:hidden then paints nothing: a blank PDF with perfect
         * page boxes. At print the component's geometry is the design's
         * whole contract, so it must win over any authored sizing. */
        aspect-ratio: auto !important;
        width: var(--doc-page-w) !important;
        height: var(--doc-page-h) !important;
        overflow: hidden !important;
      }
      .paginated ::slotted(.page:not(:first-child)) {
        break-before: page !important;
        margin-top: 0 !important;
      }
    }
    .fit-mode .fit-box {
      width: calc(var(--doc-fit-w) * var(--doc-fit-scale));
      height: calc(var(--doc-fit-h) * var(--doc-fit-scale));
      margin: 0 auto;
      break-inside: avoid;
    }
    .fit-mode .fit {
      width: var(--doc-fit-w);
      height: var(--doc-fit-h);
      transform: scale(var(--doc-fit-scale));
      transform-origin: top left;
    }
    .frame td, .frame th { padding: 0; text-align: left; font-weight: inherit; }
    .hdr-space { height: var(--doc-hdr-h); }
    .ftr-space { height: var(--doc-ftr-h); }
    ::slotted([slot="header"]),
    ::slotted([slot="footer"]) { display: block; box-sizing: border-box; }
    @media print {
      :host { background: none; padding: 0; min-width: 0; min-height: 0; }
      .sheet {
        width: auto; margin: 0; box-shadow: none; border-radius: 0;
        padding: 0 var(--doc-page-margin);
      }
      /* The thead/tfoot spacers repeat on every page, so they carry the
       * vertical page margin (which the sheet's own padding cannot, since
       * that padding is consumed once on the first/last page). The running
       * header/footer are fixed inside that band. */
      /* The 0.35in is breathing room between a running header/footer and
       * the body; without one the spacer is exactly the page margin, so a
       * margin="0" full-bleed document gets truly full-bleed pages. */
      .hdr-space { height: max(var(--doc-page-margin), calc(var(--doc-hdr-h) + var(--doc-hdr-pad))); }
      .ftr-space { height: max(var(--doc-page-margin), calc(var(--doc-ftr-h) + var(--doc-ftr-pad))); }
      /* WebKit flowing documents: @page carries the vertical margin (see
       * _syncPrintPageRule), so the spacers keep only whatever a running
       * header/footer needs BEYOND it — page 1 would otherwise double its
       * top inset. Paginated sheets already zero their spacers above. */
      .sheet.wk-print:not(.paginated) .hdr-space { height: max(0px, calc(max(var(--doc-page-margin), calc(var(--doc-hdr-h) + var(--doc-hdr-pad))) - var(--doc-page-margin))); }
      .sheet.wk-print:not(.paginated) .ftr-space { height: max(0px, calc(max(var(--doc-page-margin), calc(var(--doc-ftr-h) + var(--doc-ftr-pad))) - var(--doc-page-margin))); }
      ::slotted([slot="header"]) {
        position: fixed; top: 0; left: 0; right: 0; margin: 0;
        padding: calc(var(--doc-page-margin) * 0.45) var(--doc-page-margin) 0;
      }
      ::slotted([slot="footer"]) {
        position: fixed; bottom: 0; left: 0; right: 0; margin: 0;
        padding: 0 var(--doc-page-margin) calc(var(--doc-page-margin) * 0.45);
      }
    }
  `;
  class DocPage extends HTMLElement {
    static get observedAttributes() {
      return ['size', 'width', 'height', 'margin', 'orientation', 'content-width', 'content-height'];
    }
    constructor() {
      super();
      this._root = this.attachShadow({
        mode: 'open'
      });
      this._mo = typeof MutationObserver === 'function' ? new MutationObserver(() => this._scheduleMeasure()) : null;
    }

    /** The named paper's [w, h], swapped when orientation="landscape".
     *  Only the named size swaps — explicit width/height are exact values
     *  the author already oriented. */
    _paperSize() {
      const named = PAPER[(this.getAttribute('size') || '').toLowerCase()] || PAPER.letter;
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      return landscape ? [named[1], named[0]] : named;
    }
    get pageWidth() {
      return safeLen(this.getAttribute('width'), this._paperSize()[0]);
    }
    get pageHeight() {
      return safeLen(this.getAttribute('height'), this._paperSize()[1]);
    }
    get pageMargin() {
      return safeLen(this.getAttribute('margin'), '0.75in');
    }

    /** Scaled-fit mode's content box [w, h] as CSS lengths, or null when
     *  the mode is off (either attribute missing/invalid/zero — a partial
     *  declaration falls back to normal flow rather than guessing). */
    _contentFit() {
      const w = safeLen(this.getAttribute('content-width'), null);
      const h = safeLen(this.getAttribute('content-height'), null);
      if (!w || !h) return null;
      const wPx = toPx(w),
        hPx = toPx(h);
      return wPx > 0 && hPx > 0 ? [w, h, wPx, hPx] : null;
    }
    connectedCallback() {
      if (!this._sheet) this._render();
      this._syncSize();
      this._syncPrintPageRule();
      this._ensureTextWrapDefaults();
      this._ensureOwnsPrintMeta();
      this._syncFixedSizeMeta();
      this._syncPrintSizingMeta();
      if (this._mo) this._mo.observe(this, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
      this._onResize = () => this._scheduleMeasure();
      window.addEventListener('resize', this._onResize);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this._scheduleMeasure());
      }
      this._scheduleMeasure();
    }
    disconnectedCallback() {
      window.removeEventListener('resize', this._onResize);
      if (this._mo) this._mo.disconnect();
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      // Drop the head rules when the last doc-page leaves, so a deleted
      // document's @page geometry and text-wrap defaults can't apply to
      // whatever replaces it.
      const survivor = document.querySelector('doc-page');
      if (!survivor) {
        ['doc-page-print', 'doc-page-text-wrap', 'doc-page-owns-print', 'doc-page-fixed-size', 'doc-page-print-sizing'].forEach(id => {
          const tag = document.getElementById(id);
          if (tag) tag.remove();
        });
        // A live deck-stage deferred its own print-sizing meta to ours —
        // hand the page-global meta over so the deck isn't left unmarked.
        const deck = document.querySelector('deck-stage');
        if (deck && typeof deck._ensurePrintSizingMeta === 'function') {
          deck._ensurePrintSizingMeta();
        }
      } else {
        // A departed owner hands each page-global meta to whatever
        // doc-page remains (or it's removed).
        if (typeof survivor._syncFixedSizeMeta === 'function') {
          survivor._syncFixedSizeMeta();
        }
        if (typeof survivor._syncPrintSizingMeta === 'function') {
          survivor._syncPrintSizingMeta();
        }
      }
    }
    attributeChangedCallback() {
      if (!this._sheet) return;
      this._syncSize();
      this._syncPrintPageRule();
      this._syncFixedSizeMeta();
      this._syncPrintSizingMeta();
      this._scheduleMeasure();
    }
    _render() {
      this._root.innerHTML = `
        <style>${stylesheet}</style>
        <style id="vars"></style>
        <div class="sheet" data-screen-label="Document">
          <table class="frame" role="presentation">
            <thead><tr><th><div class="hdr-space"><slot name="header"></slot></div></th></tr></thead>
            <tbody><tr><td class="body"><div class="fit-box"><div class="fit"><slot></slot></div></div></td></tr></tbody>
            <tfoot><tr><td><div class="ftr-space"><slot name="footer"></slot></div></td></tr></tfoot>
          </table>
        </div>`;
      this._sheet = this._root.querySelector('.sheet');
      this._vars = this._root.getElementById('vars');
    }

    /** Runtime sizing lives in a shadow <style> :host rule, never on the
     *  light-DOM host element, so serialize-persist can't write it back. */
    _syncSize(hdrH, ftrH) {
      // Scaled-fit mode: content at its authored size, scaled onto the
      // printable area (page minus margins on both axes). The factor is a
      // plain number var so calc(length * number) stays valid; 4 decimals
      // keeps the shadow style stable across re-measures. Upscaling is
      // allowed — print transforms are vector, so text and CSS stay crisp
      // (raster images soften, which the catalog bullet warns about).
      const fit = this._contentFit();
      let fitVars = '';
      if (fit) {
        const marginPx = toPx(this.pageMargin) || 0;
        const availW = toPx(this.pageWidth) - 2 * marginPx;
        const availH = toPx(this.pageHeight) - 2 * marginPx;
        const scale = Math.min(availW / fit[2], availH / fit[3]);
        if (scale > 0 && Number.isFinite(scale)) {
          fitVars = '--doc-fit-w:' + fit[0] + ';' + '--doc-fit-h:' + fit[1] + ';' + '--doc-fit-scale:' + scale.toFixed(4) + ';';
        }
      }
      this._sheet.classList.toggle('fit-mode', !!fitVars);
      // Numeric w/h ratio for the paginated page cards' aspect-ratio —
      // aspect-ratio takes a number, not a length ratio, so compute it
      // here (CSS length division isn't portable). 6 decimals keeps the
      // shadow style stable across re-syncs.
      const arW = toPx(this.pageWidth);
      const arH = toPx(this.pageHeight);
      const ar = arW > 0 && arH > 0 ? (arW / arH).toFixed(6) : '0.772727';
      this._vars.textContent = ':host{' + fitVars + '--doc-page-ar:' + ar + ';' + '--doc-page-w:' + this.pageWidth + ';' + '--doc-page-h:' + this.pageHeight + ';' + '--doc-page-margin:' + this.pageMargin + ';' + '--doc-hdr-h:' + (hdrH || 0) + 'px;' + '--doc-ftr-h:' + (ftrH || 0) + 'px;' + '--doc-hdr-pad:' + (hdrH ? '0.35in' : '0px') + ';' + '--doc-ftr-pad:' + (ftrH ? '0.35in' : '0px') + '}';
    }

    /** @page is a no-op inside shadow DOM, so the rule lives in <head>.
     *  Re-appended on every sync so it stays last in source order — the
     *  @page cascade is source-order per descriptor, so this rule wins
     *  over any other @page rule in the document.
     *
     *  The @page SIZE is pinned where the page box IS part of the design:
     *  explicit-fixed-size mode (width + height authored), scaled-fit
     *  mode (the named sheet the fit targets), and explicit pagination
     *  (the named size the cards share — so card and sheet agree on
     *  every print path, and the export path's chosen paper overrides
     *  BOTH with one later rule). For FLOWING documents no paper size is
     *  emitted at all — the true size comes from the user's preference,
     *  injected by the export path or chosen in the print dialog — so a
     *  flowing document never fights the paper it lands on.
     *  margin: 0 is emitted in every mode: it leaves Chrome no margin box
     *  to draw its date/URL/page-count header in, and the visual margin
     *  lives on the sheet's own padding. */
    _syncPrintPageRule() {
      const id = 'doc-page-print';
      let tag = document.getElementById(id);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
      }
      document.head.appendChild(tag);
      // Three print-geometry regimes:
      // - true-size: the page IS the design — pin its exact size.
      // - scaled-fit (content-width/height): the fit factor is computed
      //   against the NAMED paper's printable area, so that paper must
      //   stay pinned or the scaled content overflows a smaller sheet
      //   (the export path re-fits and re-pins at print time on top).
      // - default modes: no paper size — but landscape still needs the
      //   paper-agnostic 'size: landscape' keyword, because the size
      //   descriptor is what carries orientation; without it a landscape
      //   document prints portrait whenever nothing injects a size.
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      // Explicit pagination pins the page box to the SAME values that
      // size the cards (the named size by default, the export path's
      // chosen paper when its later rule overrides both) — card and
      // sheet agree on every print path, and a mismatched real paper
      // shrinks-to-fit in the dialog instead of clipping a Letter card
      // on A4. Declared before the paginated read below so both derive
      // from one check.
      const paginatedNow = this.querySelector(':scope > .page') !== null;
      const sizeDescriptor = this._trueSizePx() ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : this._contentFit() ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : paginatedNow ? 'size: ' + this.pageWidth + ' ' + this.pageHeight + '; ' : landscape ? 'size: landscape; ' : '';
      // WebKit never repeats the thead/tfoot spacers that carry a flowing
      // document's vertical page margins (see WK_PRINT above), so pages
      // after the first print edge-to-edge there. Carry the VERTICAL
      // margins on @page for WebKit instead, and the shadow print CSS
      // trims the first-page spacers by the same amount (.sheet.wk-print
      // rules). Horizontal inset stays on the sheet's own padding in
      // every engine. Blink keeps margin: 0 (a nonzero margin there
      // re-opens the box Chrome draws its header furniture in). One cost,
      // learned in testing: Safari's own date/URL headers are a USER
      // dialog setting ("Print headers and footers") that renders in the
      // margin area when room exists — margin: 0 only suppressed it by
      // leaving no room, and no CSS controls it. The export dialog's
      // Safari guide teaches turning the setting off for flowing
      // documents. Explicitly paginated and fixed-size documents keep
      // margin: 0 everywhere: their pages ARE the sheet.
      const wkFlowing = WK_PRINT && !paginatedNow && !this._trueSizePx() && !this._contentFit();
      const marginDescriptor = wkFlowing ? 'margin: ' + this.pageMargin + ' 0; ' : 'margin: 0; ';
      // Shadow-internal marker (never serialized), kept in lockstep with
      // the @page decision above: the print CSS trims the first-page
      // spacers ONLY while @page actually carries the margins — a
      // true-size or scaled-fit sheet keeps margin: 0 and must keep its
      // spacers too. Re-synced here so attribute changes and pagination
      // flips move both together.
      if (this._sheet) this._sheet.classList.toggle('wk-print', wkFlowing);
      tag.textContent = '@page { ' + sizeDescriptor + marginDescriptor + '} ' + '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; height: auto !important; overflow: visible !important; } ' + 'h1,h2,h3,h4,h5,h6 { break-after: avoid; } ' + 'figure,pre,blockquote,img,svg,tr { break-inside: avoid; } ' + 'p,li { orphans: 3; widows: 3; } ' + '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; ' + 'backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } ' + '*, *::before, *::after { animation-delay: -99s !important; animation-duration: .001s !important; ' + 'animation-iteration-count: 1 !important; animation-fill-mode: both !important; ' + 'animation-play-state: running !important; transition-duration: 0s !important; } }';
    }

    /** Typographic defaults for document text: balance headings, avoid
     *  widowed/orphaned words in body copy (browsers without text-wrap
     *  support drop the declarations). Zero-specificity via :where() so
     *  any text-wrap authored on those elements wins; document-level so the
     *  rules reach the slotted (light DOM) content — shadow styles can't.
     *  data-omelette-injected marks the tag for the host editor to strip
     *  at serialize, so it is never written back as authored source. */
    _ensureTextWrapDefaults() {
      if (document.getElementById('doc-page-text-wrap')) return;
      const tag = document.createElement('style');
      tag.id = 'doc-page-text-wrap';
      tag.setAttribute('data-omelette-injected', '');
      tag.textContent = ':where(h1,h2,h3,h4,h5,h6){text-wrap:balance}' + ':where(p,li,blockquote,figcaption){text-wrap:pretty}';
      document.head.appendChild(tag);
    }

    /** Declares that this document owns its print CSS. The instant-PDF
     *  export checks for the meta by NAME PRESENCE alone (content is
     *  ignored) and skips its automatic print-CSS injections, so the
     *  component's @page geometry is never overridden by a heuristic.
     *  data-omelette-injected keeps it out of serialized source. */
    _ensureOwnsPrintMeta() {
      if (document.getElementById('doc-page-owns-print')) return;
      const tag = document.createElement('meta');
      tag.id = 'doc-page-owns-print';
      tag.name = 'omelette-owns-print';
      tag.content = 'true';
      tag.setAttribute('data-omelette-injected', '');
      document.head.appendChild(tag);
    }

    /** This page's valid true-size page box (explicit width AND height)
     *  as [w, h] px ints, or null when the mode is off. */
    _trueSizePx() {
      if (!safeLen(this.getAttribute('width'), null) || !safeLen(this.getAttribute('height'), null)) return null;
      const w = Math.round(toPx(this.pageWidth));
      const h = Math.round(toPx(this.pageHeight));
      return w > 0 && h > 0 ? [w, h] : null;
    }

    /** True-size pages (explicit width AND height) also declare the page
     *  box as the preview size: the in-app preview reads
     *  meta[name="omelette-fixed-size"] (content "W,H" in px ints) and
     *  scales the sheet into view — without it an 18in poster previews at
     *  true size with scrollbars. Never overrides an author-set meta
     *  (only the component's own id is managed). The meta is page-global
     *  while doc-page instances are not, so every sync recomputes the
     *  page-wide owner — the first connected true-size doc-page — and a
     *  non-true-size sibling's sync can never delete the owner's meta.
     *  Removed when no true-size page remains (the owner's disconnect
     *  re-syncs via any survivor) or when an author-set meta exists. */
    _syncFixedSizeMeta() {
      const id = 'doc-page-fixed-size';
      const own = document.getElementById(id);
      const authored = document.querySelector('meta[name="omelette-fixed-size"]:not([data-omelette-injected])');
      // The page-wide owner, not this instance: an upgraded true-size page
      // anywhere in the document keeps the meta alive and sized.
      let box = null;
      for (const el of document.querySelectorAll('doc-page')) {
        box = typeof el._trueSizePx === 'function' ? el._trueSizePx() : null;
        if (box) break;
      }
      if (!box || authored) {
        if (own) own.remove();
        return;
      }
      const tag = own || document.createElement('meta');
      tag.id = id;
      tag.name = 'omelette-fixed-size';
      tag.content = box[0] + ',' + box[1];
      tag.setAttribute('data-omelette-injected', '');
      if (!own) document.head.appendChild(tag);
    }

    /** This page's print-sizing mode: 'fixed' when an explicit width AND
     *  height are authored (the page is the design's own size), else the
     *  default paper in the authored orientation. */
    _printSizingMode() {
      if (this._trueSizePx()) return 'fixed';
      const landscape = (this.getAttribute('orientation') || '').trim().toLowerCase() === 'landscape';
      return landscape ? 'default-landscape' : 'default-portrait';
    }

    /** Announces the print-sizing mode to the host app:
     *  meta[name="omelette-print-sizing"] with content 'default-portrait',
     *  'default-landscape', or 'fixed' (fixed pages also carry the
     *  omelette-fixed-size meta with the page box in px). The export path
     *  probes it to decide what true paper size to inject at print time —
     *  in the default modes the component emits no paper size of its own.
     *  Same page-global ownership rules as the fixed-size meta above:
     *  first connected doc-page owns it, an authored meta is never
     *  overridden, removed when no doc-page remains. */
    _syncPrintSizingMeta() {
      const id = 'doc-page-print-sizing';
      const own = document.getElementById(id);
      const authored = document.querySelector('meta[name="omelette-print-sizing"]:not([data-omelette-injected])');
      // A fixed page wins outright (mirroring the fixed-size loop above,
      // so the two metas can never contradict each other in a mixed
      // multi-page document); otherwise the first page's mode holds.
      let mode = null;
      for (const el of document.querySelectorAll('doc-page')) {
        if (typeof el._printSizingMode !== 'function') continue;
        const m = el._printSizingMode();
        if (m === 'fixed') {
          mode = m;
          break;
        }
        if (mode === null) mode = m;
      }
      if (!mode || authored) {
        if (own) own.remove();
        return;
      }
      // A deck-stage that connected first injected its own meta and
      // defers to any existing one — take it over, or the document ends
      // up with two conflicting injected metas (a doc-page page is the
      // document; the deck re-ensures its meta if every doc-page leaves).
      const deckMeta = document.getElementById('deck-stage-print-sizing');
      if (deckMeta) deckMeta.remove();
      const tag = own || document.createElement('meta');
      tag.id = id;
      tag.name = 'omelette-print-sizing';
      tag.content = mode;
      tag.setAttribute('data-omelette-injected', '');
      if (!own) document.head.appendChild(tag);
    }
    _scheduleMeasure() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._measure();
      });
    }

    /** Slot heights feed the print spacers (--doc-hdr-h / --doc-ftr-h), so
     *  they re-measure on content mutation, resize, and font load. The
     *  same pass detects explicit pagination (direct .page children) and
     *  toggles the sheet between the flowing-document card and the
     *  page-per-card stack — content edits can add or remove pages at any
     *  time, so this tracks the same mutations the measurement does. */
    _measure() {
      const hdr = this.querySelector(':scope > [slot="header"]');
      const ftr = this.querySelector(':scope > [slot="footer"]');
      const wasPaginated = this._sheet.classList.contains('paginated');
      this._sheet.classList.toggle('paginated', this.querySelector(':scope > .page') !== null);
      // The WebKit @page margin is flowing-only, so a pagination flip
      // must re-emit the rule (content edits can add or remove .page
      // sections at any time).
      if (this._sheet.classList.contains('paginated') !== wasPaginated) {
        this._syncPrintPageRule();
      }
      this._syncSize(hdr ? hdr.offsetHeight : 0, ftr ? ftr.offsetHeight : 0);
    }
  }
  if (!customElements.get('doc-page')) {
    customElements.define('doc-page', DocPage);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/doc-page.js", error: String((e && e.message) || e) }); }

// ui_kits/rekanara/image-slot.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).
/* BEGIN USAGE */
/**
 * <image-slot> — user-fillable image placeholder.
 *
 * Drop this into a deck, mockup, or page wherever a design needs an image.
 * You control the slot's shape; it sizes to its container by default. When the search_stock_photos tool
 * is available, prefill the slot by default — write the photo's URL into
 * src (with credit/credit-href); the user can still fill or replace it
 * by dragging an image file onto it (or clicking to browse). The dropped
 * image persists across reloads via a .image-slots.state.json sidecar —
 * same read-via-fetch / write-via-window.omelette pattern as
 * design_canvas.jsx, so the filled slot shows on share links, downloaded
 * zips, and PPTX export. Outside the omelette runtime the slot is read-only.
 *
 * The sidecar is a SIBLING of the HTML file that uses this component: the
 * read is a document-relative fetch, and the host resolves the bridge's
 * sidecar writes into the previewed file's directory to match (same
 * contract as design_canvas.jsx). Pages in the same directory share one
 * sidecar; keep slot ids distinct across them.
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload —
 *                every slot on the page needs a distinct id.
 *   shape        'rect' | 'rounded' | 'circle' | 'pill'   (default 'rounded')
 *                'circle' applies 50% border-radius; on a non-square slot
 *                that's an ellipse — set equal width and height for a true
 *                circle.
 *   radius       Corner radius in px for 'rounded'.       (default 12)
 *   mask         Any CSS clip-path value. Overrides `shape` — use this for
 *                hexagons, blobs, arbitrary polygons.
 *   fit          Initial framing baseline: cover | contain.   (default 'cover')
 *                cover starts the image filling the frame (overflow cropped);
 *                contain starts it fully visible (letterboxed). Either way the
 *                user can always pan/scale from there — double-click, or the
 *                Edit control, enters reframe mode (drag to move, scroll or
 *                corner-handles to scale; Escape / click-out commits). The
 *                crop persists alongside the image in the sidecar.
 *   placeholder  Empty-state caption.                      (default 'Drop an image')
 *   src          Optional initial/fallback image URL. Prefill it with a real
 *                photo via search_stock_photos when that tool is available
 *                (set credit/credit-href from the result). A user drop
 *                overrides it; clearing the drop reveals src again.
 *   credit       Attribution text shown as a small overlay at the
 *                bottom-left of the filled slot. REQUIRED whenever src
 *                points at any Unsplash host (images.unsplash.com,
 *                plus.unsplash.com, …): an Unsplash src with no credit
 *                renders an error tile INSTEAD of the photo (Unsplash
 *                terms forbid showing their photos unattributed). Use the
 *                exact form 'Photo by {photographer name} on Unsplash' —
 *                the overlay then links the name to credit-href and
 *                'Unsplash' to the Unsplash homepage, and links back to
 *                unsplash.com automatically get the required utm referral
 *                params appended at render time. The credit belongs to
 *                the src image, so it only shows while src is what's
 *                displayed — a user-dropped image hides it.
 *   credit-href  Link for the photographer's name in the credit overlay
 *                (their Unsplash profile URL from the stock-photo search
 *                results). http(s) URLs only — anything else renders the
 *                name as plain text.
 *
 * Sizing: the slot fills its container by default (width/height 100%).
 * Put it in a sized wrapper — absolutely positioned, a grid cell, a fixed
 * frame — and it takes exactly that box. When the parent's height is
 * indefinite (ordinary flow), it falls back to full width at a 3:2 aspect
 * ratio instead of collapsing. In a shrink-to-fit parent (a float,
 * width:max-content, an unsized absolute wrapper), percentages have
 * nothing to resolve against — size the slot or its wrapper explicitly
 * there. For a fixed-size slot, set
 * width/height on the element itself (inline style), which overrides the
 * default. When
 * layering content above a slot (full-bleed layouts), make the overlay
 * click-through — pointer-events: none on scrims/text plates, re-enabled
 * on interactive children — so the slot's hover controls stay reachable.
 * Keep the slot's bottom-left corner visually clear as well: the credit
 * overlay renders there, and a dark fade or text plate covering it hides
 * the attribution Unsplash's terms require — end the fade above that
 * corner, or keep it nearly transparent where the credit sits.
 *
 * Usage:
 *   <div style="position:relative;width:100%;height:100%">      <!-- full-bleed: -->
 *     <image-slot id="bg" shape="rect"></image-slot>            <!-- fills the wrapper -->
 *   </div>
 *   <image-slot id="hero"   style="width:800px;height:450px" shape="rounded" radius="20"
 *               placeholder="Drop a hero image"></image-slot>
 *   <image-slot id="avatar" style="width:120px;height:120px" shape="circle"></image-slot>
 *   <image-slot id="kite"   style="width:300px;height:300px"
 *               mask="polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"></image-slot>
 */
/* END USAGE */

(() => {
  const STATE_FILE = '.image-slots.state.json';

  // Unsplash terms require visible attribution wherever their photos
  // display, and every link back to unsplash.com must carry utm referral
  // params. Two render-time rules enforce that here:
  //  - an Unsplash-src slot with NO credit attribute renders an error
  //    tile INSTEAD of the photo (an uncredited Unsplash photo on screen
  //    is itself the terms violation, so it never renders bare);
  //  - rendered credit links pointing at unsplash.com get the referral
  //    params appended when absent (credit-href values live in page
  //    content that can't be edited after the fact).
  // Keep the utm_source value in sync with UTM_SOURCE in
  // platform/web-agent/unsplash.ts — this file is a project-local
  // artifact and cannot import it (equality is pinned by tests).
  const UNSPLASH_HOMEPAGE_HREF = 'https://unsplash.com/?utm_source=claude_design&utm_medium=referral';
  // Host rule mirrors the hotlink validator that admits Unsplash srcs into
  // pages in the first place (cdn$ in unsplash.ts: apex or any subdomain)
  // — Unsplash+ results serve from plus.unsplash.com, not just images.*,
  // and an admitted-but-uncredited photo must error whatever unsplash
  // host it rides on.
  // Trailing-dot FQDNs (images.unsplash.com.) are the same host to the
  // browser but would miss the regex — strip one dot so the check fails
  // CLOSED (unrecognized-but-real Unsplash srcs must error, not render).
  const isUnsplashHost = u => {
    try {
      return /(^|\.)unsplash\.com$/.test(new URL(u, document.baseURI).hostname.replace(/\.$/, ''));
    } catch {
      return false;
    }
  };
  // Render-time referral normalization for links back to Unsplash:
  // appends utm_source/utm_medium when absent, preserves every existing
  // query param, never overwrites an existing utm_source, and passes
  // non-Unsplash URLs through untouched. Input is an ABSOLUTE validated
  // http(s) URL (the credit render funnel resolves + validates first).
  const withReferral = href => {
    try {
      const u = new URL(href);
      if (!/(^|\.)unsplash\.com$/.test(u.hostname.replace(/\.$/, ''))) {
        return href;
      }
      if (!u.searchParams.has('utm_source')) {
        u.searchParams.set('utm_source', 'claude_design');
      }
      if (!u.searchParams.has('utm_medium')) {
        u.searchParams.set('utm_medium', 'referral');
      }
      return u.toString();
    } catch (e) {
      return href;
    }
  };
  // 2× a ~600px slot in a 1920-wide deck — retina-sharp without making the
  // sidecar enormous. A 1200px WebP at q=0.85 is ~150-300KB.
  const MAX_DIM = 1200;
  // Raster formats only. SVG is excluded (can carry script; createImageBitmap
  // on SVG blobs is inconsistent). GIF is excluded because the canvas
  // re-encode keeps only the first frame, so an animated GIF would silently
  // go still — better to reject than surprise.
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

  // ── Shared sidecar store ────────────────────────────────────────────────
  // One fetch + immediate write-on-change for every <image-slot> on the
  // page. Reads via fetch() so viewing works anywhere the HTML and sidecar
  // are served together; writes go through window.omelette.writeFile, which
  // the host allowlists to *.state.json basenames only.
  const subs = new Set();
  let slots = {};
  // ids explicitly cleared before the sidecar fetch resolved — otherwise
  // the merge below can't tell "never set" from "just deleted" and would
  // resurrect the sidecar's stale value.
  const tombstones = new Set();
  let loaded = false;
  let loadP = null;
  function load() {
    if (loadP) return loadP;
    loadP = fetch(STATE_FILE).then(r => r.ok ? r.json() : null).then(j => {
      // Merge: sidecar loses to any in-memory change that raced ahead of
      // the fetch (drop or clear) so neither is clobbered by hydration.
      if (j && typeof j === 'object') {
        const merged = Object.assign({}, j, slots);
        // A framing-only write that raced ahead of hydration must not
        // drop a user image that's only on disk — inherit u from the
        // sidecar for any in-memory entry that lacks one.
        for (const k in slots) {
          if (merged[k] && !merged[k].u && j[k]) {
            merged[k].u = typeof j[k] === 'string' ? j[k] : j[k].u;
          }
        }
        for (const id of tombstones) delete merged[id];
        slots = merged;
      }
      tombstones.clear();
    }).catch(() => {}).then(() => {
      loaded = true;
      subs.forEach(fn => fn());
    });
    return loadP;
  }

  // Serialize writes so two near-simultaneous drops on different slots
  // can't reorder at the backend and leave the sidecar with only the
  // first. A save requested mid-flight just marks dirty and re-fires on
  // completion with the then-current slots.
  let saving = false;
  let saveDirty = false;
  // Unload-time flush: save()'s serialization defers a mid-RTT re-fire to a
  // .then that never runs in an unloading document, silently dropping a
  // pagehide commit. Post the current slots immediately instead — content
  // is a superset snapshot of any in-flight save's, the write is a
  // whole-file last-writer-wins replace, and postMessage FIFO delivers it
  // to the host after the in-flight one, so a backend-side reorder at
  // worst reproduces the dropped-commit outcome this flush improves on.
  // Guarded on the initial sidecar read: pre-hydration slots can miss
  // other slots' persisted entries, and flushing it would clobber them —
  // that narrow case stays best-effort (the in-memory merge in load()
  // cannot happen in an unloading document anyway).
  function flushNow() {
    if (!loaded) return;
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    try {
      Promise.resolve(w(STATE_FILE, JSON.stringify(slots))).catch(() => {});
    } catch (e) {}
  }
  function save() {
    if (saving) {
      saveDirty = true;
      return;
    }
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    saving = true;
    Promise.resolve(w(STATE_FILE, JSON.stringify(slots))).catch(() => {}).then(() => {
      saving = false;
      if (saveDirty) {
        saveDirty = false;
        save();
      }
    });
  }
  const S_MAX = 5;
  const clampS = s => Math.max(1, Math.min(S_MAX, s));

  // Normalize a stored slot value. Pre-reframe sidecars stored a bare
  // data-URL string; newer ones store {u, s, x, y}. Either shape is valid.
  function getSlot(id) {
    const v = slots[id];
    if (!v) return null;
    return typeof v === 'string' ? {
      u: v,
      s: 1,
      x: 0,
      y: 0
    } : v;
  }
  function setSlot(id, val) {
    if (!id) return;
    if (val) {
      slots[id] = val;
      tombstones.delete(id);
    } else {
      delete slots[id];
      if (!loaded) tombstones.add(id);
    }
    subs.forEach(fn => fn());
    // A drop is rare + high-value — write immediately so nav-away can't lose
    // it. Gate on the initial read so we don't overwrite a sidecar we haven't
    // merged yet; the merge in load() keeps this change once the read lands.
    if (loaded) save();else load().then(save);
  }

  // ── Image downscale ─────────────────────────────────────────────────────
  // Encode through a canvas so the sidecar carries resized bytes, not the
  // raw upload. Longest side is capped at 2× the slot's rendered width
  // (retina) and at MAX_DIM. WebP keeps alpha and is ~10× smaller than PNG
  // for photos, so there's no need for per-image format picking.
  async function toDataUrl(file, targetW) {
    const bitmap = await createImageBitmap(file);
    try {
      const cap = Math.min(MAX_DIM, Math.max(1, Math.round(targetW * 2)) || MAX_DIM);
      const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return canvas.toDataURL('image/webp', 0.85);
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  // ── Custom element ──────────────────────────────────────────────────────
  const stylesheet =
  // Fill the container by default: slots are usually placed inside a
  // sized wrapper (a hero frame, a grid cell, an inset:0 layer) and are
  // expected to take that box — a fixed intrinsic size would render as
  // a small tile in the corner of a full-bleed wrapper instead.
  // aspect-ratio is the companion fallback that keeps a bare slot
  // visible when the parent's height is indefinite: height:100%
  // resolves to auto there, and the ratio then derives height from
  // width instead of letting the slot collapse to zero height.
  // Explicit width/height on the element override all of this.
  // color:inherit (not a fixed near-black): the placeholder chrome —
  // empty-state icon/caption (currentColor) and the dashed ring — must
  // read on dark decks too, and the slide's own text color is the one
  // color guaranteed to contrast with the slide background. The soft
  // look comes from opacity on those parts, not from a baked-in alpha.
  ':host{display:block;position:relative;' + '  font:13px/1.3 system-ui,-apple-system,sans-serif;' + '  width:100%;height:100%;aspect-ratio:3/2}' + '.empty .cap,.empty .sub{opacity:.75}' + '.frame{position:absolute;inset:0;overflow:hidden;background:rgba(127,127,127,.08)}' +
  // .frame img (clipped) and .spill (unclipped ghost + handles) share the
  // same left/top/width/height in frame-%, computed by _applyView(), so the
  // inside-mask crop and the outside-mask spill stay pixel-aligned.
  '.frame img{position:absolute;max-width:none;transform:translate(-50%,-50%);' + '  -webkit-user-drag:none;user-select:none;touch-action:none}' +
  // Reframe mode (double-click): the full image spills past the mask. The
  // spill layer is sized to the IMAGE bounds so its corners are where the
  // resize handles belong. The ghost <img> inside is translucent; the real
  // clipped <img> underneath shows the opaque in-mask crop.
  // popover=manual promotes the spill to the top layer on reframe, so it is
  // not clipped by any overflow:hidden / clip-path / scroll-container
  // ancestor (a plain z-index can't escape overflow clipping). UA popover
  // defaults (inset:0;margin:auto) are reset; _applyView sets viewport px.
  '.spill{position:fixed;margin:0;inset:auto;border:0;padding:0;background:transparent;' + '  overflow:visible;transform:translate(-50%,-50%);z-index:1;cursor:grab;touch-action:none}' + ':host([data-panning]) .spill{cursor:grabbing}' + '.spill .ghost{position:absolute;inset:0;width:100%;height:100%;opacity:.35;' + '  pointer-events:none;-webkit-user-drag:none;user-select:none;' + '  box-shadow:0 0 0 1px rgba(0,0,0,.2),0 12px 32px rgba(0,0,0,.2)}' + '.spill .handle{position:absolute;width:12px;height:12px;border-radius:50%;' + '  background:#fff;box-shadow:0 0 0 1.5px #c96442,0 1px 3px rgba(0,0,0,.3);' + '  transform:translate(-50%,-50%)}' + '.spill .handle[data-c=nw]{left:0;top:0;cursor:nwse-resize}' + '.spill .handle[data-c=ne]{left:100%;top:0;cursor:nesw-resize}' + '.spill .handle[data-c=sw]{left:0;top:100%;cursor:nesw-resize}' + '.spill .handle[data-c=se]{left:100%;top:100%;cursor:nwse-resize}' + ':host([data-reframe]){z-index:10}' + ':host([data-reframe]) .frame{box-shadow:0 0 0 2px #c96442}' + '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' + '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' + '  cursor:pointer;user-select:none}' + '.empty svg{opacity:.45}' + '.empty .cap{max-width:90%;font-weight:500;letter-spacing:.01em}' + '.empty .sub{font-size:11px}' + '.empty .sub u{text-underline-offset:2px}' + '.empty:hover .sub{opacity:1}' + ':host([data-over]) .frame{outline:2px solid #c96442;outline-offset:-2px;' + '  background:rgba(201,100,66,.10)}' + '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed currentColor;' + '  opacity:.35;transition:border-color .12s,opacity .12s}' + ':host([data-over]) .ring{border-color:#c96442;opacity:1}' + ':host([data-filled]) .ring{display:none}' +
  // Controls overlay INSIDE the frame, pinned to the top-right corner, so
  // a full-bleed slot in an overflow:hidden container still shows them
  // (the old below-mask placement got clipped). Credit sits bottom-left,
  // so top-right avoids collision. The blurred pill background keeps them
  // legible over the image.
  // The UA [popover] base rule styles the element in EVERY state (only
  // display:none is gated on :not(:popover-open), and the display:flex
  // below overrides that) — so the UA resets live HERE, like .spill's,
  // or the ordinary hover-state strip renders as a bordered Canvas box
  // centered by margin:auto. inset:auto precedes top/right (shorthand).
  '.ctl{position:absolute;inset:auto;top:8px;right:8px;margin:0;border:0;padding:0;' + '  background:transparent;overflow:visible;' + '  display:flex;gap:6px;opacity:0;pointer-events:none;transition:opacity .12s;z-index:2;' + '  white-space:nowrap}' +
  // While reframing, the spill owns the top layer and would swallow every
  // click on the in-frame controls. Promoting .ctl into the top layer
  // ABOVE the spill (shown after it — later popovers stack higher) keeps
  // Edit-as-toggle and Replace clickable mid-reframe. _applyView pins it
  // to the frame's top-right in viewport px (translateX(-100%)
  // right-aligns against the computed left edge); inset:auto clears the
  // base rule's top/right so the inline left/top position it alone.
  '.ctl:popover-open{position:fixed;inset:auto;transform:translateX(-100%)}' + ':host([data-filled][data-editable]:hover) .ctl,:host([data-reframe]) .ctl' + '  {opacity:1;pointer-events:auto}' + '.ctl button{appearance:none;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;' + '  background:rgba(0,0,0,.65);color:#fff;font:11px/1 system-ui,-apple-system,sans-serif;' + '  backdrop-filter:blur(6px)}' + '.ctl button:hover{background:rgba(0,0,0,.8)}' + '.err{position:absolute;left:8px;bottom:8px;right:8px;color:#b3261e;font-size:11px;' + '  background:rgba(255,255,255,.85);padding:4px 6px;border-radius:5px;pointer-events:none}' +
  // Replacement in flight: after a src swap the browser keeps painting
  // the PREVIOUS image until the new one decodes, so a Replace would
  // flash the old photo and then pop. Hide the stale frame (visibility,
  // not display — _applyView geometry still applies) and spin until the
  // new image reports in (load/error clears data-swapping).
  ':host([data-swapping]) .frame img{visibility:hidden}' + '.loading{position:absolute;inset:0;display:none;align-items:center;' + '  justify-content:center;pointer-events:none}' + ':host([data-swapping]) .loading{display:flex}' + '.loading::after{content:"";width:22px;height:22px;border-radius:50%;' + '  border:2px solid rgba(127,127,127,.25);border-top-color:currentColor;' + '  animation:om-slot-spin .7s linear infinite}' + '@keyframes om-slot-spin{to{transform:rotate(360deg)}}' +
  // Reduced motion: the static two-tone ring still reads as "working".
  '@media (prefers-reduced-motion:reduce){.loading::after{animation:none}}' + '.credit{position:absolute;left:6px;bottom:6px;max-width:calc(100% - 12px);display:none;' + '  padding:3px 7px;border-radius:5px;background:rgba(0,0,0,.55);color:#fff;' + '  font:10px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;' + '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(6px)}' +
  // The credit is a SPAN holding one or two <a>s (Unsplash's prescribed
  // form links the photographer AND Unsplash) — anchors style inline so
  // the overlay reads as one line of text.
  '.credit a{color:inherit;text-decoration:none}' + '.credit a:hover,.credit a:focus-visible{text-decoration:underline}' + ':host([data-filled][data-credit]) .credit{display:block}' +
  // Exports must ship JUST the image — no hover controls, no credit chip
  // (the host marks <html data-om-exporting> for the capture window; the
  // page-level hide script can't reach shadow DOM, this rule can).
  ':host-context([data-om-exporting]) .ctl,' + ':host-context([data-om-exporting]) .credit{display:none !important}' +
  // Print must ship just the image too: the hover-gated controls can be
  // mid-hover when print() fires, and the credit chip is screen chrome —
  // the same rule the capture window gets, keyed on print media instead
  // of the host's data-om-exporting mark (the print path sets no mark).
  '@media print{.ctl,.credit{display:none !important}}' +
  // No export-window mask rules here on purpose: the export capture
  // releases the replacement mask by REMOVING data-swapping (the
  // shadow-root pass in pages/export/shared.ts HIDE_EXPORT_CHROME_SCRIPT)
  // — attribute removal works in every engine (:host-context is
  // Chromium-only), is scoped by construction to slots actually
  // mid-swap, and hides the spinner through the same gate. A masked img
  // would otherwise be silently dropped from PPTX decks (the capture
  // walk skips visibility:hidden imgs).
  // Attribution error tile: REPLACES the photo when an Unsplash src has
  // no credit attribute — rendering the photo uncredited is the terms
  // violation, so the photo must not appear at all.
  // Calm and neutral on purpose (review feedback): the tile informs the
  // user; the fix instructions are machine-facing (usage docblock, tool
  // description, and the turn-end scan's bounce copy name the attributes
  // for the agent).
  '.attr-error{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;' + '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' + '  background:#f2f1ef;color:#6e6c66;user-select:none;' + '  font:13px/1.45 system-ui,-apple-system,sans-serif}' + '.attr-error svg{opacity:.55}' + '.attr-error .cap{max-width:92%;font-weight:500;letter-spacing:.01em}' + ':host([data-attribution-error]) .attr-error{display:flex}' + ':host([data-attribution-error]) .ring{display:none}';
  const icon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' + '<path d="m21 15-5-5L5 21"/></svg>';
  const warnIcon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' + '<path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['shape', 'radius', 'mask', 'fit', 'placeholder', 'src', 'id', 'credit', 'credit-href'];
    }

    /** Duplicate-slide hook (called by deck-stage, see its
     *  _remintDuplicateIds): copy this id's stored image, if any, under a
     *  freshly minted key and return that key — so a duplicated slide's
     *  slot keeps its dropped photo instead of reverting to the
     *  placeholder. 'isFree' is the caller's uniqueness check (document
     *  ids); candidates must ALSO be unused in the sidecar, which can
     *  hold keys from other pages sharing the project root. (An EMPTY
     *  slot on another page leaves no sidecar entry, so its id is not
     *  detectable here — a minted key can collide with it and that slot
     *  would show this photo. Same blast radius as two pages reusing an
     *  id by hand, which the shared sidecar already permits.) Returns null
     *  when no id could be minted (caller strips the id, today's
     *  behavior). */
    static cloneSlot(fromId, isFree) {
      if (typeof fromId !== 'string' || !fromId) return null;
      // Pre-hydration the store can't veto candidates or source the copy
      // — degrade to the strip (today's behavior) rather than mint
      // against keys we can't see yet. Any rendered (= droppable) slot
      // means load() has already settled.
      if (!loaded) return null;
      const stem = fromId.replace(/-\d+$/, '') || fromId;
      for (let n = 2; n < 100; n++) {
        const toId = stem + '-' + n;
        if (toId === fromId) continue;
        if (slots[toId] !== undefined) {
          // Reuse a key holding this exact value (bytes AND crop) if no
          // live element here owns it — a duplicate op the host refused
          // after minting leaves such a key behind, and reusing keeps
          // refused retries from accumulating one orphaned copy per
          // attempt. Full equality (not just bytes) so a byte-identical
          // key another PAGE owns with its own crop is stepped past, not
          // adopted or rewritten. (Entries without .u never match.)
          const prev = getSlot(toId);
          const cur = getSlot(fromId);
          if (!(prev && cur && prev.u && prev.u === cur.u && prev.s === cur.s && prev.x === cur.x && prev.y === cur.y && (typeof isFree !== 'function' || isFree(toId)))) continue;
          return toId;
        }
        if (typeof isFree === 'function' && !isFree(toId)) continue;
        const v = getSlot(fromId);
        if (v) setSlot(toId, Object.assign({}, v));
        return toId;
      }
      return null;
    }
    constructor() {
      super();
      // clonable: rail thumbnails deep-clone slides and carry this shadow
      // along; reuse an already-cloned root so upgrade-after-clone works.
      // (Deliberately NOT serializable — a getHTML consumer would embed
      // multi-MB sidecar data-URLs into serialized page HTML.)
      const root = this.shadowRoot || this.attachShadow({
        mode: 'open',
        clonable: true
      });
      // .spill and .ctl sit OUTSIDE .frame so overflow:hidden + border-radius
      // on the frame (circle, pill, rounded) can't clip them.
      root.innerHTML = '<style>' + stylesheet + '</style>' + '<div class="frame" part="frame">' + '  <img part="image" alt="" draggable="false" style="display:none">' + '  <div class="empty" part="empty">' + icon + '    <div class="cap"></div>' + '    <div class="sub">or <u>browse files</u></div></div>' + '  <div class="attr-error" part="attribution-error">' + warnIcon + '    <div class="cap">This photo needs attribution</div></div>' + '  <div class="loading" part="loading"></div>' + '  <div class="ring" part="ring"></div>' + '</div>' +
      // Outside .frame, like .spill/.ctl — the frame's overflow:hidden +
      // border-radius/clip-path would cut the credit off on circle/pill/mask.
      // A SPAN, not an <a>: the prescribed Unsplash credit holds two links
      // (photographer + Unsplash), built per-render in _render().
      '<span class="credit" part="credit"></span>' + '<div class="spill" popover="manual" data-dc-edit-transparent>' + '  <img class="ghost" alt="" draggable="false">' + '  <div class="handle" data-c="nw"></div><div class="handle" data-c="ne"></div>' + '  <div class="handle" data-c="sw"></div><div class="handle" data-c="se"></div>' + '</div>' +
      // data-dc-edit-transparent: the DC editor's edit-mode picker lets
      // clicks through for chrome marked with it (EDIT_TRANSPARENT_SEL)
      // — without it, Replace/Edit clicks in Edit mode are swallowed by
      // element selection and the controls look dead.
      '<div class="ctl" popover="manual" data-dc-edit-transparent><button data-act="replace" title="Replace image">Replace</button>' + '  <button data-act="edit" title="Reframe image">Edit</button></div>' + '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._ring = root.querySelector('.ring');
      this._img = root.querySelector('.frame img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._sub = root.querySelector('.sub');
      this._spill = root.querySelector('.spill');
      this._ctl = root.querySelector('.ctl');
      this._credit = root.querySelector('.credit');
      this._attrError = root.querySelector('.attr-error');
      // Credit clicks open the link, not browse/reframe.
      this._credit.addEventListener('click', e => e.stopPropagation());
      this._credit.addEventListener('dblclick', e => e.stopPropagation());
      this._ghost = root.querySelector('.ghost');
      this._err = null;
      this._input = root.querySelector('input');
      this._depth = 0;
      this._gen = 0;
      // Encode-in-flight marker (the owning _ingest generation): while set,
      // the same-src "nothing in flight" clear in _render must not fire —
      // the stored value still points at the OLD image until the encode
      // lands, so that clear would unmask the stale image mid-replace.
      this._swapGen = 0;
      // Render-owned swap in flight: set when _render assigns a new src,
      // cleared only by the img's own load/error (or the empty branch).
      // img.complete CANNOT stand in for this — setting src only QUEUES
      // the current-request swap (a microtask), so synchronously after an
      // assignment, complete still reports the OLD settled request. The
      // pick path does exactly that: the host sets src, credit, and
      // credit-href back-to-back in one task, and renders #2/#3 would
      // read the stale complete === true and drop the mask one render
      // after it was set.
      this._loadPending = false;
      // See _render's empty branch: a transient attribution-error wipe of a
      // showing image must make the follow-up render a replacement (spinner),
      // not a first fill (blank frame).
      this._hidShowing = false;
      this._view = {
        s: 1,
        x: 0,
        y: 0
      };
      this._subFn = () => this._render();
      // Shadow-DOM listeners live with the shadow DOM — bound once here so
      // disconnect/reconnect (e.g. React remount) doesn't stack handlers.
      this._empty.addEventListener('click', () => this._input.click());
      root.addEventListener('click', e => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        // The hidden controls are opacity-0 but still tabbable — without
        // this gate a keyboard user could drive them on a read-only share
        // link (mirrors the dblclick handler's editable gate).
        if (!this.hasAttribute('data-editable')) return;
        if (act === 'replace') {
          this._exitReframe(true);
          // Host-owned picker (Unsplash modal; it also offers local import).
          this.dispatchEvent(new CustomEvent('image-slot:pick', {
            bubbles: true,
            composed: true,
            detail: {
              id: this.id || null
            }
          }));
        }
        if (act === 'edit') {
          if (!this._reframes()) return;
          if (this.hasAttribute('data-reframe')) this._exitReframe(true);else this._enterReframe();
        }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
      // naturalWidth/Height aren't known until load — re-apply so the cover
      // baseline is computed from real dimensions, not the 100%×100% fallback.
      // load/error also release the replacement-in-flight mask (via the
      // single discipline in _releaseMask): the swap is only revealed once
      // the new image can actually paint (on error the frame shows its
      // background, same as a fresh slot with a broken src).
      this._img.addEventListener('load', () => {
        this._loadPending = false;
        this._releaseMask(true);
        this._applyView();
      });
      this._img.addEventListener('error', () => {
        this._loadPending = false;
        this._releaseMask(true);
      });
      // Gated only on editable — any filled slot can be repositioned/scaled,
      // regardless of fit. Share links (no writeFile) stay static.
      this.addEventListener('dblclick', e => {
        if (!this.hasAttribute('data-editable') || !this._reframes()) return;
        e.preventDefault();
        if (this.hasAttribute('data-reframe')) this._exitReframe(true);else this._enterReframe();
      });
      // Pan + resize both originate on the spill layer. A handle pointerdown
      // drives an aspect-locked resize anchored at the opposite corner; any
      // other pointerdown on the spill pans. Offsets are frame-% so a
      // reframed slot survives responsive resize / PPTX export.
      this._spill.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        e.stopPropagation();
        this._spill.setPointerCapture(e.pointerId);
        const rect = this.getBoundingClientRect();
        const fw = rect.width || 1,
          fh = rect.height || 1;
        const corner = e.target.getAttribute && e.target.getAttribute('data-c');
        let move;
        if (corner) {
          // Resize about the OPPOSITE corner. Viewport-px throughout (rect
          // fw/fh, not clientWidth) so the math survives a transform:scale()
          // ancestor — deck_stage renders slides scaled-to-fit.
          const iw = this._img.naturalWidth || 1,
            ih = this._img.naturalHeight || 1;
          const contain = (this.getAttribute('fit') || 'cover').toLowerCase() === 'contain';
          const base = contain ? Math.min(fw / iw, fh / ih) : Math.max(fw / iw, fh / ih);
          const sx = corner.includes('e') ? 1 : -1;
          const sy = corner.includes('s') ? 1 : -1;
          const s0 = this._view.s;
          const w0 = iw * base * s0,
            h0 = ih * base * s0;
          const cx0 = (50 + this._view.x) / 100 * fw;
          const cy0 = (50 + this._view.y) / 100 * fh;
          const ox = cx0 - sx * w0 / 2,
            oy = cy0 - sy * h0 / 2;
          const diag0 = Math.hypot(w0, h0);
          const ux = sx * w0 / diag0,
            uy = sy * h0 / diag0;
          move = ev => {
            const proj = (ev.clientX - rect.left - ox) * ux + (ev.clientY - rect.top - oy) * uy;
            const s = clampS(s0 * proj / diag0);
            const d = diag0 * s / s0;
            this._view.s = s;
            this._view.x = (ox + ux * d / 2) / fw * 100 - 50;
            this._view.y = (oy + uy * d / 2) / fh * 100 - 50;
            this._clampView();
            this._applyView();
          };
        } else {
          this.setAttribute('data-panning', '');
          const start = {
            px: e.clientX,
            py: e.clientY,
            x: this._view.x,
            y: this._view.y
          };
          move = ev => {
            this._view.x = start.x + (ev.clientX - start.px) / fw * 100;
            this._view.y = start.y + (ev.clientY - start.py) / fh * 100;
            this._clampView();
            this._applyView();
          };
        }
        const up = () => {
          try {
            this._spill.releasePointerCapture(e.pointerId);
          } catch {}
          this._spill.removeEventListener('pointermove', move);
          this._spill.removeEventListener('pointerup', up);
          this._spill.removeEventListener('pointercancel', up);
          this.removeAttribute('data-panning');
          this._dragUp = null;
        };
        // Stashed so _exitReframe (Escape / outside-click mid-drag) can
        // tear the capture + listeners down synchronously.
        this._dragUp = up;
        this._spill.addEventListener('pointermove', move);
        this._spill.addEventListener('pointerup', up);
        this._spill.addEventListener('pointercancel', up);
      });
      // Wheel zoom stays available inside reframe mode as a trackpad nicety —
      // zooms toward the cursor (offset' = cursor·(1-k) + offset·k).
      this.addEventListener('wheel', e => {
        if (!this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        const r = this.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width * 100 - 50;
        const cy = (e.clientY - r.top) / r.height * 100 - 50;
        const prev = this._view.s;
        const next = clampS(prev * Math.pow(1.0015, -e.deltaY));
        if (next === prev) return;
        const k = next / prev;
        this._view.s = next;
        this._view.x = cx * (1 - k) + this._view.x * k;
        this._view.y = cy * (1 - k) + this._view.y * k;
        this._clampView();
        this._applyView();
      }, {
        passive: false
      });
    }
    connectedCallback() {
      // Warn once per page — an id-less slot works for the session but
      // cannot persist, and two id-less slots would share nothing.
      if (!this.id && !ImageSlot._warned) {
        ImageSlot._warned = true;
        console.warn('<image-slot> without an id will not persist its dropped image.');
      }
      this.addEventListener('dragenter', this);
      this.addEventListener('dragover', this);
      this.addEventListener('dragleave', this);
      this.addEventListener('drop', this);
      subs.add(this._subFn);
      // The host may inject window.omelette.writeFile AFTER the first render;
      // re-render on hover so the editable-gated controls reliably appear.
      this.addEventListener('pointerenter', this._subFn);
      // width%/height% in _applyView encode the frame aspect at call time —
      // a host resize (responsive grid, pane divider) would stretch the
      // image until the next _render. Re-render on size change: _render()
      // re-seeds _view from stored before clamp/apply, so a shrink→grow
      // cycle round-trips instead of ratcheting x/y toward the narrower
      // frame's clamp range.
      this._ro = new ResizeObserver(() => this._render());
      this._ro.observe(this);
      load();
      this._render();
    }
    disconnectedCallback() {
      subs.delete(this._subFn);
      this.removeEventListener('pointerenter', this._subFn);
      this.removeEventListener('dragenter', this);
      this.removeEventListener('dragover', this);
      this.removeEventListener('dragleave', this);
      this.removeEventListener('drop', this);
      if (this._ro) {
        this._ro.disconnect();
        this._ro = null;
      }
      // commit=false: a disconnect is not a user intent — committing here
      // would persist whatever half-finished drag a React remount or DOM
      // splice happened to interrupt. Deliberate exits commit on their own
      // paths (Escape/click-out/toggle), and unloads commit via pagehide.
      this._exitReframe(false);
    }
    _enterReframe() {
      if (this.hasAttribute('data-reframe')) return;
      this.setAttribute('data-reframe', '');
      this._signalReframe(true);
      // Best-effort commit when the document unloads mid-reframe (a host
      // navigation racing the enter signal, a manual reload, tab close):
      // the sidecar write rides the host bridge, which outlives this
      // document, so the crop survives even though the mode dies with the
      // DOM. Held on the instance so _exitReframe detaches exactly what
      // was attached.
      this._pagehide = () => {
        this._exitReframe(true);
        flushNow();
      };
      window.addEventListener('pagehide', this._pagehide);
      // Promote spill to the top layer, then keep it pinned over the frame:
      // scroll/resize cover the common cases, and a per-frame rect check
      // catches layout shifts that fire neither (an image above finishing
      // load, streamed DOM pushing the slot down, an ancestor transform
      // change) so the overlay can't detach from the frame.
      try {
        this._spill.showPopover();
      } catch {}
      // After the spill, so the controls stack above it in the top layer.
      try {
        this._ctl.showPopover();
      } catch {}
      this._reposition = () => {
        if (this.hasAttribute('data-reframe')) this._applyView();
      };
      window.addEventListener('scroll', this._reposition, true);
      window.addEventListener('resize', this._reposition);
      this._lastRect = '';
      this._watch = () => {
        if (!this.hasAttribute('data-reframe')) return;
        const r = this.getBoundingClientRect();
        const key = r.left + ',' + r.top + ',' + r.width + ',' + r.height;
        if (key !== this._lastRect) {
          this._lastRect = key;
          this._applyView();
        }
        this._watchId = requestAnimationFrame(this._watch);
      };
      this._watchId = requestAnimationFrame(this._watch);
      this._applyView();
      // Close on click outside (the spill handler stopPropagation()s so
      // in-image drags don't reach this) and on Escape. Listeners are held
      // on the instance so _exitReframe / disconnectedCallback can detach
      // exactly what was attached.
      this._outside = e => {
        if (e.composedPath && e.composedPath().includes(this)) return;
        this._exitReframe(true);
      };
      this._esc = e => {
        if (e.key === 'Escape') this._exitReframe(true);
      };
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
    }
    _exitReframe(commit) {
      if (!this.hasAttribute('data-reframe')) return;
      if (this._dragUp) this._dragUp();
      this.removeAttribute('data-reframe');
      this.removeAttribute('data-panning');
      if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
      if (this._esc) document.removeEventListener('keydown', this._esc, true);
      this._outside = this._esc = null;
      if (this._reposition) {
        window.removeEventListener('scroll', this._reposition, true);
        window.removeEventListener('resize', this._reposition);
        this._reposition = null;
      }
      if (this._watchId) {
        cancelAnimationFrame(this._watchId);
        this._watchId = 0;
      }
      if (this._pagehide) {
        window.removeEventListener('pagehide', this._pagehide);
        this._pagehide = null;
      }
      try {
        this._spill.hidePopover();
      } catch {}
      try {
        this._ctl.hidePopover();
      } catch {}
      this._ctl.style.left = '';
      this._ctl.style.top = '';
      if (commit) this._commitView();
      this._signalReframe(false);
    }

    // Reframe state lives only in this DOM until commit, invisible to the
    // host's dirty signals — announce enter/exit so the host can hold
    // auto-reloads for exactly the gesture (the guest bundle forwards
    // image-slot:reframe to the host as imageSlotReframe). Dispatched on
    // the element (composed, so it escapes shadow roots) while connected;
    // a disconnected exit (disconnectedCallback) falls back to document so
    // the host still hears it.
    _signalReframe(active) {
      const target = this.isConnected ? this : document;
      target.dispatchEvent(new CustomEvent('image-slot:reframe', {
        bubbles: true,
        composed: true,
        detail: {
          active: active,
          id: this.id || null
        }
      }));
    }

    // Public: host's "Import from computer" calls this to run local browse.
    openFilePicker() {
      this._exitReframe(true);
      this._input.click();
    }

    // A src write is a newer intent for this slot's content — the host
    // pick path (setImageSlotImage) or an agent edit — so it must win
    // over any encode still in flight from an earlier drop: left live,
    // that encode lands later, passes _ingest's gen guard, and its
    // setSlot silently overwrites the pick (the stored value shadows
    // src in _render). Bumping _gen kills the encode before its own
    // _swapGen clear runs, so clear the dead claim here too — otherwise
    // _releaseMask (gated on !_swapGen) never fires and the pick's
    // spinner is stranded. src ONLY: the pick sets credit/credit-href
    // in the same task, and clearing _swapGen on those would let the
    // same-src branch unmask the old image mid-encode.
    attributeChangedCallback(name, oldVal, newVal) {
      if (name === 'src' && oldVal !== newVal) {
        this._gen++;
        this._swapGen = 0;
      }
      if (this.shadowRoot) this._render();
    }

    // handleEvent — one listener object for all four drag events keeps the
    // add/remove symmetric and the depth counter correct.
    handleEvent(e) {
      if (e.type === 'dragenter' || e.type === 'dragover') {
        // Without preventDefault the browser never fires 'drop'.
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (e.type === 'dragenter') this._depth++;
        this.setAttribute('data-over', '');
      } else if (e.type === 'dragleave') {
        // dragenter/leave fire for every descendant crossing — count depth
        // so hovering the icon inside the empty state doesn't flicker.
        if (--this._depth <= 0) {
          this._depth = 0;
          this.removeAttribute('data-over');
        }
      } else if (e.type === 'drop') {
        e.preventDefault();
        e.stopPropagation();
        this._depth = 0;
        this.removeAttribute('data-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._ingest(f);
      }
    }
    async _ingest(file) {
      this._setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) {
        this._setError('Drop a PNG, JPEG, WebP, or AVIF image.');
        return;
      }
      // toDataUrl can take hundreds of ms on a large photo. A Clear or a
      // newer drop during that window would be clobbered when this await
      // resumes — bump + capture a generation so stale encodes bail.
      const gen = ++this._gen;
      // Replacing a shown image: surface the swap through the encode too,
      // not just the decode — otherwise the old photo sits there with no
      // feedback while the canvas re-encode runs. An empty slot keeps its
      // placeholder (no spinner) until the encode lands, as before.
      // _swapGen guards the mask against re-renders DURING the encode
      // (pointerenter, ResizeObserver, another slot's store write): the
      // stored value still resolves to the old image there, so _render's
      // same-src clear would otherwise unmask it mid-replace.
      if (this.hasAttribute('data-filled')) {
        this.setAttribute('data-swapping', '');
        this._swapGen = gen;
      }
      try {
        const w = this.clientWidth || this.offsetWidth || MAX_DIM;
        const url = await toDataUrl(file, w);
        if (gen !== this._gen) return;
        // Only exit reframe once the new image is in hand — a rejected type
        // or decode failure leaves the in-progress crop untouched.
        this._exitReframe(false);
        // Clear BEFORE setSlot: its synchronous re-render must see no
        // pending encode, so a byte-identical re-upload (same data URL, no
        // load event coming) still clears the mask via the complete branch.
        this._swapGen = 0;
        const val = {
          u: url,
          s: 1,
          x: 0,
          y: 0
        };
        setSlot(this.id || '', val);
        // Keep a session-local copy for id-less slots so the drop still
        // shows, even though it cannot persist.
        if (!this.id) {
          this._local = val;
          this._render();
        }
      } catch (err) {
        if (gen !== this._gen) return;
        this._swapGen = 0;
        // Reveal the kept old image — unless another replacement (a
        // remote pick's src swap) is still in flight, in which case the
        // mask stays until THAT image settles (its load/error releases).
        this._releaseMask();
        this._setError('Could not read that image.');
        console.warn('<image-slot> ingest failed:', err);
      }
    }
    _setError(msg) {
      if (this._err) {
        this._err.remove();
        this._err = null;
      }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err';
      d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => {
        if (this._err === d) {
          d.remove();
          this._err = null;
        }
      }, 3000);
    }

    // Reframing (pan/resize) is available on any filled slot — the user can
    // always reposition/scale. `fit` only sets the initial baseline (see
    // _geom): contain starts fully-visible, cover starts frame-filling.
    _reframes() {
      return this.hasAttribute('data-filled');
    }

    // The single release discipline for the replacement-in-flight mask
    // (data-swapping). The mask comes off only when BOTH hold:
    //  - no encode is pending (_swapGen) — mid-encode the stored value
    //    still resolves to the old image, so any reveal paints it;
    //  - the frame img has settled on its current src — an unsettled src
    //    means some replacement is still in flight (e.g. a remote pick),
    //    whoever started it, and revealing would paint the previous
    //    frame. The load/error listeners pass settled=true (the event IS
    //    the settlement signal, per spec complete is true by then);
    //    other callers rely on the complete flag (covers loaded AND
    //    failed).
    // Every release path funnels through here EXCEPT _render's empty
    // branch (the img is being cleared — nothing will ever settle).
    _releaseMask(settled) {
      if (!this._swapGen && !this._loadPending && (settled || this._img.complete)) {
        this.removeAttribute('data-swapping');
      }
    }

    // Baseline geometry, shared by clamp/apply/resize. `base` is the scale at
    // view-scale s=1: cover = fill the frame (overflow on the looser axis),
    // contain = fit fully inside (letterboxed). Zooming a contain image past
    // s where it overflows naturally becomes a crop. Null until the img has
    // loaded (naturalWidth is 0 before that) or when the slot has no layout
    // box — ResizeObserver fires with a 0×0 rect under display:none, and
    // clamping against a degenerate 1×1 frame would silently pull the stored
    // pan toward zero.
    _geom() {
      const iw = this._img.naturalWidth,
        ih = this._img.naturalHeight;
      const fw = this.clientWidth,
        fh = this.clientHeight;
      if (!iw || !ih || !fw || !fh) return null;
      const contain = (this.getAttribute('fit') || 'cover').toLowerCase() === 'contain';
      const base = contain ? Math.min(fw / iw, fh / ih) : Math.max(fw / iw, fh / ih);
      return {
        iw,
        ih,
        fw,
        fh,
        base
      };
    }
    _clampView() {
      // Pan range on each axis is half the overflow past the frame edge.
      const g = this._geom();
      if (!g) return;
      const mx = Math.max(0, (g.iw * g.base * this._view.s / g.fw - 1) * 50);
      const my = Math.max(0, (g.ih * g.base * this._view.s / g.fh - 1) * 50);
      this._view.x = Math.max(-mx, Math.min(mx, this._view.x));
      this._view.y = Math.max(-my, Math.min(my, this._view.y));
    }
    _applyView() {
      const g = this._geom();
      // Top-layer controls: pin to the frame's top-right in viewport px
      // (the same 8px inset as the in-frame layout; unscaled — top-layer UI
      // reads as chrome, not page content). BEFORE the geometry branch:
      // placement needs only the frame rect, and a not-yet-loaded or broken
      // src must not leave the promoted strip floating unpositioned. Gated
      // on the popover actually being open: without the Popover API,
      // showPopover() threw (swallowed in _enterReframe), .ctl stays in
      // its in-frame absolute layout, and viewport-px coordinates would
      // shove it off-frame — and matches(':popover-open') itself throws
      // there (unknown pseudo-class), hence the try/catch.
      if (this.hasAttribute('data-reframe')) {
        let onTop = false;
        try {
          onTop = this._ctl.matches(':popover-open');
        } catch {}
        if (onTop) {
          const r = this.getBoundingClientRect();
          this._ctl.style.left = r.right - 8 + 'px';
          this._ctl.style.top = r.top + 8 + 'px';
        }
      }
      if (!g) {
        // Dimensions not known yet (before img load) — centered fit so there
        // is no flash of an unpositioned image before the geometry lands.
        const contain = (this.getAttribute('fit') || 'cover').toLowerCase() === 'contain';
        this._img.style.width = '100%';
        this._img.style.height = '100%';
        this._img.style.left = '50%';
        this._img.style.top = '50%';
        this._img.style.objectFit = contain ? 'contain' : 'cover';
        return;
      }
      // Baseline (cover-fill or contain-fit) × view scale. Width/height and
      // left/top are all frame-% — depends only on the frame aspect ratio, so
      // a responsive resize keeps the same crop. The spill layer mirrors the
      // same box so its corners = image corners.
      const k = g.base * this._view.s;
      const w = g.iw * k / g.fw * 100 + '%';
      const h = g.ih * k / g.fh * 100 + '%';
      const l = 50 + this._view.x + '%';
      const t = 50 + this._view.y + '%';
      this._img.style.width = w;
      this._img.style.height = h;
      this._img.style.left = l;
      this._img.style.top = t;
      this._img.style.objectFit = '';
      if (this.hasAttribute('data-reframe')) {
        // Top-layer spill: position in viewport px over the frame. The top
        // layer escapes ancestor transforms entirely, so EVERY term must be
        // in viewport units: getBoundingClientRect gives the frame's scaled
        // origin AND size, and the rect/layout ratio rescales the ghost —
        // sizing from layout px alone renders it 1/scale too large under a
        // scaled deck slide. Inner ghost + handles stay box-relative.
        const r = this.getBoundingClientRect();
        const sx = g.fw ? r.width / g.fw : 1;
        const sy = g.fh ? r.height / g.fh : 1;
        this._spill.style.width = g.iw * k * sx + 'px';
        this._spill.style.height = g.ih * k * sy + 'px';
        this._spill.style.left = r.left + (50 + this._view.x) / 100 * r.width + 'px';
        this._spill.style.top = r.top + (50 + this._view.y) / 100 * r.height + 'px';
      }
    }
    _commitView() {
      const v = {
        s: this._view.s,
        x: this._view.x,
        y: this._view.y
      };
      if (this._userUrl) v.u = this._userUrl;
      // Framing-only (no u) persists too so an author-src slot remembers its
      // crop; clearing the sidecar still falls through to src=.
      if (this.id) setSlot(this.id, v);else {
        this._local = v;
      }
    }
    _render() {
      // Shape / mask. Presets use border-radius so the dashed ring can
      // follow the rounded outline; clip-path is only applied for an
      // explicit `mask` (the ring is hidden there since a rectangle
      // dashed border chopped by an arbitrary polygon looks broken).
      const mask = this.getAttribute('mask');
      const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
      let radius = '';
      if (shape === 'circle') radius = '50%';else if (shape === 'pill') radius = '9999px';else if (shape === 'rounded') {
        const n = parseFloat(this.getAttribute('radius'));
        radius = (Number.isFinite(n) ? n : 12) + 'px';
      }
      this._frame.style.borderRadius = mask ? '' : radius;
      this._frame.style.clipPath = mask || '';
      this._ring.style.borderRadius = mask ? '' : radius;
      this._ring.style.display = mask ? 'none' : '';

      // Controls and reframe entry gate on this so share links stay read-only.
      const editable = !!(window.omelette && window.omelette.writeFile);
      this.toggleAttribute('data-editable', editable);
      this._sub.style.display = editable ? '' : 'none';

      // Content. The sidecar is also writable by the agent's write_file
      // tool, so its value isn't guaranteed canvas-originated — only accept
      // data:image/ URLs from it. The `src` attribute is author-controlled
      // (Claude wrote it into the HTML) so it passes through unchanged.
      let stored = this.id ? getSlot(this.id) : this._local;
      if (stored && stored.u && !/^data:image\//i.test(stored.u)) stored = null;
      const srcAttr = this.getAttribute('src') || '';
      this._userUrl = stored && stored.u || null;
      const url = this._userUrl || srcAttr;
      // Don't clobber an in-flight reframe with a store-triggered re-render.
      if (!this.hasAttribute('data-reframe')) {
        this._view = {
          s: stored && Number.isFinite(stored.s) ? clampS(stored.s) : 1,
          x: stored && Number.isFinite(stored.x) ? stored.x : 0,
          y: stored && Number.isFinite(stored.y) ? stored.y : 0
        };
      }
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop an image';
      // Toggle via style.display — the [hidden] attribute alone loses to
      // the display:flex / display:block rules in the stylesheet above.
      // An Unsplash src with no credit attribute must NOT render — showing
      // the photo uncredited is the Unsplash-terms violation itself. The
      // error tile replaces the photo until the credit is written. A
      // user-dropped image is the user's own content and always renders.
      // Trimmed: credit is agent/user-editable content, and a whitespace-
      // only value must count as missing — otherwise it would suppress the
      // error tile AND render an empty credit box (no text, no links),
      // exactly the unattributed state this gate exists to prevent.
      const credit = (this.getAttribute('credit') || '').trim();
      const attrError = !!(!credit && !this._userUrl && srcAttr && isUnsplashHost(srcAttr));
      this.toggleAttribute('data-attribution-error', attrError);
      if (url && !attrError) {
        const prev = this._img.getAttribute('src');
        if (prev !== url) {
          // Replacing an already-shown image: mark the swap BEFORE setting
          // src so the stale frame is never revealed (see the data-swapping
          // stylesheet rules). First fill (prev empty) keeps the existing
          // placeholder-until-load behavior — no spinner. _hidShowing
          // covers the pick path's transient attribution-error wipe: prev
          // is gone, but an image WAS showing, so this is a replacement.
          if (prev || this._hidShowing) this.setAttribute('data-swapping', '');
          // Mark the swap BEFORE assigning src: complete keeps reporting
          // the old settled request until the browser's
          // update-the-image-data microtask runs, so same-task re-renders
          // (the pick path's credit/credit-href setAttributes) need this
          // flag, not complete, to know a load is in flight.
          this._loadPending = true;
          this._img.src = url;
          this._ghost.src = url;
        } else {
          // Same-src re-render — release if settled, so an ingest-set
          // spinner can't stick after a byte-identical re-upload (same
          // data URL, no further load event ever fires).
          this._releaseMask();
        }
        this._hidShowing = false;
        this._img.style.display = 'block';
        this._empty.style.display = 'none';
        this.setAttribute('data-filled', '');
        this._clampView();
        this._applyView();
      } else {
        this.removeAttribute('data-swapping');
        // The src is being removed — no load/error will ever fire for it.
        this._loadPending = false;
        // A transient attribution-error wipe of a showing image happens on
        // the pick path: the host sets src one setAttribute before credit,
        // so render N hides the old image (attrError) and render N+1
        // restores a URL. Remember the wipe so that restore renders as a
        // replacement (spinner), not a first fill (blank frame).
        this._hidShowing = attrError && !!this._img.getAttribute('src');
        this._img.style.display = 'none';
        this._img.removeAttribute('src');
        this._ghost.removeAttribute('src');
        // The error tile owns the blocked-photo state; .empty stays for
        // the genuinely-empty slot.
        this._empty.style.display = attrError ? 'none' : 'flex';
        this.removeAttribute('data-filled');
      }

      // Credit belongs to the author src, so a user drop hides it.
      // textContent + the http(s)-only funnel keep external strings inert.
      const showCredit = !!(url && credit && !this._userUrl && !attrError);
      this._credit.textContent = '';
      if (showCredit) {
        // Validate once (resolved against the document, http(s) only),
        // then append the terms-required utm referral params to links
        // that point back at unsplash.com.
        let href = '';
        const rawHref = this.getAttribute('credit-href') || '';
        if (rawHref) {
          try {
            const u = new URL(rawHref, document.baseURI);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              href = withReferral(u.href);
            }
          } catch {}
        }
        const mkLink = (text, linkHref) => {
          const a = document.createElement('a');
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          a.setAttribute('href', linkHref);
          a.textContent = text;
          return a;
        };
        // Unsplash's prescribed credit is TWO links — the photographer's
        // name to their profile (credit-href) and 'Unsplash' to the
        // homepage. Render that split whenever the text has the canonical
        // shape; other text keeps the legacy single-link rendering.
        const m = /^Photo by (.+) on Unsplash$/.exec(credit);
        if (m) {
          this._credit.appendChild(document.createTextNode('Photo by '));
          this._credit.appendChild(href ? mkLink(m[1], href) : document.createTextNode(m[1]));
          this._credit.appendChild(document.createTextNode(' on '));
          this._credit.appendChild(mkLink('Unsplash', UNSPLASH_HOMEPAGE_HREF));
        } else if (href) {
          this._credit.appendChild(mkLink(credit, href));
        } else {
          this._credit.textContent = credit;
        }
      }
      this.toggleAttribute('data-credit', showCredit);
    }
  }
  if (!customElements.get('image-slot')) {
    customElements.define('image-slot', ImageSlot);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rekanara/image-slot.js", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.SyncIndicator = __ds_scope.SyncIndicator;

__ds_ns.Table = __ds_scope.Table;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Stepper = __ds_scope.Stepper;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.AppShell = __ds_scope.AppShell;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.ConfirmDialog = __ds_scope.ConfirmDialog;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.CartRow = __ds_scope.CartRow;

__ds_ns.ProductCard = __ds_scope.ProductCard;

__ds_ns.Ticket = __ds_scope.Ticket;

})();
