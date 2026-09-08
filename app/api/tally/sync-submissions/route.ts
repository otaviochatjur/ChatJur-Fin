import { requireUser, sameOrigin } from "@/lib/auth-server";
import { getIntegration, openSecret } from "@/lib/integrations-server";
import { syncTallySubmissions } from "@/lib/tally-sync";

/**
 * Manual "Sincronizar candidaturas" — pulls every submission of the
 * configured Tally form via its REST API and reflects new ones into
 * `connect_leads`. Mirrors "Sincronizar pagamentos" (app/api/asaas/sync-payments)
 * for Asaas: candidaturas depend only on the stored API key, never on a
 * webhook being registered inside Tally's own dashboard.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const integration = await getIntegration("tally");
    if (!integration || !integration.account_id) {
      return Response.json({ error: "Configure a chave de API e o identificador do formulário do Tally em Integrações." }, { status: 400 });
    }
    const apiKey = openSecret(integration.encrypted_key, integration.tenant_id, "tally");
    const result = await syncTallySubmissions(apiKey, integration.account_id);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível sincronizar as candidaturas." }, { status: 500 });
  }
}
