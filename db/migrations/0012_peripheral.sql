-- module: peripheral (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- "Data, bukan kode" (ERD §10) — katalog hardware global, dipakai lintas
-- tenant, bukan milik satu tenant tertentu. exempt from RLS.
CREATE TABLE printer_profile (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  paper_width_mm  int,
  chars_per_line  int,
  codepage        text,
  has_cutter      boolean NOT NULL DEFAULT false,
  init_command    text,
  cut_command     text,
  drawer_command  text,
  image_support   boolean NOT NULL DEFAULT false
);
-- exempt from RLS: data referensi hardware global, lihat komentar di atas.

CREATE TABLE peripheral (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  device_id            text REFERENCES device(id),
  outlet_id            text NOT NULL REFERENCES outlet(id),
  type                 text NOT NULL CHECK (type IN ('printer','drawer','scanner','display')),
  connection           text NOT NULL CHECK (connection IN ('usb','bluetooth','network')),
  address              text,
  printer_profile_id   text REFERENCES printer_profile(id),
  last_test_at         timestamptz
);
SELECT apply_tenant_rls('peripheral');

CREATE TABLE print_job (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  order_id      text REFERENCES "order"(id),
  peripheral_id text NOT NULL REFERENCES peripheral(id),
  document      jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  attempts      int NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('print_job');
