import { randomBytes } from "node:crypto";
import { chatRequest } from "@/lib/chat-juridico-server";
import { FINANCIAL_INSTANCE } from "@/lib/collection-policy";
import { requireUser, sameOrigin } from "@/lib/auth-server";
import { adminRequest, currentTenant } from "@/lib/tenant-server";
import { getIntegration, openSecret, sealSecret, secretHash, validateAsaasKey } from "@/lib/integrations-server";
import { validateTallyKey } from "@/lib/tally-sync";

export async function GET() {
  try {
    await requireUser();
    const tenant = await currentTenant();
    const [asaas, chat, tally] = await Promise.all([getIntegration("asaas"), getIntegration("chat-juridico"), getIntegration("tally")]);
    return Response.json({ asaas: { configured: Boolean(asaas || (tenant.legacy && process.env.ASAAS_API_KEY)), environment: asaas?.environment ?? (process.env.ASAAS_BASE_URL?.includes("sandbox") ? "sandbox" : "production") }, chat: { configured: Boolean(chat) }, tally: { configured: Boolean(tally), formId: tally?.account_id ?? "2EWBOV" } }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Entre na sua conta para gerenciar integrações." }, { status: 401 }); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  const body = await request.json().catch(() => null);
  if (!body || !["asaas", "chat-juridico", "tally"].includes(body.provider) || typeof body.apiKey !== "string" || (body.apiKey.trim().length < 10 && !(body.provider === "tally" && body.apiKey.trim() === "")) || body.apiKey.length > 8192 || !["sandbox", "production"].includes(body.environment)) return Response.json({ error: "Informe uma chave válida e o ambiente." }, { status: 400 });
  try {
    const tenant = await currentTenant();
    const existing = await getIntegration(body.provider);
    const apiKey = body.apiKey.trim() || (body.provider === "tally" && existing ? openSecret(existing.encrypted_key, tenant.id, "tally") : "");
    if (!apiKey) throw new Error("Informe a chave de API.");
    const encrypted = sealSecret(apiKey, tenant.id, body.provider);
    let accountId: string | null = null;
    if (body.provider === "tally") {
      if (typeof body.formId !== "string" || !/^[a-zA-Z0-9]{3,80}$/.test(body.formId)) return Response.json({ error: "Informe o identificador do formulário Tally." }, { status: 400 });
      await validateTallyKey(apiKey, body.formId);
      accountId = body.formId;
    }
    if (body.provider === "chat-juridico") {
      await chatRequest(`/v1/instances/${FINANCIAL_INSTANCE}`, { apiKey });
      await chatRequest(`/v1/templates?instance_id=${FINANCIAL_INSTANCE}&status=APPROVED`, { apiKey });
      await chatRequest("/v1/payments?limit=1", { apiKey });
    }
    if (body.provider === "asaas") {
      accountId = await validateAsaasKey(apiKey, body.environment);
      let previousAccount = existing?.account_id;
      if (!previousAccount && tenant.legacy && process.env.ASAAS_API_KEY) previousAccount = await validateAsaasKey(process.env.ASAAS_API_KEY, process.env.ASAAS_BASE_URL?.includes("sandbox") ? "sandbox" : "production");
      if (previousAccount && previousAccount !== accountId) return Response.json({ error: "Esta base pertence a outra conta Asaas. Use um novo usuário para conectar outra conta sem misturar os dados." }, { status: 409 });
    }
    const webhookToken = body.provider === "asaas" && !existing?.webhook_hash ? randomBytes(32).toString("hex") : null;
    const row = { tenant_id: tenant.id, provider: body.provider, encrypted_key: encrypted, environment: body.environment, account_id: accountId, webhook_hash: webhookToken ? secretHash(webhookToken) : existing?.webhook_hash ?? null, updated_at: new Date().toISOString() };
    await adminRequest(`/rest/v1/nexo_integrations${existing ? `?tenant_id=eq.${tenant.id}&provider=eq.${body.provider}` : ""}`, { method: existing ? "PATCH" : "POST", body: row });
    return Response.json({ ok: true, webhookToken }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Não foi possível salvar a integração." }, { status: 400 }); }
}
