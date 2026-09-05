import { listAllAsaasPaymentLinks, type AsaasPaymentLink } from "@/lib/asaas";
import { supabaseRequest } from "@/lib/supabase-server";

/**
 * Pulls every payment link that exists in the real Asaas account — not just
 * the ones created here via "Gerar link" — and creates a row for any that
 * we don't know about yet. Those land with actor_id/plan_id both null and
 * status 'PENDING', so the links management panel surfaces them for manual
 * assignment. Never touches a link we already track: this only fills gaps,
 * it doesn't overwrite anything a human already set up.
 */
function inferBillingPeriod(link: AsaasPaymentLink): "MONTHLY" | "ANNUAL" {
  return link.chargeType === "INSTALLMENT" ? "ANNUAL" : "MONTHLY";
}

export async function POST() {
  try {
    const known = await supabaseRequest<{ asaas_payment_link_id: string | null }[]>(
      "/rest/v1/payment_links?select=asaas_payment_link_id&asaas_payment_link_id=not.is.null",
    );
    const knownIds = new Set(known.map((row) => row.asaas_payment_link_id));

    let offset = 0;
    let hasMore = true;
    let totalSeen = 0;
    let imported = 0;
    let skippedNoValue = 0;
    let skippedDeleted = 0;

    while (hasMore) {
      const page = await listAllAsaasPaymentLinks(offset);
      for (const link of page.data) {
        totalSeen += 1;
        if (knownIds.has(link.id)) continue; // already tracked, never overwritten by this sync
        if (link.deleted) { skippedDeleted += 1; continue; }
        const value = Number(link.value);
        if (!Number.isFinite(value) || value <= 0) { skippedNoValue += 1; continue; } // e.g. "cliente decide o valor" links — our schema requires a fixed positive value

        await supabaseRequest("/rest/v1/payment_links", {
          method: "POST",
          body: {
            actor_id: null,
            plan_id: null,
            custom_plan_id: null,
            asaas_payment_link_id: link.id,
            external_reference: link.externalReference || `ASAAS_${link.id}`,
            url: link.url ?? null,
            display_name: link.name ?? "Link sem nome",
            value,
            billing_period: inferBillingPeriod(link),
            max_installments: link.chargeType === "INSTALLMENT" ? link.maxInstallmentCount ?? null : null,
            status: "PENDING",
            source: "ASAAS_SYNC",
          },
        });
        knownIds.add(link.id);
        imported += 1;
      }
      hasMore = page.hasMore;
      offset += 100;
    }

    return Response.json({ totalSeen, imported, skippedNoValue, skippedDeleted });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao sincronizar links do Asaas." }, { status: 500 });
  }
}
