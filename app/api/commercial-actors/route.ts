import { supabaseRequest } from "@/lib/supabase-server";
import { connectDefaultRatePercent } from "@/lib/metrics";

const roles = ["PARTNER", "AMBASSADOR", "EXTERNAL_SALES", "INTERNAL_SALES", "INSTITUTIONAL"] as const;
const tiers = ["STANDARD", "PLUS"] as const;

export async function GET(request: Request) {
  try {
    const role = new URL(request.url).searchParams.get("role");
    const filter = role && roles.includes(role as typeof roles[number]) ? `&role=eq.${encodeURIComponent(role)}` : "";
    const actors = await supabaseRequest<unknown[]>(`/rest/v1/commercial_actors?select=*&order=role.asc,name.asc${filter}`);
    return Response.json({ actors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar cadastros." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { name?: string; role?: typeof roles[number]; tier?: typeof tiers[number]; email?: string; phone?: string; notes?: string };
    const name = payload.name?.trim();
    if (!name || !payload.role || !roles.includes(payload.role)) return Response.json({ error: "Nome e papel comercial válidos são obrigatórios." }, { status: 400 });
    const tier = payload.tier && tiers.includes(payload.tier) ? payload.tier : "STANDARD";
    const [actor] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/commercial_actors", { method: "POST", prefer: "return=representation", body: { name, role: payload.role, tier, email: payload.email?.trim() || null, phone: payload.phone?.trim() || null, notes: payload.notes?.trim() || null } });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "commercial_actor", entity_id: String(actor.id), action: "CREATED", after_json: actor } });

    // Seed the actor's default commission rate with the official Connect
    // category % right away (Parceiro 10 / Plus 15 / Embaixador 15 /
    // Institucional 10) — still editable later from the Comissão tab.
    const defaultRate = connectDefaultRatePercent(payload.role, tier);
    if (defaultRate !== null) {
      await supabaseRequest("/rest/v1/actor_commission_rates", { method: "POST", body: { actor_id: actor.id, plan_id: null, custom_plan_id: null, rate_percent: defaultRate } }).catch(() => null);
    }

    return Response.json({ actor }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao cadastrar." }, { status: 500 });
  }
}

const bankAccountTypes = ["CORRENTE", "POUPANCA"] as const;

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as {
      id?: string;
      status?: "ACTIVE" | "INACTIVE";
      role?: typeof roles[number];
      tier?: typeof tiers[number];
      email?: string | null;
      phone?: string | null;
      notes?: string | null;
      document?: string | null;
      pixKey?: string | null;
      bankName?: string | null;
      bankAgency?: string | null;
      bankAccount?: string | null;
      bankAccountType?: typeof bankAccountTypes[number] | null;
      bankNotes?: string | null;
      instagram?: string | null;
      linkedin?: string | null;
      youtube?: string | null;
      tiktok?: string | null;
      twitterX?: string | null;
      website?: string | null;
    };
    if (!payload.id) return Response.json({ error: "id é obrigatório." }, { status: 400 });

    const body: Record<string, unknown> = {};
    if (payload.status !== undefined) body.status = payload.status;
    // Recategorização entre Parceiro / Embaixador / Institucional (ou para
    // fora do Connect). Deliberadamente não toca em actor_commission_rates
    // nem actor_price_versions — a taxa padrão da categoria pode ser
    // restaurada manualmente na aba Comissão ("Restaurar taxa padrão") se
    // o operador quiser, mas overrides por plano são preservados.
    if (payload.role !== undefined) {
      if (!roles.includes(payload.role)) return Response.json({ error: "Papel comercial inválido." }, { status: 400 });
      body.role = payload.role;
    }
    if (payload.tier !== undefined && tiers.includes(payload.tier)) body.tier = payload.tier;
    if (payload.email !== undefined) body.email = payload.email;
    if (payload.phone !== undefined) body.phone = payload.phone;
    if (payload.notes !== undefined) body.notes = payload.notes;
    if (payload.document !== undefined) body.document = payload.document?.trim() || null;
    if (payload.pixKey !== undefined) body.pix_key = payload.pixKey?.trim() || null;
    if (payload.bankName !== undefined) body.bank_name = payload.bankName?.trim() || null;
    if (payload.bankAgency !== undefined) body.bank_agency = payload.bankAgency?.trim() || null;
    if (payload.bankAccount !== undefined) body.bank_account = payload.bankAccount?.trim() || null;
    if (payload.bankAccountType !== undefined) body.bank_account_type = payload.bankAccountType && bankAccountTypes.includes(payload.bankAccountType) ? payload.bankAccountType : null;
    if (payload.bankNotes !== undefined) body.bank_notes = payload.bankNotes?.trim() || null;
    if (payload.instagram !== undefined) body.instagram = payload.instagram?.trim() || null;
    if (payload.linkedin !== undefined) body.linkedin = payload.linkedin?.trim() || null;
    if (payload.youtube !== undefined) body.youtube = payload.youtube?.trim() || null;
    if (payload.tiktok !== undefined) body.tiktok = payload.tiktok?.trim() || null;
    if (payload.twitterX !== undefined) body.twitter_x = payload.twitterX?.trim() || null;
    if (payload.website !== undefined) body.website = payload.website?.trim() || null;
    if (Object.keys(body).length === 0) return Response.json({ error: "Nada para atualizar." }, { status: 400 });

    const [actor] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/commercial_actors?id=eq.${encodeURIComponent(payload.id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body,
    });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "commercial_actor", entity_id: payload.id, action: "UPDATED", after_json: actor } });
    return Response.json({ actor });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar cadastro." }, { status: 500 });
  }
}
