'use strict';

const crypto = require('node:crypto');

function freshId() {
  return crypto.randomUUID();
}

async function insertReturning(client, table, values) {
  const cols = Object.keys(values);
  const params = cols.map((c) => values[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
  const { rows } = await client.query(sql, params);
  return rows[0];
}

// Seeds one global printer_profile row (RLS-exempt, shared across tenants).
// Call once per test run, as any role with INSERT on the table.
async function seedGlobalPrinterProfile(client) {
  return insertReturning(client, 'printer_profile', {
    id: freshId(),
    name: 'Epson TM-T82',
    paper_width_mm: 58,
    chars_per_line: 32,
    codepage: 'CP437',
    has_cutter: true,
    init_command: '1b40',
    cut_command: '1d5601',
    drawer_command: '1b7000',
    image_support: true,
  });
}

// Identity/catalog fixtures for one tenant — created once, reused by every
// transaction cycle (seedTransactionCycle) for that tenant. `appClient` must
// be RLS-bound (lumi_app); this also proves the happy path (a tenant can
// write its own data under correct RLS) as a side effect of seeding.
async function seedTenantBase(appClient, { suffix }) {
  const rows = {};

  // tenant: RLS-exempt, insertable without app.tenant_id set.
  rows.tenant = await insertReturning(appClient, 'tenant', {
    id: freshId(),
    name: `Tenant ${suffix}`,
    plan: 'standard',
    status: 'active',
    deployment_mode: 'cloud',
    max_outlets: 5,
    max_devices: 5,
    max_users: 10,
    max_products: 100,
    features: {},
  });
  const tenantId = rows.tenant.id;

  await appClient.query('BEGIN');
  await appClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

  rows.vertical_profile = await insertReturning(appClient, 'vertical_profile', {
    id: freshId(),
    tenant_id: tenantId,
    name: 'fnb',
    modules_enabled: [],
    default_channel: 'takeaway',
    allow_negative_stock: true,
    requires_barcode_flow: false,
    default_tax_type: 'pbjt',
  });

  rows.outlet = await insertReturning(appClient, 'outlet', {
    id: freshId(),
    tenant_id: tenantId,
    name: `Outlet ${suffix}`,
    address: 'Jl. Contoh No. 1',
    timezone: 'Asia/Jakarta',
    business_day_ends_at: '04:00',
    rounding_increment: 100,
    rounding_mode: 'half_up',
    service_charge_rate: 0,
    vertical_profile_id: rows.vertical_profile.id,
    archived_at: null,
  });

  rows.role = await insertReturning(appClient, 'role', {
    id: freshId(),
    tenant_id: tenantId,
    code: 'cashier',
    name: 'Cashier',
  });

  rows.user = await insertReturning(appClient, 'user', {
    id: freshId(),
    tenant_id: tenantId,
    name: `Cashier ${suffix}`,
    email: null,
    password_hash: null,
    pin_hash: 'hash',
    pin_failed_attempts: 0,
    pin_locked_until: null,
    pin_rotated_at: null,
    mfa_secret: null,
    is_active: true,
    deactivated_at: null,
  });

  rows.user2 = await insertReturning(appClient, 'user', {
    id: freshId(),
    tenant_id: tenantId,
    name: `Manager ${suffix}`,
    email: `manager-${suffix}@example.com`,
    password_hash: 'hash',
    pin_hash: null,
    pin_failed_attempts: 0,
    pin_locked_until: null,
    pin_rotated_at: null,
    mfa_secret: null,
    is_active: true,
    deactivated_at: null,
  });

  // ⛔ Pengguna fixture diberi DUA peran: kasir DAN owner.
  //
  // Itu bukan kelonggaran, melainkan bentuk yang paling umum di segmen ini —
  // pemilik kafe kecil berdiri di kasir sendiri. Yang menentukan di sini:
  // sejak penjaga peran dipasang (), fixture
  // yang hanya berperan kasir membuat SETIAP test katalog, pajak, dan
  // perangkat gagal 403 — bukan karena kodenya salah, melainkan karena
  // fixture-nya tidak pernah dimaksudkan untuk mewakili aktor administratif.
  //
  // Penolakan RBAC punya suite-nya sendiri ()
  // dengan pengguna berperan kasir MURNI. Kalau penolakan itu diuji dengan
  // fixture ini, ia akan hijau karena alasan yang salah.
  rows.user_role_owner = await insertReturning(appClient, 'user_role', {
    id: freshId(),
    tenant_id: tenantId,
    user_id: rows.user.id,
    role: 'owner',
    scope_type: 'tenant',
    scope_id: tenantId,
  });
  rows.user_role = await insertReturning(appClient, 'user_role', {
    id: freshId(),
    tenant_id: tenantId,
    user_id: rows.user.id,
    role: 'cashier',
    scope_type: 'outlet',
    scope_id: rows.outlet.id,
  });

  rows.user_outlet = await insertReturning(appClient, 'user_outlet', {
    id: freshId(),
    tenant_id: tenantId,
    user_id: rows.user.id,
    outlet_id: rows.outlet.id,
  });

  rows.user_session = await insertReturning(appClient, 'user_session', {
    id: freshId(),
    tenant_id: tenantId,
    user_id: rows.user.id,
    token_hash: freshId().replace(/-/g, '').padEnd(64, '0'),
    expires_at: new Date(Date.now() + 43_200_000).toISOString(),
  });

  rows.category = await insertReturning(appClient, 'category', {
    id: freshId(),
    tenant_id: tenantId,
    name: 'Minuman',
    parent_id: null,
    sort_order: 0,
    color_hint: null,
    archived_at: null,
  });

  rows.item = await insertReturning(appClient, 'item', {
    id: freshId(),
    tenant_id: tenantId,
    name: 'Kopi Susu',
    category_id: rows.category.id,
    description: null,
    image_url: null,
    sort_order: 0,
    archived_at: null,
  });

  // Spare item, deliberately not linked into item_modifier_list during
  // seeding — reserved as a collision-free target for the cross-tenant
  // INSERT-impersonation test on that bridge table (see helpers/tables.js).
  rows.item2 = await insertReturning(appClient, 'item', {
    id: freshId(),
    tenant_id: tenantId,
    name: 'Kopi Hitam',
    category_id: rows.category.id,
    description: null,
    image_url: null,
    sort_order: 1,
    archived_at: null,
  });

  rows.item_variation = await insertReturning(appClient, 'item_variation', {
    id: freshId(),
    tenant_id: tenantId,
    item_id: rows.item.id,
    name: 'Regular',
    sku: null,
    barcode: null,
    price: 20000,
    cost: 8000,
    stocking_unit: 'pcs',
    selling_unit: 'pcs',
    conversion_factor: 1,
    track_stock: true,
    sort_order: 0,
    archived_at: null,
  });

  rows.modifier_list = await insertReturning(appClient, 'modifier_list', {
    id: freshId(),
    tenant_id: tenantId,
    name: 'Level Gula',
    selection_type: 'single',
    min_selections: 0,
    max_selections: 1,
    allow_duplicate: false,
    is_required: false,
    archived_at: null,
  });

  rows.modifier = await insertReturning(appClient, 'modifier', {
    id: freshId(),
    tenant_id: tenantId,
    modifier_list_id: rows.modifier_list.id,
    name: 'Normal',
    price: 0,
    is_default: true,
    sort_order: 0,
    archived_at: null,
  });

  rows.item_modifier_list = await insertReturning(appClient, 'item_modifier_list', {
    id: freshId(),
    tenant_id: tenantId,
    item_id: rows.item.id,
    modifier_list_id: rows.modifier_list.id,
    sort_order: 0,
  });

  rows.price_history = await insertReturning(appClient, 'price_history', {
    id: freshId(),
    tenant_id: tenantId,
    variation_id: rows.item_variation.id,
    outlet_id: rows.outlet.id,
    price: 20000,
    effective_from: new Date(),
    changed_by: rows.user.id,
    reason: 'initial',
  });

  rows.tax_rate = await insertReturning(appClient, 'tax_rate', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: rows.outlet.id,
    name: 'PB1 10%',
    type: 'pbjt',
    rate: 0.1,
    is_inclusive: true,
    phase: 'subtotal',
    jurisdiction: null,
    channel: 'all',
    applies_to: 'all_items',
    applies_to_ids: [],
    effective_from: new Date(),
    effective_to: null,
  });

  // ⛔ Sesi back-office untuk `rows.user`, dicetak di sini supaya setiap suite
  // yang memakai fixture ini punya kredensial yang SAH sejak awal.
  //
  // Sejak `pasangPenjagaSesi` ada (`apps/server/src/sesi.ts`), seluruh
  // permukaan back-office menuntut `Authorization: Bearer`. Tanpa baris ini,
  // setiap suite harus mencetak sesinya sendiri — dan yang lupa akan
  // menjatuhkan puluhan test dengan 401 yang tidak menyebut sebabnya.
  //
  // Token mentahnya dikembalikan sebagai `rows.sessionToken`; yang tersimpan
  // hanya SHA-256-nya, persis seperti `POST /auth/login` melakukannya.
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  await insertReturning(appClient, 'user_session', {
    id: freshId(),
    tenant_id: tenantId,
    user_id: rows.user.id,
    token_hash: crypto.createHash('sha256').update(sessionToken).digest('hex'),
    expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000),
  });
  rows.sessionToken = sessionToken;
  rows.authHeader = `Bearer ${sessionToken}`;

  rows.subscription_invoice = await insertReturning(appClient, 'subscription_invoice', {
    id: freshId(),
    tenant_id: tenantId,
    plan: 'standard',
    outlet_count: 2,
    unit_price: 349000,
    // `amount` WAJIB = unit_price * outlet_count (CHECK di migrasi 0026).
    amount: 698000,
    status: 'pending_confirmation',
    provider: null,
    provider_reference: null,
    confirmed_at: null,
    requested_by: rows.user.id,
  });

  await appClient.query('COMMIT');
  return rows;
}

