-- module: catalog (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

CREATE TABLE category (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  name         text NOT NULL,
  parent_id    text REFERENCES category(id),
  sort_order   int NOT NULL DEFAULT 0,
  color_hint   text,
  archived_at  timestamptz
  -- Constraint "kategori dengan parent_id tidak boleh jadi parent" (maks 1
  -- tingkat) ditegakkan aplikasi + test per ERD §4, bukan DB CHECK — tidak
  -- bisa dinyatakan deklaratif tanpa trigger, dan itu di luar scope RLS/F0.
);
SELECT apply_tenant_rls('category');

CREATE TABLE item (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  name         text NOT NULL,
  category_id  text REFERENCES category(id),
  description  text,
  image_url    text,
  sort_order   int NOT NULL DEFAULT 0,
  archived_at  timestamptz
  -- Sengaja tanpa price/sku (ERD §4).
);
SELECT apply_tenant_rls('item');

CREATE TABLE item_variation (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  item_id            text NOT NULL REFERENCES item(id),
  name               text NOT NULL DEFAULT 'Regular',
  sku                text,
  barcode            text,
  price              bigint NOT NULL,
  cost               bigint NOT NULL DEFAULT 0,
  stocking_unit      text NOT NULL DEFAULT 'pcs',
  selling_unit       text NOT NULL DEFAULT 'pcs',
  conversion_factor  numeric NOT NULL DEFAULT 1,
  track_stock        boolean NOT NULL DEFAULT true,
  sort_order         int NOT NULL DEFAULT 0 CHECK (sort_order <= 250),
  archived_at        timestamptz
);
SELECT apply_tenant_rls('item_variation');
CREATE UNIQUE INDEX ux_variation_barcode ON item_variation(tenant_id, barcode) WHERE barcode IS NOT NULL;

CREATE TABLE modifier_list (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  name             text NOT NULL,
  selection_type   text NOT NULL CHECK (selection_type IN ('single','multi')),
  min_selections   int NOT NULL DEFAULT 0,
  max_selections   int,
  allow_duplicate  boolean NOT NULL DEFAULT false,
  is_required      boolean NOT NULL DEFAULT false,
  archived_at      timestamptz
);
SELECT apply_tenant_rls('modifier_list');

CREATE TABLE modifier (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  modifier_list_id   text NOT NULL REFERENCES modifier_list(id),
  name               text NOT NULL,
  price              bigint NOT NULL DEFAULT 0,
  is_default         boolean NOT NULL DEFAULT false,
  sort_order         int NOT NULL DEFAULT 0,
  archived_at        timestamptz
  -- Sengaja tanpa sku/track_stock (ERD §4).
);
SELECT apply_tenant_rls('modifier');

-- Bridge N:M, tanpa kolom id tersendiri (ERD §4 tidak menyebutkannya, dan
-- db/local/001-initial.sql sudah memakai composite PK) — konsisten dipertahankan.
CREATE TABLE item_modifier_list (
  tenant_id          text NOT NULL REFERENCES tenant(id),
  item_id            text NOT NULL REFERENCES item(id),
  modifier_list_id   text NOT NULL REFERENCES modifier_list(id),
  sort_order         int NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, modifier_list_id)
);
SELECT apply_tenant_rls('item_modifier_list');

CREATE TABLE price_history (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  variation_id     text NOT NULL REFERENCES item_variation(id),
  outlet_id        text REFERENCES outlet(id),
  price            bigint NOT NULL,
  effective_from   timestamptz NOT NULL,
  changed_by       text NOT NULL,
  reason           text
);
SELECT apply_tenant_rls('price_history');
