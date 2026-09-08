import { requireUser, sameOrigin } from "@/lib/auth-server";
import { advanceAsaasBaseSync, readAsaasBaseState, startAsaasBaseSync } from "@/lib/asaas-base";
export async function GET() {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try { return Response.json({ state: await readAsaasBaseState() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Falha ao consultar base." }, { status: 400 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem inválida." }, { status: 403 });
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const body = await request.json();
    if (body.action === "start") return Response.json({ state: await startAsaasBaseSync(body.force !== false) });
    if (body.action === "advance" && typeof body.generation === "string" && /^[a-f0-9-]{36}$/i.test(body.generation)) return Response.json({ state: await advanceAsaasBaseSync(body.generation) });
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Falha ao sincronizar." }, { status: 400 }); }
}
