import { requireUser } from "@/lib/auth-server";
import { chatRequest, connectedChatInstances } from "@/lib/chat-juridico-server";
import { collectionTemplateCanPreview, type BillingTemplate } from "@/lib/collection-policy";

export async function GET() {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const connected = await connectedChatInstances();
    const instances = await Promise.all(connected.map(async instance => {
      const result = await chatRequest<{ data: BillingTemplate[] }>(`/v1/templates?instance_id=${encodeURIComponent(instance.id)}&status=APPROVED`);
      const approved = Array.isArray(result.data) ? result.data : [];
      return {
        ...instance,
        approved_template_count: approved.length,
        approved_template_names: [...new Set(approved.filter(collectionTemplateCanPreview).map(template => template.name))],
      };
    }));
    instances.sort((a, b) => (b.approved_template_count ?? 0) - (a.approved_template_count ?? 0) || (a.name ?? "").localeCompare(b.name ?? "", "pt-BR"));
    return Response.json({ instances }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível consultar os números conectados." }, { status: 400 });
  }
}
