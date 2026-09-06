import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(() => vite.close());
const { activitySchema, summarizeActivities } = await vite.ssrLoadModule("/lib/customer-activity.ts");
const subscriptionId = "00000000-0000-4000-8000-000000000003";
const valid = { customerId: "00000000-0000-4000-8000-000000000001", type: "UPSELL", occurredOn: "2026-09-05", amount: 120, notes: "Mais licenças", subscriptionId };
test("validates dates, money and optional notes (required only for cancellation)", () => {
  assert.equal(activitySchema.safeParse(valid).success, true);
  for (const patch of [{ occurredOn: "2026-02-30" }, { amount: -1 }, { amount: 0 }, { amount: 1.001 }, { type: "UNKNOWN" }, { type: "FOLLOW_UP", amount: 10 }]) assert.equal(activitySchema.safeParse({ ...valid, ...patch }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, notes: " " }).success, true);
  assert.equal(activitySchema.safeParse({ ...valid, type: "FOLLOW_UP", amount: 0, notes: "", subscriptionId: undefined }).success, true);
  assert.equal(activitySchema.safeParse({ ...valid, type: "CANCELLATION", amount: 0, notes: "", subscriptionId: undefined }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, type: "CANCELLATION", amount: 0, notes: " ", subscriptionId: undefined }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, type: "CANCELLATION", amount: 0, notes: "Cliente insatisfeito", subscriptionId: undefined }).success, true);
});
test("requires a subscriptionId for upsells/downsells and rejects it for other types", () => {
  assert.equal(activitySchema.safeParse({ ...valid, subscriptionId: undefined }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, type: "DOWNSELL", subscriptionId: undefined }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, type: "RENEWAL", amount: 1500, subscriptionId: undefined }).success, true);
  assert.equal(activitySchema.safeParse({ ...valid, type: "RENEWAL", amount: 1500 }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, type: "FOLLOW_UP", amount: 0, notes: "", subscriptionId: undefined }).success, true);
});
test("counts commercial events rather than distinct customers and separates revenue categories", () => {
  const result = summarizeActivities([{ ...valid, amount: 0.1 }, { ...valid, amount: 0.2 }, { ...valid, type: "RENEWAL", amount: 1500 }, { ...valid, type: "FOLLOW_UP", amount: 0 }]);
  assert.equal(result.upsells, 2);
  assert.equal(result.upsellValue, 0.3);
  assert.equal(result.renewals, 1);
  assert.equal(result.renewalValue, 1500);
});
test("persists records and reads all pages without losing older events", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const stored = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/customers")) return Response.json([{ id: valid.customerId }]);
    if (parsed.pathname.endsWith("/subscriptions")) return Response.json([{ id: subscriptionId }]);
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.entity_type, "customer_activity");
      const row = { ...body, id: "saved", created_at: "2026-09-05T12:00:00Z" };
      stored.push(row);
      return Response.json([row]);
    }
    const offset = Number(parsed.searchParams.get("offset"));
    return Response.json(stored.slice(offset, offset + 500));
  };
  try {
    const { POST, GET } = await vite.ssrLoadModule("/app/api/customer-activities/route.ts");
    const response = await POST(new Request("http://localhost/api/customer-activities", { method: "POST", body: JSON.stringify({ ...valid, items: [{ kind: "USERS", quantity: 3, amount: 120 }] }) }));
    assert.equal(response.status, 201);
    const saved = (await response.json()).event;
    assert.equal(saved.amount, 120);
    assert.deepEqual(saved.items, [{ kind: "USERS", quantity: 3, amount: 120 }]);
    for (let i = 0; i < 501; i++) stored.push({ ...stored[0], id: String(i) });
    const read = await GET();
    assert.equal((await read.json()).events.length, 502);
    const invalid = await POST(new Request("http://localhost/api/customer-activities", { method: "POST", body: "{" }));
    assert.equal(invalid.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test("lets operators edit and delete a stored activity", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const stored = [{ id: "e1", created_at: "2026-09-05T12:00:00Z", entity_type: "customer_activity", after_json: { customerId: valid.customerId, type: "RENEWAL", occurredOn: "2026-09-05", amount: 1500, notes: "" } }];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/customers")) return Response.json([{ id: valid.customerId }]);
    if (parsed.pathname.endsWith("/audit_events")) {
      if (options.method === "PATCH") { Object.assign(stored[0], JSON.parse(options.body)); return Response.json([stored[0]]); }
      if (options.method === "DELETE") { stored.length = 0; return new Response(null, { status: 204 }); }
      return Response.json(stored.map((row) => ({ id: row.id }))); // existence check (select=id)
    }
    return Response.json([]);
  };
  try {
    const { PATCH, DELETE } = await vite.ssrLoadModule("/app/api/customer-activities/route.ts");
    const patched = await PATCH(new Request("http://localhost/api/customer-activities", { method: "PATCH", body: JSON.stringify({ id: "e1", customerId: valid.customerId, type: "RENEWAL", occurredOn: "2026-09-05", amount: 1800, notes: "Ajustado" }) }));
    assert.equal(patched.status, 200);
    const edited = (await patched.json()).event;
    assert.equal(edited.amount, 1800);
    assert.equal(edited.notes, "Ajustado");
    assert.equal(edited.id, "e1");
    const noId = await PATCH(new Request("http://localhost/api/customer-activities", { method: "PATCH", body: JSON.stringify({ customerId: valid.customerId, type: "RENEWAL", occurredOn: "2026-09-05", amount: 1800, notes: "" }) }));
    assert.equal(noId.status, 400);
    const badPayload = await PATCH(new Request("http://localhost/api/customer-activities", { method: "PATCH", body: JSON.stringify({ id: "e1", customerId: valid.customerId, type: "RENEWAL", occurredOn: "2026-09-05", amount: 0, notes: "" }) }));
    assert.equal(badPayload.status, 400);
    const del = await DELETE(new Request("http://localhost/api/customer-activities?id=e1", { method: "DELETE" }));
    assert.equal(del.status, 200);
    assert.equal(stored.length, 0);
    const delNotFound = await DELETE(new Request("http://localhost/api/customer-activities?id=e1", { method: "DELETE" }));
    assert.equal(delNotFound.status, 404);
    const delNoId = await DELETE(new Request("http://localhost/api/customer-activities", { method: "DELETE" }));
    assert.equal(delNoId.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test("validates item quantities, options and exact totals for upsells and downsells", () => {
  const items = [{ kind: "INSTANCES", quantity: 10, amount: 70 }, { kind: "USERS", quantity: 30, amount: 50 }, { kind: "ATTENDANCES", quantity: 1000, amount: 100 }, { kind: "AUTOMATIONS", quantity: 40, amount: 20 }, { kind: "OPEN_API", quantity: null, amount: 30 }, { kind: "INTEGRATIONS", quantity: null, amount: 10 }];
  for (const type of ["UPSELL", "DOWNSELL"]) assert.equal(activitySchema.safeParse({ ...valid, type, items, amount: 280 }).success, true);
  for (const [kind, quantity] of [["INSTANCES", 11], ["USERS", 31], ["ATTENDANCES", 150], ["AUTOMATIONS", 7], ["OPEN_API", 1], ["INTEGRATIONS", 0]]) assert.equal(activitySchema.safeParse({ ...valid, items: [{ kind, quantity, amount: 120 }] }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, items, amount: 281 }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, items: [] }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, items: [items[0], items[0]], amount: 140 }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, type: "RENEWAL", items, amount: 280 }).success, false);
});

