import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(() => vite.close());
const { activitySchema, summarizeActivities } = await vite.ssrLoadModule("/lib/customer-activity.ts");
const valid = { customerId: "00000000-0000-4000-8000-000000000001", type: "UPSELL", occurredOn: "2026-09-05", amount: 120, notes: "Mais licenças" };
test("validates dates, money and required notes", () => {
  assert.equal(activitySchema.safeParse(valid).success, true);
  for (const patch of [{ occurredOn: "2026-02-30" }, { amount: -1 }, { amount: 0 }, { amount: 1.001 }, { notes: " " }, { type: "UNKNOWN" }, { type: "FOLLOW_UP", amount: 10 }]) assert.equal(activitySchema.safeParse({ ...valid, ...patch }).success, false);
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

test("validates item quantities, options and exact totals for upsells and downsells", () => {
  const items = [{ kind: "INSTANCES", quantity: 10, amount: 70 }, { kind: "USERS", quantity: 30, amount: 50 }, { kind: "ATTENDANCES", quantity: 1000, amount: 100 }, { kind: "AUTOMATIONS", quantity: 40, amount: 20 }, { kind: "OPEN_API", quantity: null, amount: 30 }, { kind: "INTEGRATIONS", quantity: null, amount: 10 }];
  for (const type of ["UPSELL", "DOWNSELL"]) assert.equal(activitySchema.safeParse({ ...valid, type, items, amount: 280 }).success, true);
  for (const [kind, quantity] of [["INSTANCES", 11], ["USERS", 31], ["ATTENDANCES", 150], ["AUTOMATIONS", 7], ["OPEN_API", 1], ["INTEGRATIONS", 0]]) assert.equal(activitySchema.safeParse({ ...valid, items: [{ kind, quantity, amount: 120 }] }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, items, amount: 281 }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, items: [] }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, items: [items[0], items[0]], amount: 140 }).success, false);
  assert.equal(activitySchema.safeParse({ ...valid, type: "RENEWAL", items, amount: 280 }).success, false);
});

test("counts combined plan and cycle changes once financially and applies them on the effective date", async () => {
  const { effectiveSubscriptions, planMrrDelta } = await vite.ssrLoadModule("/lib/customer-activity.ts");
  const subscriptionId = "00000000-0000-4000-8000-000000000002";
  const event = { ...valid, id: "event", createdAt: "2026-09-05T12:00:00Z", type: "UPGRADE", occurredOn: "2026-10-01", amount: 3600, planChange: { subscriptionId, before: { name: "Inicial", period: "MONTHLY", value: 200 }, after: { name: "Pro", period: "ANNUAL", value: 3600 } } };
  assert.equal(activitySchema.safeParse(event).success, true);
  assert.equal(planMrrDelta(event.planChange), 100);
  const summary = summarizeActivities([event]);
  assert.equal(summary.upgrades, 1);
  assert.equal(summary.periodChanges, 1);
  assert.equal(summary.monthlyToAnnual, 1);
  assert.equal(summary.planMrrDelta, 100);
  const base = [{ id: subscriptionId, customer_id: valid.customerId, plan_name_raw: "Inicial", billing_period: "MONTHLY", value: 200 }];
  assert.equal(effectiveSubscriptions(base, [event], "2026-09-30")[0].value, 200);
  assert.equal(effectiveSubscriptions(base, [event], "2026-10-01")[0].value, 3600);
  assert.equal(base[0].value, 200);
  const downgrade = { ...event, type: "DOWNGRADE", amount: 200, planChange: { subscriptionId, before: event.planChange.after, after: event.planChange.before } };
  assert.equal(summarizeActivities([downgrade]).planMrrDelta, -100);
  assert.equal(summarizeActivities([downgrade]).annualToMonthly, 1);
  assert.equal(activitySchema.safeParse({ ...event, type: "PERIOD_CHANGE" }).success, false);
  assert.equal(activitySchema.safeParse({ ...event, planChange: undefined }).success, false);
  const cycleOnly = { ...event, type: "PERIOD_CHANGE", planChange: { ...event.planChange, after: { ...event.planChange.after, name: "Inicial" } } };
  assert.equal(activitySchema.safeParse(cycleOnly).success, true);
});
