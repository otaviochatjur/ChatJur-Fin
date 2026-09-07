import { requireUser, sameOrigin } from "@/lib/auth-server";
import { readCollectionSettings } from "@/lib/collection-settings-server";
import { collectionSettingsSchema } from "@/lib/collection-rules";
import { supabaseRequest } from "@/lib/supabase-server";
import { chatRequest } from "@/lib/chat-juridico-server";
import { FINANCIAL_INSTANCE, type BillingTemplate } from "@/lib/collection-policy";
export async function GET(request: Request) {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    if (new URL(request.url).searchParams.has("templates")) {
      const result = await chatRequest<{ data: BillingTemplate[] }>(`/v1/templates?instance_id=${FINANCIAL_INSTANCE}&status=APPROVED`);
      return Response.json({ templates: result.data }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ config: await readCollectionSettings() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Falha ao ler a configuração." }, { status: 400 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  const parsed = collectionSettingsSchema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Régua inválida." }, { status: 400 });
  try {
    await supabaseRequest("/rest/v1/collection_settings?on_conflict=tenant_id", { method: "POST", prefer: "resolution=merge-duplicates", body: { config: parsed.data, updated_at: new Date().toISOString() } });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "Não foi possível salvar a régua." }, { status: 400 }); }
}
