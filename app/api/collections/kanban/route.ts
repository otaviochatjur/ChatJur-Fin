import { requireUser } from "@/lib/auth-server";
import { readAsaasBaseState } from "@/lib/asaas-base";
import type { AsaasCustomer, AsaasPayment } from "@/lib/asaas";
import { collectionSchedule, collectionToday, dayDistance } from "@/lib/collection-policy";
import type { ReportRow, ReportSnapshot } from "@/lib/collection-report-types";
import { readCollectionSettings } from "@/lib/collection-settings-server";
import { rulesForCustomer } from "@/lib/collection-rules";
import { customersByAsaasIds, excludedAsaasCustomerIds } from "@/lib/customer-asaas-aliases";
import { supabaseRequest } from "@/lib/supabase-server";

export async function GET() {
  try { await requireUser(); } catch { return Response.json({ error: "Entre novamente." }, { status: 401 }); }
  try {
    const base = await readAsaasBaseState();
    if (!base?.active_generation) throw new Error("Sincronize a Base do Asaas para visualizar o Kanban.");
    const source: { external_id: string; payload: AsaasPayment & { invoiceUrl?: string; bankSlipUrl?: string }; customer_payload: AsaasCustomer | null }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({
        generation: `eq.${base.active_generation}`,
        select: "external_id,payload,customer_payload",
        order: "external_id.asc",
        limit: "1000",
        offset: String(offset),
      });
      params.set("payload->>status", "eq.OVERDUE");
      const page = await supabaseRequest<typeof source>(`/rest/v1/asaas_base_payments?${params}`);
      source.push(...page);
      if (page.length < 1000) break;
    }
    const excluded = await excludedAsaasCustomerIds(source.map(row => row.payload.customer));
    const included = source.filter(row => !excluded.has(row.payload.customer));
    const linkedCustomers = await customersByAsaasIds(included.map(row => row.payload.customer));
    const settings = await readCollectionSettings();
    const today = collectionToday();
    const rows: ReportRow[] = included.map(({ external_id, payload, customer_payload }) => {
      const days = payload.dueDate ? dayDistance(today, payload.dueDate) : NaN;
      const snapshot: ReportSnapshot = {
        payment_id: payload.id,
        customer_id: payload.customer,
        name: customer_payload?.name ?? "Cliente não identificado",
        email: customer_payload?.email ?? "",
        phone: customer_payload?.mobilePhone ?? customer_payload?.phone ?? "",
        status: payload.status,
        value: Number(payload.value),
        due_date: payload.dueDate ?? null,
        description: payload.description ?? "",
        billing_type: payload.billingType ?? "",
        days: Number.isFinite(days) ? days : null,
        ...collectionSchedule(payload.dueDate ?? null, today, rulesForCustomer(settings, payload.customer)),
        invoice_url: payload.invoiceUrl ?? null,
        bankslip_url: payload.bankSlipUrl ?? null,
        pix_payload: null,
        pix_image: null,
        pix_expiration: null,
        warnings: customer_payload ? [] : ["Cadastro do cliente indisponível na base sincronizada"],
      };
      const linked = linkedCustomers.get(payload.customer);
      return { id: external_id, report_id: "kanban:overdue", asaas_payment_id: external_id, snapshot, internal_customer_id: linked?.id ?? null, customer_found: Boolean(linked), customer_status: linked?.status };
    });
    const sourceUpdatedAt = base.last_event_at && base.last_event_at > (base.completed_at ?? "") ? base.last_event_at : base.completed_at;
    return Response.json({ rows, sourceUpdatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível carregar o Kanban." }, { status: 400 });
  }
}