test("activeCustomizations nets upsells and downsells per item kind, dropping fully-undone ones", async () => {
  const { activeCustomizations } = await vite.ssrLoadModule("/lib/customer-activity.ts");
  const subId = "00000000-0000-4000-8000-000000000007";
  const firstUpsell = { ...valid, subscriptionId: subId, id: "u1", createdAt: "2026-09-01T00:00:00Z", type: "UPSELL", occurredOn: "2026-09-01", amount: 50, items: [{ kind: "USERS", quantity: 5, amount: 50 }] };
  const secondUpsell = { ...valid, subscriptionId: subId, id: "u2", createdAt: "2026-09-10T00:00:00Z", type: "UPSELL", occurredOn: "2026-09-10", amount: 100, items: [{ kind: "USERS", quantity: 10, amount: 100 }] };
  const toggleOn = { ...valid, subscriptionId: subId, id: "u3", createdAt: "2026-09-05T00:00:00Z", type: "UPSELL", occurredOn: "2026-09-05", amount: 30, items: [{ kind: "OPEN_API", quantity: null, amount: 30 }] };
  const toggleOff = { ...valid, subscriptionId: subId, id: "d1", createdAt: "2026-09-12T00:00:00Z", type: "DOWNSELL", occurredOn: "2026-09-12", amount: 30, items: [{ kind: "OPEN_API", quantity: null, amount: 30 }] };

  // Before any event: no customizations.
  assert.deepEqual(activeCustomizations(subId, valid.customerId, [firstUpsell], "2026-08-31"), []);

  // Two upsells on the same kind accumulate rather than replace.
  const afterBoth = activeCustomizations(subId, valid.customerId, [firstUpsell, secondUpsell], "2026-09-10");
  assert.deepEqual(afterBoth, [{ kind: "USERS", quantity: 15, amount: 150 }]);

  // A toggle item (null quantity) later fully removed by a downsell nets to zero and disappears.
  const withToggle = activeCustomizations(subId, valid.customerId, [firstUpsell, toggleOn], "2026-09-05");
  assert.deepEqual(withToggle.sort((a, b) => a.kind.localeCompare(b.kind)), [{ kind: "OPEN_API", quantity: null, amount: 30 }, { kind: "USERS", quantity: 5, amount: 50 }]);
  const afterToggleOff = activeCustomizations(subId, valid.customerId, [firstUpsell, toggleOn, toggleOff], "2026-09-12");
  assert.deepEqual(afterToggleOff, [{ kind: "USERS", quantity: 5, amount: 50 }]);

  // A fully offsetting upsell/downsell pair on the same kind nets to nothing.
  const netZero = { ...valid, subscriptionId: subId, id: "d2", createdAt: "2026-09-15T00:00:00Z", type: "DOWNSELL", occurredOn: "2026-09-15", amount: 150, items: [{ kind: "USERS", quantity: 15, amount: 150 }] };
  assert.deepEqual(activeCustomizations(subId, valid.customerId, [firstUpsell, secondUpsell, netZero], "2026-09-15"), []);

  // Different subscription or customer is ignored.
  assert.deepEqual(activeCustomizations("00000000-0000-4000-8000-000000000099", valid.customerId, [firstUpsell], "2026-09-10"), []);
});

