import { supabaseRequest } from "./supabase-server";
import type { CustomerActivity } from "./customer-activity";
export async function readCustomerActivities() {
  const events: CustomerActivity[] = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await supabaseRequest<{ id: string; created_at: string; after_json: Omit<CustomerActivity, "id" | "createdAt"> }[]>(`/rest/v1/audit_events?entity_type=eq.customer_activity&select=id,created_at,after_json&order=created_at.desc,id.desc&limit=500&offset=${offset}`);
    events.push(...rows.map(row => ({ ...row.after_json, id: row.id, createdAt: row.created_at })));
    if (rows.length < 500) return events;
  }
}
