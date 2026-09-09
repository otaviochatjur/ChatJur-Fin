import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator < 1) continue;
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^\\\$/, "$" );
  process.env[key] ??= value;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase não configurado em .env.");

const ownerEmail = process.argv.find(arg => arg.startsWith("--email="))?.slice(8) ?? "otavio@chatjuridico.com.br";
const response = await fetch(`${url}/rest/v1/nexo_tenants?reserved_email=eq.${encodeURIComponent(ownerEmail)}&select=id,owner_user_id,reserved_email,legacy&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!response.ok) throw new Error(`Não foi possível localizar a conta (${response.status}).`);
const [tenant] = await response.json();
if (!tenant) throw new Error(`Conta não encontrada para ${ownerEmail}.`);

const vite = await createServer({ appType: "custom", cacheDir: "node_modules/.vite-client-sheet-sync", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { withWebhookTenant } = await vite.ssrLoadModule("/lib/tenant-server.ts");
  const { syncClientsFromSheet } = await vite.ssrLoadModule("/lib/client-sheet-sync.ts");
  const apply = process.argv.includes("--apply");
  const result = await withWebhookTenant(tenant, () => syncClientsFromSheet({ dryRun: !apply }));
  console.log(JSON.stringify({ mode: apply ? "applied" : "preview", ...result }, null, 2));
} finally {
  await vite.close();
}