test("counts combined plan and cycle changes once financially and applies them on the effective date", async () => {
  const { effectiveSubscriptions, planMrrDelta } = await vite.ssrLoadModule("/lib/customer-activity.ts");
  const planSubscriptionId = "00000000-0000-4000-8000-000000000002";
  const event = { ...valid, subscriptionId: undefined, id: "event", createdAt: "2026-09-05T12:00:00Z", type: "UPGRADE", occurredOn: "2026-10-01", amount: 3600, planChange: { subscriptionId: planSubscriptionId, before: { name: "Inicial", period: "MONTHLY", value: 200 }, after: { name: "Pro", period: "ANNUAL", value: 3600 } } };
  assert.equal(activitySchema.safeParse(event).success, true);
  assert.equal(planMrrDelta(event.planChange), 100);
  const summary = summarizeActivities([event]);
  assert.equal(summary.upgrades, 1);
  assert.equal(summary.periodChanges, 1);
  assert.equal(summary.monthlyToAnnual, 1);
  assert.equal(summary.planMrrDelta, 100);
  assert.equal(summary.totalMrrDelta, 100);
  const base = [{ id: planSubscriptionId, customer_id: valid.customerId, billing_period: "MONTHLY", plan_name_raw: "Inicial", value: 200 }];
  assert.equal(effectiveSubscriptions(base, [event], "2026-09-30")[0].value, 200);
  assert.equal(effectiveSubscriptions(base, [event], "2026-10-01")[0].value, 3600);
  assert.equal(base[0].value, 200);
  const downgrade = { ...event, type: "DOWNGRADE", amount: 200, planChange: { subscriptionId: planSubscriptionId, before: event.planChange.after, after: event.planChange.before } };
  assert.equal(summarizeActivities([downgrade]).planMrrDelta, -100);
  assert.equal(summarizeActivities([downgrade]).annualToMonthly, 1);
  assert.equal(activitySchema.safeParse({ ...event, type: "PERIOD_CHANGE" }).success, false);
  assert.equal(activitySchema.safeParse({ ...event, planChange: undefined }).success, false);
  const cycleOnly = { ...event, type: "PERIOD_CHANGE", planChange: { ...event.planChange, after: { ...event.planChange.after, name: "Inicial" } } };
  assert.equal(activitySchema.safeParse(cycleOnly).success, true);
});

