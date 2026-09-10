import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", cacheDir: "node_modules/.vite-tests/client-sheet-sync", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());

test("reconciles changed client numbers, inserts complete rows and reports system-only emails", async () => {
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { syncClientsFromSheet } = await vite.ssrLoadModule("/lib/client-sheet-sync.ts");
  const previousFetch = globalThis.fetch;
  const previous = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_URL: "https://db.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    CLIENTS_SHEET_WEBHOOK_URL: "https://sheet.invalid/clients",
    CLIENTS_SHEET_WEBHOOK_AUTH: "sheet-test",
  });
  const customers = [
    { id: "customer-a", external_office_id: "10", office_name: "Nome antigo", responsible_name: "Ana", email: "ana@example.com", phone: null, city: null, state: null, service_area: null, source_channel: null, signed_at: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "customer-old", external_office_id: "99", office_name: "Fora da base", responsible_name: null, email: "fora@example.com", phone: null, city: null, state: null, service_area: null, source_channel: null, signed_at: "2025-01-01", created_at: "2026-01-01T00:00:00Z" },
    { id: "legacy-keep", external_office_id: null, office_name: "Legado", responsible_name: null, email: "legacy@example.com", phone: null, city: null, state: null, service_area: null, source_channel: null, signed_at: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "legacy-merge", external_office_id: null, office_name: "Legado", responsible_name: null, email: "legacy@example.com", phone: null, city: null, state: null, service_area: null, source_channel: null, signed_at: null, created_at: "2026-02-01T00:00:00Z" },
  ];
  const audits = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.host === "sheet.invalid") return Response.json([
      { Email: "ANA@example.com", office_id: "", "Número do cliente": 20, "Nome do Escritório": "Nome atualizado", "Assinado em": "01/09/2026" },
      { Email: "novo@example.com", office_id: 21, "Nome do Escritório": "Cliente novo", "Assinado em": "02/09/2026" },
      { Email: "sem-data@example.com", office_id: 22, "Nome do Escritório": "Sem data" },
      { Email: "shared@example.com", office_id: 31, "Nome do Escritório": "Compartilhado A", "Assinado em": "03/09/2026" },
      { Email: "shared@example.com", office_id: 32, "Nome do Escritório": "Compartilhado B", "Assinado em": "04/09/2026" },
      { Email: "legacy@example.com", office_id: 40, "Nome do Escritório": "Legado consolidado", "Assinado em": "05/09/2026" },
    ]);
    const table = url.pathname.split("/").at(-1);
    if (table === "merge_customer_records" && options.method === "POST") {
      const payload = JSON.parse(options.body);
      assert.equal(payload.p_keep, "legacy-keep");
      assert.deepEqual(payload.p_merge, ["legacy-merge"]);
      customers.splice(customers.findIndex(row => row.id === "legacy-merge"), 1);
      return Response.json({ merged: 1, kept: "legacy-keep" });
    }
    if (table === "customers" && (!options.method || options.method === "GET")) return Response.json(customers);
    const body = options.body ? JSON.parse(options.body) : null;
    if (table === "customers" && options.method === "PATCH") {
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const customer = customers.find(row => row.id === id);
      Object.assign(customer, body);
      return Response.json([customer]);
    }
    if (table === "customers" && options.method === "POST") {
      const customer = { id: `customer-${customers.length}`, ...body };
      customers.push(customer);
      return Response.json([customer]);
    }
    if (table === "audit_events" && options.method === "POST") { audits.push(body); return Response.json([body]); }
    throw new Error(`Unexpected request ${options.method ?? "GET"} ${url}`);
  };
  try {
    const result = await withWebhookTenant({ id: "tenant-a", legacy: true }, () => syncClientsFromSheet());
    assert.equal(result.created, 3);
    assert.equal(result.updated, 2);
    assert.equal(result.consolidated, 1);
    assert.deepEqual(result.consolidatedEmails, ["legacy@example.com"]);
    assert.deepEqual(result.skippedWithoutSignedAt, ["sem-data@example.com"]);
    assert.deepEqual(result.systemOnlyEmails, ["fora@example.com"]);
    assert.deepEqual(result.duplicateSheetEmails, ["shared@example.com"]);
    assert.deepEqual(result.unresolvedRows, []);
    assert.equal(customers.find(row => row.id === "customer-a").external_office_id, "20");
    assert.equal(customers.find(row => row.id === "customer-a").signed_at, "2026-09-01");
    assert.equal(customers.find(row => row.email === "novo@example.com").signed_at, "2026-09-02");
    assert.deepEqual(customers.filter(row => row.email === "shared@example.com").map(row => row.external_office_id).sort(), ["31", "32"]);
    assert.equal(audits[0].entity_type, "client_sheet_sync");
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CLIENTS_SHEET_WEBHOOK_URL", "CLIENTS_SHEET_WEBHOOK_AUTH"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
