import { supabaseRequest } from "./supabase-server";
import { currentTenant } from "./tenant-server";

export type StoredAsaasCustomer = {
  id: string;
  asaas_customer_id: string | null;
  external_office_id?: string | null;
  acquisition_actor_id: string | null;
  office_name: string;
  responsible_name: string | null;
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "CANCELLED" | "FROZEN" | null;
};

const CUSTOMER_SELECT = "id,asaas_customer_id,external_office_id,acquisition_actor_id,office_name,responsible_name,email,phone,status";
const exclusionCache = new Map<string, { expiresAt: number; ids: Set<string> }>();

export async function excludedAsaasCustomerIds(asaasCustomerIds: string[]) {
  const tenant = await currentTenant();
  let cached = exclusionCache.get(tenant.id);
  if (!cached || cached.expiresAt <= Date.now()) {
    const rows = await supabaseRequest<{ asaas_customer_id: string }[]>("/rest/v1/asaas_customer_exclusions?select=asaas_customer_id");
    cached = { expiresAt: Date.now() + 60_000, ids: new Set(rows.map(row => row.asaas_customer_id)) };
    exclusionCache.set(tenant.id, cached);
  }
  return new Set(asaasCustomerIds.filter(id => cached.ids.has(id)));
}

async function oneCustomer(filter: string) {
  const rows = await supabaseRequest<StoredAsaasCustomer[]>(`/rest/v1/customers?select=${CUSTOMER_SELECT}&${filter}&order=id.asc&limit=1`);
  return rows[0] ?? null;
}

/** Resolve tanto o ID principal quanto qualquer cus_* adicional do mesmo cliente. */
export async function findCustomerByAsaasId(asaasCustomerId: string) {
  if ((await excludedAsaasCustomerIds([asaasCustomerId])).has(asaasCustomerId)) return null;
  const direct = await oneCustomer(`asaas_customer_id=eq.${encodeURIComponent(asaasCustomerId)}`);
  if (direct) return direct;
  const aliases = await supabaseRequest<{ customer_id: string }[]>(`/rest/v1/customer_asaas_aliases?select=customer_id&asaas_customer_id=eq.${encodeURIComponent(asaasCustomerId)}&limit=1`);
  if (!aliases[0]) return null;
  return oneCustomer(`id=eq.${encodeURIComponent(aliases[0].customer_id)}`);
}

/** Registra um novo ID sem permitir que um alias existente seja reassociado silenciosamente. */
export async function rememberCustomerAsaasId(customer: Pick<StoredAsaasCustomer, "id" | "asaas_customer_id">, asaasCustomerId: string) {
  await supabaseRequest("/rest/v1/customer_asaas_aliases?on_conflict=tenant_id,asaas_customer_id", {
    method: "POST",
    prefer: "resolution=ignore-duplicates",
    body: { customer_id: customer.id, asaas_customer_id: asaasCustomerId, is_primary: customer.asaas_customer_id === asaasCustomerId },
  });
}

export async function customersByAsaasIds(asaasCustomerIds: string[]) {
  const ids = [...new Set(asaasCustomerIds)];
  const result = new Map<string, Pick<StoredAsaasCustomer, "id" | "status">>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const pageIds = ids.slice(offset, offset + 100);
    const filter = pageIds.map(value => `"${value}"`).join(",");
    const direct = await supabaseRequest<Pick<StoredAsaasCustomer, "id" | "asaas_customer_id" | "status">[]>(`/rest/v1/customers?select=id,asaas_customer_id,status&asaas_customer_id=in.(${filter})`);
    for (const customer of direct) if (customer.asaas_customer_id) result.set(customer.asaas_customer_id, { id: customer.id, status: customer.status });

    const missing = pageIds.filter(id => !result.has(id));
    if (!missing.length) continue;
    const aliasFilter = missing.map(value => `"${value}"`).join(",");
    const aliases = await supabaseRequest<{ asaas_customer_id: string; customer_id: string }[]>(`/rest/v1/customer_asaas_aliases?select=asaas_customer_id,customer_id&asaas_customer_id=in.(${aliasFilter})`);
    const customerIds = [...new Set(aliases.map(alias => alias.customer_id))];
    if (!customerIds.length) continue;
    const customerFilter = customerIds.map(value => `"${value}"`).join(",");
    const customers = await supabaseRequest<Pick<StoredAsaasCustomer, "id" | "status">[]>(`/rest/v1/customers?select=id,status&id=in.(${customerFilter})`);
    const customerById = new Map(customers.map(customer => [customer.id, customer]));
    for (const alias of aliases) if (customerById.has(alias.customer_id)) result.set(alias.asaas_customer_id, customerById.get(alias.customer_id)!);
  }
  return result;
}

export async function customerStatusesByAsaasIds(asaasCustomerIds: string[]) {
  const customers = await customersByAsaasIds(asaasCustomerIds);
  return new Map([...customers].map(([asaasId, customer]) => [asaasId, customer.status]));
}
