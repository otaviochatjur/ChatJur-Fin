import { requireUser, sameOrigin } from "@/lib/auth-server";
import { readIntegrationKey } from "@/lib/integrations-server";
import { listTallyForms } from "@/lib/tally-forms";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const body = await request.json().catch(() => ({}));
    if (body.apiKey !== undefined && (typeof body.apiKey !== "string" || body.apiKey.length > 8192)) throw new Error("Chave inválida.");
    const apiKey = body.apiKey?.trim() || (await readIntegrationKey("tally"))?.apiKey;
    if (!apiKey || apiKey.length < 10) throw new Error("Informe sua chave de API do Tally.");
    return Response.json({ forms: await listTallyForms(apiKey) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Não foi possível consultar o Tally." }, { status: 400 }); }
}
