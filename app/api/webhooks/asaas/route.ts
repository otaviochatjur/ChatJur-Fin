import { resolveAsaasWebhook } from "@/lib/integrations-server";
import { withWebhookTenant } from "@/lib/tenant-server";
import type { AsaasPayment } from "@/lib/asaas";
import { syncAsaasPayment } from "@/lib/payment-sync";
import { supabaseRequest } from "@/lib/supabase-server";

type AsaasWebhookBody = { id?: string; event?: string; payment?: AsaasPayment };

const PAYMENT_EVENTS = new Set([
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
]);

/**
 * Receives real-time payment events from Asaas. Every PAYMENT_RECEIVED /
 * PAYMENT_CONFIRMED event carries the `paymentLink` id that originated the
 * charge, which is how we automatically trace "client X paid via link Y,
 * generated for partner Z" without any manual attribution step.
 *
 * Configure this route's public URL + the same ASAAS_WEBHOOK_TOKEN value in
 * the Asaas dashboard (Configurações > Integrações > Webhooks).
 */
export async function POST(request: Request) {
  const tenant = await resolveAsaasWebhook(request.headers.get("asaas-access-token"));
  if (!tenant) return Response.json({ error: "Token inválido." }, { status: 401 });
  return withWebhookTenant(tenant, () => handleWebhook(request));
}

async function handleWebhook(request: Request) {
  let body: AsaasWebhookBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corpo inválido." }, { status: 400 });
  }

  if (!body.event) return Response.json({ received: true });

  try {
    let eventRow: { id: string; processed_at: string | null } | null = null;
    if (body.id) {
      const existing = await supabaseRequest<{ id: string; processed_at: string | null }[]>(
        `/rest/v1/asaas_webhook_events?select=id,processed_at&asaas_event_id=eq.${encodeURIComponent(body.id)}`,
      );
      eventRow = existing[0] ?? null;
    }

    // Already fully processed on a previous delivery — Asaas retries on any
    // non-2xx, so this is expected and safe to no-op.
    if (eventRow?.processed_at) return Response.json({ received: true, deduplicated: true });

    if (!eventRow) {
      const [created] = await supabaseRequest<{ id: string; processed_at: string | null }[]>("/rest/v1/asaas_webhook_events", {
        method: "POST",
        prefer: "return=representation",
        body: { asaas_event_id: body.id ?? null, event_type: body.event, payment_id: body.payment?.id ?? null, payload: body },
      });
      eventRow = created;
    }

    if (PAYMENT_EVENTS.has(body.event) && body.payment) {
      await syncAsaasPayment(body.payment);
    }
    await supabaseRequest(`/rest/v1/asaas_webhook_events?id=eq.${eventRow.id}`, {
      method: "PATCH",
      body: { processed_at: new Date().toISOString() },
    });

    return Response.json({ received: true });
  } catch (error) {
    // Still return 200: we've logged the raw event, so a manual sync can
    // recover later. Returning an error here would make Asaas hammer retries.
    console.error("Erro ao processar webhook do Asaas:", error);
    return Response.json({ received: true, warning: error instanceof Error ? error.message : "Erro ao processar evento." });
  }
}
