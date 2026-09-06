import { isOneTimePlanKind, type Plan } from "@/lib/metrics";
import { supabaseRequest } from "@/lib/supabase-server";

/**
 * Defaults to ACTIVE-only, matching every existing consumer that treats
 * this as "the sellable catalog" (price pickers, link candidates, etc.) —
 * changing that default would silently let those screens offer/price
 * deactivated plans. The plans management panel passes `?status=all` to
 * also see and reactivate deactivated ones.
 */
export async function GET(request: Request) {
  try {
    const statusParam = new URL(request.url).searchParams.get("status");
    const filter = statusParam === "all" ? "" : "&status=eq.ACTIVE";
    const plans = await supabaseRequest<unknown[]>(
      `/rest/v1/plans?select=*${filter}&order=name.asc,billing_period.asc`,
    );
    return Response.json({ plans });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar planos." }, { status: 500 });
  }
}

type PlanPayload = {
  code?: string;
  name?: string;
  billingPeriod?: "MONTHLY" | "ANNUAL" | "ONE_TIME";
  standardValue?: number;
  annualInstallmentLimit?: number | null;
  kind?: Plan["kind"];
};

/** Manually registers a plan in the catalog, to then attach payment links to it. */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as PlanPayload;
    if (!payload.code?.trim()) return Response.json({ error: "Informe o código do plano." }, { status: 400 });
    if (!payload.name?.trim()) return Response.json({ error: "Informe o nome do plano." }, { status: 400 });
    const kind: Plan["kind"] = payload.kind === "IMPLEMENTATION" ? "IMPLEMENTATION" : payload.kind === "CONSULTING" ? "CONSULTING" : "RECURRING";
    // Implantação e consultoria são sempre taxa única — ignora o que veio
    // no billingPeriod e força ONE_TIME, para nunca acabar com um desses
    // produtos marcado como recorrente por engano.
    const billingPeriod = isOneTimePlanKind(kind) ? "ONE_TIME" : payload.billingPeriod;
    if (billingPeriod !== "MONTHLY" && billingPeriod !== "ANNUAL" && billingPeriod !== "ONE_TIME") return Response.json({ error: "Periodicidade inválida." }, { status: 400 });
    const standardValue = Number(payload.standardValue);
    if (!Number.isFinite(standardValue) || standardValue <= 0) return Response.json({ error: "Informe um valor padrão válido." }, { status: 400 });
    const annualInstallmentLimit = payload.annualInstallmentLimit != null ? Math.min(12, Math.max(1, Math.round(Number(payload.annualInstallmentLimit)))) : null;

    const [plan] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/plans", {
      method: "POST",
      prefer: "return=representation",
      body: {
        code: payload.code.trim().toUpperCase(),
        name: payload.name.trim(),
        billing_period: billingPeriod,
        kind,
        standard_value: standardValue,
        annual_installment_limit: annualInstallmentLimit,
        status: "ACTIVE",
      },
    });
    return Response.json({ plan }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao criar plano." }, { status: 500 });
  }
}

/** Edits any field of an existing plan, or toggles ACTIVE/INACTIVE. */
export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as PlanPayload & { id?: string; status?: "ACTIVE" | "INACTIVE" };
    if (!payload.id) return Response.json({ error: "id é obrigatório." }, { status: 400 });

    const body: Record<string, unknown> = {};
    if (payload.name !== undefined) {
      if (!payload.name.trim()) return Response.json({ error: "Nome não pode ficar em branco." }, { status: 400 });
      body.name = payload.name.trim();
    }
    if (payload.code !== undefined) {
      if (!payload.code.trim()) return Response.json({ error: "Código não pode ficar em branco." }, { status: 400 });
      body.code = payload.code.trim().toUpperCase();
    }
    if (payload.kind !== undefined) {
      if (payload.kind !== "RECURRING" && payload.kind !== "IMPLEMENTATION" && payload.kind !== "CONSULTING") return Response.json({ error: "Tipo inválido." }, { status: 400 });
      body.kind = payload.kind;
      // Mantém a regra "implantação/consultoria é sempre taxa única" mesmo em edições.
      if (isOneTimePlanKind(payload.kind)) body.billing_period = "ONE_TIME";
    }
    if (payload.billingPeriod !== undefined && body.billing_period === undefined) {
      if (payload.billingPeriod !== "MONTHLY" && payload.billingPeriod !== "ANNUAL" && payload.billingPeriod !== "ONE_TIME") return Response.json({ error: "Periodicidade inválida." }, { status: 400 });
      body.billing_period = payload.billingPeriod;
    }
    if (payload.standardValue !== undefined) {
      const standardValue = Number(payload.standardValue);
      if (!Number.isFinite(standardValue) || standardValue <= 0) return Response.json({ error: "Informe um valor padrão válido." }, { status: 400 });
      body.standard_value = standardValue;
    }
    if (payload.annualInstallmentLimit !== undefined) {
      const raw = Number(payload.annualInstallmentLimit);
      if (!Number.isFinite(raw)) return Response.json({ error: "Número de parcelas inválido." }, { status: 400 });
      body.annual_installment_limit = Math.min(12, Math.max(1, Math.round(raw)));
    }
    if (payload.status !== undefined) {
      if (payload.status !== "ACTIVE" && payload.status !== "INACTIVE") return Response.json({ error: "Status inválido." }, { status: 400 });
      body.status = payload.status;
    }
    if (Object.keys(body).length === 0) return Response.json({ error: "Nada para atualizar." }, { status: 400 });

    const [plan] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/plans?id=eq.${encodeURIComponent(payload.id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body,
    });
    return Response.json({ plan });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar plano." }, { status: 500 });
  }
}
