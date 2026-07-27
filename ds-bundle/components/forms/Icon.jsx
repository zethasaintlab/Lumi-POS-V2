import React from 'react';

/* Ikon Lumi = stroke SVG inline, gaya Lucide: viewBox 24, stroke-width 2,
   round cap/join, tanpa fill. Ukuran mewarisi `currentColor` sehingga ikon
   di dalam badge/tombol otomatis mengikuti warna teksnya.
   Hanya glyph yang benar-benar dipakai POS yang disertakan. */
const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  alert: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  'wifi-off': <><path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M20.6 11.9A15 15 0 0 0 15 7.8M1 1l22 22" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  receipt: <path d="M4 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1Zm4 5h8M8 12h8" />,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  // --- nav & modul (produk penuh) ---
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
  register: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  chef: <><path d="M6 13.87A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.87V21H6Z" /><path d="M6 17h12" /></>,
  layers: <path d="m12 2 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5" />,
  package: <><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" /><path d="M3 7l9 5 9-5M12 12v10" /></>,
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>,
  tag: <><path d="M20 12 12 20l-9-9V3h8Z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
  truck: <><path d="M1 5h13v12H1zM14 8h4l3 3v6h-7" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" /></>,
  clipboard: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></>,
  file: <><path d="M6 2h8l4 4v16H6Z" /><path d="M14 2v4h4M9 13h6M9 17h6" /></>,
  gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v9h14v-9M12 8S10 3 7.5 4.5 9.5 8 12 8Zm0 0s2-5 4.5-3.5S14.5 8 12 8Z" /></>,
  book: <path d="M4 4a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2ZM4 20a2 2 0 0 1 2-2h13" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 21a6.5 6.5 0 0 1 13 0M17 5a3.5 3.5 0 0 1 0 6.5M21.5 21a6.5 6.5 0 0 0-4-6" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M15 10v10" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></>,
  shield: <path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5Z" />,
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H2a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 3.6 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V2a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17.4 3.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  message: <path d="M4 4h16v12H8l-4 4Z" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
  bell: <><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  swap: <path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />,
  printer: <><path d="M6 9V3h12v6M6 18H4v-6h16v6h-2" /><rect x="8" y="15" width="8" height="6" rx="1" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4Z" />,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  edit: <path d="M4 20h4L18 10l-4-4L4 16Zm10-14 4 4" />,
  coffee: <><path d="M4 8h14v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" /><path d="M18 9h2a2 2 0 0 1 0 4h-2M7 4V2M11 4V2M15 4V2" /></>,
  star: <path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 21l1.1-6.5L2.6 9.8l6.5-.9Z" />,
  phone: <path d="M4 4h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2Z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  'map-pin': <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M20 14v7M14 20h3M20 20h1" /></>,
};

export function Icon({ name, size = 20, strokeWidth = 2, className, style, ...rest }) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true" {...rest}
    >
      {glyph}
    </svg>
  );
}

export const iconNames = Object.keys(PATHS);