// One full order lifecycle (device -> shift -> order -> ... -> outbox) for an
// already-seeded tenant (`base`, from seedTenantBase), shifted `monthOffset`
// months so the 4 partitioned tables land in a specific monthly partition —
// used to prove RLS holds across partition boundaries, not just within one.
// Safe to call more than once per tenant: every unique-constrained column
// (device code, stock_snapshot PK) is derived from `cycleLabel` or upserted.
async function seedTransactionCycle(appClient, base, { cycleLabel, printerProfileId, monthOffset = 0 }) {
  const rows = {};
  const tenantId = base.tenant.id;
  const now = new Date();
  const occurredAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 15, 10, 0, 0));
  const businessDate = occurredAt.toISOString().slice(0, 10);

  await appClient.query('BEGIN');
  await appClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

  rows.device = await insertReturning(appClient, 'device', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    code: `K-${cycleLabel}`,
    name: `Kasir ${cycleLabel}`,
    platform: 'tauri',
    app_version: '0.0.0',
    schema_version: '1',
    token_hash: 'token',
    credentials_expire_at: null,
    last_seen_at: null,
    revoked_at: null,
  });

  // Telemetri perangkat (F6, migrasi 0029). Kebocoran di sini menunjukkan
  // kesehatan operasional satu merchant kepada merchant lain -- seberapa
  // sering kasirnya crash, seberapa lama outletnya offline.
  rows.device_telemetry = await insertReturning(appClient, 'device_telemetry', {
    id: freshId(),
    tenant_id: tenantId,
    device_id: rows.device.id,
    app_version: '0.0.0',
    event: 'antrean_gagal',
    type: null,
    window_start: new Date(occurredAt.getTime() - 3600_000).toISOString(),
    window_end: occurredAt.toISOString(),
    sample_count: 3,
    total_value: 6,
    min_value: 1,
    max_value: 3,
    p95_value: 3,
  });

  rows.cash_drawer_shift = await insertReturning(appClient, 'cash_drawer_shift', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    device_id: rows.device.id,
    business_date: businessDate,
    status: 'open',
    opening_float: 100000,
    opened_by: base.user.id,
    opened_at: occurredAt,
    counted_amount: null,
    expected_amount: null,
    difference: null,
    count_attempts: [],
    variance_reason_code: null,
    variance_note: null,
    closed_by: null,
    approved_by: null,
    closed_at: null,
  });

  rows.order = await insertReturning(appClient, 'order', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    device_id: rows.device.id,
    shift_id: rows.cash_drawer_shift.id,
    receipt_number: `K-${cycleLabel}-${businessDate.replace(/-/g, '')}-1`,
    business_date: businessDate,
    sequence: 1,
    status: 'paid',
    channel: 'takeaway',
    owned_by_device_id: null,
    subtotal: 20000,
    order_discount: 0,
    service_charge_amount: 0,
    tax_amount: 2000,
    rounding_adjustment: 0,
    total: 22000,
    amount_due: 0,
    has_calculation_variance: false,
    variance_amount: null,
    voided_by_order_id: null,
    created_by: base.user.id,
    occurred_at: occurredAt,
    recorded_at: now,
    hlc: 1,
  });

  rows.check = await insertReturning(appClient, 'check', {
    id: freshId(),
    tenant_id: tenantId,
    order_id: rows.order.id,
    label: null,
    subtotal: 20000,
    total: 22000,
  });

  rows.order_line = await insertReturning(appClient, 'order_line', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    device_id: rows.device.id,
    order_id: rows.order.id,
    check_id: rows.check.id,
    variation_id: base.item_variation.id,
    item_name: 'Kopi Susu',
    variation_name: 'Regular',
    unit_price: 20000,
    quantity: 1000,
    modifier_snapshot: [],
    discount_amount: 0,
    tax_rate_id: base.tax_rate.id,
    tax_rate: 0.1,
    tax_amount: 2000,
    is_tax_inclusive: true,
    cost_at_sale: 8000,
    line_total: 22000,
    created_by: base.user.id,
    occurred_at: occurredAt,
    recorded_at: now,
    hlc: 1,
  });

  rows.order_line_modifier = await insertReturning(appClient, 'order_line_modifier', {
    id: freshId(),
    tenant_id: tenantId,
    order_line_id: rows.order_line.id,
    modifier_id: base.modifier.id,
    name: 'Normal',
    price: 0,
    quantity: 1000,
  });

  rows.refund = await insertReturning(appClient, 'refund', {
    id: freshId(),
    tenant_id: tenantId,
    order_id: rows.order.id,
    amount: 0,
    reason_code: 'test',
    reason_note: null,
    created_by: base.user.id,
    approved_by: base.user2.id,
    occurred_at: occurredAt,
    recorded_at: now,
    hlc: 1,
  });

  rows.payment = await insertReturning(appClient, 'payment', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    device_id: rows.device.id,
    order_id: rows.order.id,
    check_id: rows.check.id,
    method: 'cash',
    amount: 22000,
    tendered_amount: 25000,
    change_amount: 3000,
    status: 'confirmed',
    provider: null,
    provider_reference: null,
    terminal_reference: null,
    approval_code: null,
    card_last4: null,
    card_brand: null,
    acquirer: null,
    confirmed_manually: false,
    mdr_estimated: null,
    tendered_at: occurredAt,
    created_by: base.user.id,
    occurred_at: occurredAt,
    recorded_at: now,
    hlc: 1,
  });

  rows.cash_movement = await insertReturning(appClient, 'cash_movement', {
    id: freshId(),
    tenant_id: tenantId,
    shift_id: rows.cash_drawer_shift.id,
    type: 'sale',
    delta: 22000,
    order_id: rows.order.id,
    counterpart_type: 'sales_revenue',
    reason_code: null,
    note: null,
    created_by: base.user.id,
    occurred_at: occurredAt,
    recorded_at: now,
    hlc: 1,
  });

  rows.stocktake = await insertReturning(appClient, 'stocktake', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    status: 'draft',
    snapshot_at: null,
    started_by: base.user.id,
    approved_by: null,
  });

  rows.stocktake_line = await insertReturning(appClient, 'stocktake_line', {
    id: freshId(),
    tenant_id: tenantId,
    stocktake_id: rows.stocktake.id,
    variation_id: base.item_variation.id,
    expected_qty: 10000,
    counted_qty: null,
    reason_code: null,
  });

  rows.stock_movement = await insertReturning(appClient, 'stock_movement', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    device_id: rows.device.id,
    variation_id: base.item_variation.id,
    type: 'sale',
    delta: -1000,
    order_id: rows.order.id,
    stocktake_id: null,
    reason_code: null,
    note: null,
    unit_cost: null,
    created_by: base.user.id,
    occurred_at: occurredAt,
    recorded_at: now,
    hlc: 1,
  });

  rows.sold_out_flag = await insertReturning(appClient, 'sold_out_flag', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    variation_id: base.item_variation.id,
    is_sold_out: false,
    set_by: base.user.id,
    set_at: now,
    hlc: 1,
  });

  // PK is (tenant_id, outlet_id, variation_id) — the same triple recurs across
  // cycles for one tenant, so upsert instead of plain insert.
  {
    const { rows: snapRows } = await appClient.query(
      `INSERT INTO "stock_snapshot" (tenant_id, outlet_id, variation_id, balance, checkpoint_hlc)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, outlet_id, variation_id) DO UPDATE SET balance = EXCLUDED.balance, checkpoint_hlc = EXCLUDED.checkpoint_hlc
       RETURNING *`,
      [tenantId, base.outlet.id, base.item_variation.id, 10000, 1]
    );
    rows.stock_snapshot = snapRows[0];
  }

  rows.audit_event = await insertReturning(appClient, 'audit_event', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    device_id: rows.device.id,
    actor_user_id: base.user.id,
    approver_user_id: base.user2.id,
    event_type: 'order.paid',
    entity_type: 'order',
    entity_id: rows.order.id,
    before: null,
    after: null,
    reason_code: null,
    reason_note: null,
    occurred_at: occurredAt,
    recorded_at: now,
    hlc: 1,
  });

  rows.peripheral = await insertReturning(appClient, 'peripheral', {
    id: freshId(),
    tenant_id: tenantId,
    device_id: rows.device.id,
    outlet_id: base.outlet.id,
    type: 'printer',
    connection: 'usb',
    address: '/dev/usb0',
    printer_profile_id: printerProfileId,
    last_test_at: null,
  });

  rows.print_job = await insertReturning(appClient, 'print_job', {
    id: freshId(),
    tenant_id: tenantId,
    order_id: rows.order.id,
    peripheral_id: rows.peripheral.id,
    document: {},
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: now,
  });

  rows.idempotency_key = await insertReturning(appClient, 'idempotency_key', {
    key: freshId(),
    tenant_id: tenantId,
    request_hash: 'hash',
    response_status: 200,
    response_body: {},
    created_at: now,
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  });

  rows.outbox = await insertReturning(appClient, 'outbox', {
    id: freshId(),
    tenant_id: tenantId,
    aggregate_type: 'order',
    aggregate_id: rows.order.id,
    event_type: 'order.paid',
    payload: {},
    published_at: null,
  });

  rows.oversell_event = await insertReturning(appClient, 'oversell_event', {
    id: freshId(),
    tenant_id: tenantId,
    outlet_id: base.outlet.id,
    variation_id: base.item_variation.id,
    detected_at: now,
    devices_involved: [],
    orders_involved: [],
    quantity_over: 1000,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
  });

  await appClient.query('COMMIT');
  return rows;
}

// A tenant with no data of its own — just enough to be a valid "attacker"
// context in the cross-tenant test (set app.tenant_id to a real tenant, no
// fixtures needed since the point is accessing *someone else's* rows).
async function seedBareTenant(client, { suffix }) {
  return insertReturning(client, 'tenant', {
    id: freshId(),
    name: `Tenant ${suffix}`,
    plan: 'standard',
    status: 'active',
    deployment_mode: 'cloud',
    max_outlets: 5,
    max_devices: 5,
    max_users: 10,
    max_products: 100,
    features: {},
  });
}

module.exports = { seedTenantBase, seedTransactionCycle, seedBareTenant, seedGlobalPrinterProfile, freshId };
