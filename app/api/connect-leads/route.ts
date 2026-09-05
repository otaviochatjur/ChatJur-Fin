import { supabaseRequest } from "@/lib/supabase-server";
import { connectDefaultRatePercent } from "@/lib/metrics";

const statuses = ["PENDING", "APPROVED", "REJECTED"] as const;
const classifications = ["PARTNER", "AMBASSADOR", "INSTITUTIONAL"] as const;

/** Candidaturas recebidas via formulário Tally (ver app/api/webhooks/tally). */
export async function GET(request: Request) {
  try {
    const statusParam = new URL(request.url).searchParams.get("status");
    const filter = statusParam && statuses.includes(statusParam as typeof statuses[number]) ? `&status=eq.${encodeURIComponent(statusParam)}` : "";
    const leads = await supabaseRequest<unknown[]>(`/rest/v1/connect_leads?select=*&order=created_at.desc${filter}`);
    return Response.json({ leads });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao consultar candidaturas." }, { status: 500 });
  }
}

type LeadRecord = {
  id: string;
  full_name: string | null;
  email: string | null;
  whatsapp: string | null;
  cpf: string | null;
  company_cnpj: string | null;
  institution_cnpj: string | null;
  pix_key: string | null;
  instagram: string | null;
  linkedin: string | null;
  youtube: string | null;
  tiktok: string | null;
  twitter_x: string | null;
  website: string | null;
};

/**
 * Reviews a candidacy: "APPROVE" classifies it (Parceiro/Embaixador/
 * Institucional) and auto-creates the matching commercial_actor pre-filled
 * from the form data; "REJECT" just records the decision. Either way the
 * lead is never deleted — it stays as the audit trail of where the actor
 * (if any) came from.
 */
export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as {
      id?: string;
      action?: "APPROVE" | "REJECT";
      classifiedAs?: typeof classifications[number];
      reviewedNotes?: string;
    };
    if (!payload.id || !payload.action) return Response.json({ error: "id e ação são obrigatórios." }, { status: 400 });

    const [lead] = await supabaseRequest<LeadRecord[]>(`/rest/v1/connect_leads?select=*&id=eq.${encodeURIComponent(payload.id)}`);
    if (!lead) return Response.json({ error: "Candidatura não encontrada." }, { status: 404 });

    if (payload.action === "REJECT") {
      const [updated] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/connect_leads?id=eq.${encodeURIComponent(payload.id)}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: { status: "REJECTED", reviewed_at: new Date().toISOString(), reviewed_notes: payload.reviewedNotes?.trim() || null },
      });
      return Response.json({ lead: updated });
    }

    if (!payload.classifiedAs || !classifications.includes(payload.classifiedAs)) {
      return Response.json({ error: "Selecione Parceiro, Embaixador ou Institucional para aprovar." }, { status: 400 });
    }

    const document = lead.cpf || lead.company_cnpj || lead.institution_cnpj || null;
    const [actor] = await supabaseRequest<Record<string, unknown>[]>("/rest/v1/commercial_actors", {
      method: "POST",
      prefer: "return=representation",
      body: {
        name: lead.full_name ?? "Candidato Connect",
        role: payload.classifiedAs,
        tier: "STANDARD",
        email: lead.email ?? null,
        phone: lead.whatsapp ?? null,
        document,
        pix_key: lead.pix_key ?? null,
        instagram: lead.instagram ?? null,
        linkedin: lead.linkedin ?? null,
        youtube: lead.youtube ?? null,
        tiktok: lead.tiktok ?? null,
        twitter_x: lead.twitter_x ?? null,
        website: lead.website ?? null,
        notes: "Criado a partir de uma candidatura aprovada no Chat Jurídico Connect.",
      },
    });
    await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "commercial_actor", entity_id: String(actor.id), action: "CREATED", after_json: actor } });

    const defaultRate = connectDefaultRatePercent(payload.classifiedAs, "STANDARD");
    if (defaultRate !== null) {
      await supabaseRequest("/rest/v1/actor_commission_rates", { method: "POST", body: { actor_id: actor.id, plan_id: null, custom_plan_id: null, rate_percent: defaultRate } }).catch(() => null);
    }

    const [updatedLead] = await supabaseRequest<Record<string, unknown>[]>(`/rest/v1/connect_leads?id=eq.${encodeURIComponent(payload.id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        status: "APPROVED",
        classified_as: payload.classifiedAs,
        linked_actor_id: actor.id,
        reviewed_at: new Date().toISOString(),
        reviewed_notes: payload.reviewedNotes?.trim() || null,
      },
    });

    return Response.json({ lead: updatedLead, actor });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao revisar candidatura." }, { status: 500 });
  }
}
