-- module: payment (part 1/2 — tax_rate; payment table itself is 0008,
-- deferred until after "order" exists) (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

CREATE TABLE tax_rate (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  outlet_id        text REFERENCES outlet(id),
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN ('pbjt','ppn','service_charge','none')),
  rate             numeric(6,4) NOT NULL,
  is_inclusive     boolean NOT NULL DEFAULT false,
  phase            text NOT NULL DEFAULT 'subtotal' CHECK (phase IN ('subtotal','total')),
  jurisdiction     text,
  channel          text NOT NULL DEFAULT 'all' CHECK (channel IN ('all','dine_in','takeaway')),
  applies_to       text NOT NULL DEFAULT 'all_items' CHECK (applies_to IN ('all_items','category','item')),
  applies_to_ids   text[] NOT NULL DEFAULT '{}',
  effective_from   timestamptz NOT NULL,
  effective_to     timestamptz
);
SELECT apply_tenant_rls('tax_rate');
