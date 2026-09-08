import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom", cacheDir: "node_modules/.vite-tests/ui-components",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});


test("sorts table values without mutating data, keeping blanks last and ties stable", async () => {
  const { sortTableRows } = await vite.ssrLoadModule("/components/dashboard/table-toolbar.tsx");
  const rows = [{ id: 1, value: 100 }, { id: 2, value: null }, { id: 3, value: 9 }, { id: 4, value: 9 }];
  assert.deepEqual(sortTableRows(rows, row => row.value).map(row => row.id), [3, 4, 1, 2]);
  assert.deepEqual(sortTableRows(rows, row => row.value, true).map(row => row.id), [1, 3, 4, 2]);
  assert.deepEqual(rows.map(row => row.id), [1, 2, 3, 4]);
  assert.deepEqual(sortTableRows(["Plano 10", "Plano 2", "Ágata", "Bruna"], value => value), ["Ágata", "Bruna", "Plano 2", "Plano 10"]);
  assert.deepEqual(sortTableRows(["2026-02-01", "2025-12-31"], value => value), ["2025-12-31", "2026-02-01"]);
});

test("sortable headers expose direction and keep resize handles outside the sort button", async () => {
  const { ResizableTh } = await vite.ssrLoadModule("/components/dashboard/table-toolbar.tsx");
  const html = renderToStaticMarkup(React.createElement(ResizableTh, { width: 160, onResizeStart() {}, onSort() {}, sortDirection: "ascending" }, "Nome"));
  assert.match(html, /aria-sort="ascending"/);
  assert.match(html, /type="button"/);
  assert.match(html, /<\/button><span[^>]*role="separator"/);
});


test("subscription presentation uses the linked catalog and actor without changing the subscription", async () => {
  const { presentSubscription } = await vite.ssrLoadModule("/lib/subscription-presentation.ts");
  const base = { id: "real-subscription", customer_id: "customer", payment_link_id: "link", plan_name_raw: "Link promocional", value: 1200, billing_period: "ANNUAL", plans: { name: "Plano antigo" }, commercial_actors: { id: "old", name: "Antigo", role: "PARTNER", tier: "STANDARD" } };
  const result = presentSubscription({ ...base, payment_links: { plans: { name: "Plano do catálogo" }, actor_custom_plans: null, commercial_actors: { id: "seller", name: "Ana", role: "AMBASSADOR", tier: "STANDARD" } } });
  assert.equal(result.id, base.id);
  assert.equal(result.plan_name_raw, "Link promocional");
  assert.equal(result.value, 1200);
  assert.equal(result.display_plan_name, "Plano do catálogo");
  assert.equal(result.display_actor_id, "seller");
  assert.match(result.display_actor_label, /Ana/);
  const unbound = presentSubscription({ ...base, payment_links: { plans: null, actor_custom_plans: null, commercial_actors: null } });
  assert.equal(unbound.display_plan_name, "—");
  assert.equal(unbound.display_actor_id, null);
  const custom = presentSubscription({ ...base, payment_links: { plans: null, actor_custom_plans: { name: "Plano personalizado" }, commercial_actors: null } });
  assert.equal(custom.display_plan_name, "Plano personalizado");
  assert.equal(presentSubscription({ ...base, payment_link_id: null, plans: null }).display_plan_name, "—");
});

test("collection review exposes sender selection, complete message and Chat Jurídico dispatch actions", async () => {
  const source = await readFile(path.join(root, "components/dashboard/collections-section.tsx"), "utf8");
  const reports = await readFile(path.join(root, "components/dashboard/collection-reports.tsx"), "utf8");
  const route = await readFile(path.join(root, "app/api/collections/route.ts"), "utf8");
  assert.match(source, /Enviar pelo número/);
  assert.match(source, /Mensagem completa/);
  assert.match(source, /Disparar esta mensagem/);
  assert.match(source, /Disparar selecionadas pelo Chat Jurídico/);
  assert.match(source, /\/api\/collections\/instances/);
  assert.match(source, /action: "prepare"/);
  assert.match(source, /paymentIds: \[\.\.\.selected\]/);
  assert.match(source, /Lote pausado: \$\{result\.message\}/);
  assert.match(reports, /Cliente sem status Ativo confirmado/);
  assert.doesNotMatch(route, /Pagamento do Asaas sem vínculo no Chat Jurídico/);
  assert.doesNotMatch(route, /\/v1\/payments\?status=/);
});
