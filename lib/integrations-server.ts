import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { adminRequest, currentTenant, type Tenant } from "./tenant-server";

export type Provider = "asaas" | "chat-juridico" | "tally";
export type Integration = { tenant_id: string; provider: Provider; encrypted_key: string; environment: "production" | "sandbox"; account_id: string | null; webhook_hash: string | null; updated_at: string };
export const asaasBaseUrl = (environment: string) => environment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
function encryptionKey() {
  const key = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error("O administrador precisa configurar a proteção das integrações no servidor.");
  return Buffer.from(key, "hex");
}
export function sealSecret(value: string, tenant: string, provider: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`${tenant}:${provider}`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), encrypted].map(part => part.toString("base64")).join(".");
}
export function openSecret(value: string, tenant: string, provider: string) {
  const [nonce, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`${tenant}:${provider}`)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString("utf8");
}
export async function getIntegration(provider: Provider) {
  const tenant = await currentTenant();
  const [row] = await adminRequest<Integration[]>(`/rest/v1/nexo_integrations?tenant_id=eq.${tenant.id}&provider=eq.${provider}&select=*`);
  return row ?? null;
}
export async function readIntegrationKey(provider: Provider) {
  const row = await getIntegration(provider);
  return row ? { apiKey: openSecret(row.encrypted_key, row.tenant_id, provider), environment: row.environment } : null;
}
export async function validateAsaasKey(apiKey: string, environment: string) {
  const response = await fetch(`${asaasBaseUrl(environment)}/myAccount/accountNumber`, { headers: { access_token: apiKey, "User-Agent": "Nexo/1.0" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Não foi possível validar a chave no Asaas. Confira a chave e o ambiente selecionado.");
  const data = await response.json();
  if (!data.account) throw new Error("O Asaas não retornou a identificação da conta.");
  return `${environment}:${data.agency ?? ""}/${data.account}-${data.accountDigit ?? ""}`;
}
export function secretHash(secret: string) { return createHash("sha256").update(secret).digest("hex"); }
export async function resolveAsaasWebhook(token: string | null): Promise<Tenant | null> {
  if (!token) return null;
  const [row] = await adminRequest<Integration[]>(`/rest/v1/nexo_integrations?provider=eq.asaas&webhook_hash=eq.${secretHash(token)}&select=tenant_id`);
  if (row) return (await adminRequest<Tenant[]>(`/rest/v1/nexo_tenants?id=eq.${row.tenant_id}&select=*`))[0] ?? null;
  const legacyToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (legacyToken && timingSafeEqual(Buffer.from(secretHash(legacyToken)), Buffer.from(secretHash(token)))) return (await adminRequest<Tenant[]>("/rest/v1/nexo_tenants?legacy=eq.true&select=*"))[0] ?? null;
  return null;
}
