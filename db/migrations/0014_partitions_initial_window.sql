-- Partisi bulanan awal untuk 4 tabel yang dipartisi (ERD §1.10/§15):
-- order_line, payment, stock_movement, audit_event. Dibuat dari 1 bulan
-- sebelum bulan berjalan sampai 12 bulan ke depan (14 bulan), plus partisi
-- DEFAULT per tabel sebagai jaring pengaman. Otomasi pembuatan partisi ke
-- depan (mis. pg_cron) di luar scope F0 — TODO(F1/F2).
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  tbl          text;
  i            int;
  part_start   timestamptz;
  part_end     timestamptz;
  part_name    text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['order_line', 'payment', 'stock_movement', 'audit_event'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I DEFAULT', tbl || '_default', tbl);

    FOR i IN -1..12 LOOP
      part_start := date_trunc('month', now()) + (i || ' months')::interval;
      part_end   := part_start + interval '1 month';
      part_name  := tbl || '_' || to_char(part_start, 'YYYY_MM');
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        part_name, tbl, part_start, part_end
      );
    END LOOP;
  END LOOP;
END
$$;
