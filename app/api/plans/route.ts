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