test("upsells and downsells add/subtract their monthly amount from the affected subscription's MRR", async () => {
  const { effectiveSubscriptions, itemizedMrrDelta } = await vite.ssrLoadModule("/lib/customer-activity.ts");
  const monthlySubId = "00000000-0000-4000-8000-000000000004";
  const annualSubId = "00000000-0000-4000-8000-000000000005";
  const upsell = { ...valid, subscriptionId: monthlySubId, id: "u1", createdAt: "2026-09-05T12:00:00Z", type: "UPSELL", occurredOn: "2026-09-10", amount: 50, items: [{ kind: "USERS", quantity: 5, amount: 50 }] };
  const downsell = { ...valid, subscriptionId: monthlySubId, id: "d1", createdAt: "2026-09-15T12:00:00Z", type: "DOWNSELL", occurredOn: "2026-09-20", amount: 20, items: [{ kind: "USERS", quantity: 2, amount: 20 }] };
  assert.equal(itemizedMrrDelta(upsell), 50);
  assert.equal(itemizedMrrDelta(downsell), -20);

  // MONTHLY: amount adds directly to value.
  const monthlyBase = [{ id: monthlySubId, customer_id: valid.customerId, billing_period: "MONTHLY", plan_name_raw: "Plano IA", value: 197 }];
  assert.equal(effectiveSubscriptions(monthlyBase, [upsell], "2026-09-09")[0].value, 197);
  assert.equal(effectiveSubscriptions(monthlyBase, [upsell], "2026-09-10")[0].value, 247);
  assert.equal(effectiveSubscriptions(monthlyBase, [upsell, downsell], "2026-09-20")[0].value, 227);

  // ANNUAL: amount is a monthly-equivalent delta, so it's scaled by 12 before being added to the yearly face value.
  const annualUpsell = { ...upsell, id: "u2", subscriptionId: annualSubId, amount: 100, items: [{ kind: "USERS", quantity: 10, amount: 100 }] };
  const annualBase = [{ id: annualSubId, customer_id: valid.customerId, billing_period: "ANNUAL", plan_name_raw: "Plano IA Anual", value: 2364 }];
  assert.equal(effectiveSubscriptions(annualBase, [annualUpsell], "2026-09-10")[0].value, 3564);

  // Combined with a plan upgrade on the same subscription: the upsell adds on top of the new plan value.
  const upgrade = { ...valid, subscriptionId: undefined, id: "up1", createdAt: "2026-09-01T00:00:00Z", type: "UPGRADE", occurredOn: "2026-09-05", amount: 297, planChange: { subscriptionId: monthlySubId, before: { name: "Inicial", period: "MONTHLY", value: 197 }, after: { name: "Pro", period: "MONTHLY", value: 297 } } };
  assert.equal(effectiveSubscriptions(monthlyBase, [upgrade, upsell], "2026-09-10")[0].value, 347);

  // An untouched subscription (different id) is returned as-is.
  const other = [{ id: "00000000-0000-4000-8000-000000000006", customer_id: valid.customerId, billing_period: "MONTHLY", plan_name_raw: "Outro", value: 100 }];
  assert.equal(effectiveSubscriptions(other, [upsell], "2026-09-10")[0], other[0]);
});
