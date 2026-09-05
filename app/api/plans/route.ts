import { supabaseRequest } from "@/lib/supabase-server";

export async function GET() {
  try {
    const plans = await supabaseRequest<unknown[]>(
      "/rest/v1/plans?select=*&status=eq.ACTIVE&order=name.asc,billing_period.asc",
    );
    return Response.json({ plans });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar planos." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { id?: string; annualInstallmentLimit?: number };
    if (!payload.id) return Response.json({ error: "id é obrigatório." }, { status: 400 });
    const raw = Number(payload.annualInstallmentLimit);
    if (!Number.isFinite(raw)) return Response.json({ error: "Número de parcelas inválido." }, { status: 400 });
    const annualInstallmentLimit = Math.min(12, Math.max(1, Math.round(raw)));
    const [plan] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/plans?id=eq.${encodeURIComponent(payload.id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: { annual_installment_limit: annualInstallmentLimit },
    });
    return Response.json({ plan });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar plano." }, { status: 500 });
  }
}
