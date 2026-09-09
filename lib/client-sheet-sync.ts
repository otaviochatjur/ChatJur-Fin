import { listClientsInSheet, type ClientSheetRow } from "./clients-allowlist";
import { supabaseRequest } from "./supabase-server";
import { currentTenant } from "./tenant-server";

type StoredCustomer = {
  id: string;
  external_office_id: string | null;
  office_name: string;
  responsible_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  service_area: string | null;
  source_channel: string | null;
  signed_at: string | null;
};

export type ClientSheetSyncResult = {
  sourceRows: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedWithoutSignedAt: string[];
  ignoredWithoutEmail: number;
  duplicateSheetEmails: string[];
  duplicateSystemEmails: string[];
  duplicateOfficeIds: string[];
  officeIdConflicts: string[];
  systemOnlyEmails: string[];
  systemCustomersWithoutEmail: string[];
};

const CUSTOMER_SELECT = "id,external_office_id,office_name,responsible_name,email,phone,city,state,service_area,source_channel,signed_at";

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

async function allCustomers() {
  const rows: StoredCustomer[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await supabaseRequest<StoredCustomer[]>(`/rest/v1/customers?select=${CUSTOMER_SELECT}&order=id.asc&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function intakeFields(row: ClientSheetRow) {
  return {
    ...(row.officeName ? { office_name: row.officeName } : {}),
    ...(row.responsibleName ? { responsible_name: row.responsibleName } : {}),
    email: row.email,
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(row.state ? { state: row.state } : {}),
    ...(row.serviceArea ? { service_area: row.serviceArea } : {}),
    ...(row.sourceChannel ? { source_channel: row.sourceChannel } : {}),
    ...(row.signedAt ? { signed_at: row.signedAt } : {}),
  };
}

function changed(customer: StoredCustomer, body: Record<string, unknown>) {
  return Object.entries(body).some(([key, value]) => customer[key as keyof StoredCustomer] !== value);
}

/**
 * Reconciles only intake/contact fields. Existing ids, status, plans,
 * subscriptions, payments, aliases and customer activity are preserved.
 */
export async function syncClientsFromSheet(options: { dryRun?: boolean } = {}): Promise<ClientSheetSyncResult> {
  const tenant = await currentTenant();
  if (!tenant.legacy) throw new Error("A Base de Clientes está disponível somente para a conta principal.");

  const [sheet, customers] = await Promise.all([listClientsInSheet(), allCustomers()]);
  const sourceRows = [...sheet.byEmail.values()];
  const systemByEmail = new Map<string, StoredCustomer[]>();
  for (const customer of customers) {
    const email = normalizedEmail(customer.email);
    if (!email) continue;
    const matches = systemByEmail.get(email) ?? [];
    matches.push(customer);
    systemByEmail.set(email, matches);
  }

  const duplicateSystemEmails = [...systemByEmail].filter(([, rows]) => rows.length > 1).map(([email]) => email).sort();
  const desiredOfficeOwners = new Map<string, ClientSheetRow[]>();
  for (const row of sourceRows) {
    if (!row.officeId) continue;
    const owners = desiredOfficeOwners.get(row.officeId) ?? [];
    owners.push(row);
    desiredOfficeOwners.set(row.officeId, owners);
  }
  const duplicateOfficeIds = [...desiredOfficeOwners].filter(([, rows]) => rows.length > 1).map(([id]) => id).sort();
  const duplicateOfficeIdSet = new Set(duplicateOfficeIds);
  const currentOfficeOwner = new Map(customers.filter(row => row.external_office_id).map(row => [row.external_office_id!, row]));
  const rowByCustomerId = new Map<string, ClientSheetRow>();
  for (const row of sourceRows) {
    const matches = systemByEmail.get(row.email) ?? [];
    if (matches.length === 1) rowByCustomerId.set(matches[0].id, row);
  }

  const officeIdConflicts: string[] = [];
  const canAssignOfficeId = new Map<string, boolean>();
  for (const row of sourceRows) {
    if (!row.officeId || duplicateOfficeIdSet.has(row.officeId)) { canAssignOfficeId.set(row.email, false); continue; }
    const owner = currentOfficeOwner.get(row.officeId);
    const matched = (systemByEmail.get(row.email) ?? []).length === 1 ? systemByEmail.get(row.email)![0] : null;
    if (!owner || owner.id === matched?.id) { canAssignOfficeId.set(row.email, true); continue; }
    const ownerTarget = rowByCustomerId.get(owner.id)?.officeId;
    if (ownerTarget && ownerTarget !== row.officeId && !duplicateOfficeIdSet.has(ownerTarget)) {
      canAssignOfficeId.set(row.email, true);
      continue;
    }
    canAssignOfficeId.set(row.email, false);
    officeIdConflicts.push(`${row.email}: número ${row.officeId} já pertence a ${owner.email ?? owner.office_name}`);
  }

  const releases = sourceRows.flatMap(row => {
    const matches = systemByEmail.get(row.email) ?? [];
    if (matches.length !== 1 || !row.officeId || !canAssignOfficeId.get(row.email)) return [];
    const customer = matches[0];
    return customer.external_office_id && customer.external_office_id !== row.officeId ? [customer] : [];
  });

  // Release all changed numbers first so a renumbering or swap cannot hit
  // the tenant-scoped unique constraint halfway through the reconciliation.
  if (!options.dryRun) for (const customer of releases) {
    await supabaseRequest(`/rest/v1/customers?id=eq.${encodeURIComponent(customer.id)}`, { method: "PATCH", body: { external_office_id: null } });
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const skippedWithoutSignedAt: string[] = [];
  try {
    for (const row of sourceRows) {
      const matches = systemByEmail.get(row.email) ?? [];
      if (matches.length > 1) continue;
      const existing = matches[0] ?? null;
      const body: Record<string, unknown> = intakeFields(row);
      if (row.officeId && canAssignOfficeId.get(row.email)) body.external_office_id = row.officeId;

      if (existing) {
        // A missing date in the source is reported, but never erases a date
        // that is already known in Supabase.
        if (!row.signedAt && !existing.signed_at) skippedWithoutSignedAt.push(row.email);
        if (!changed(existing, body)) { unchanged += 1; continue; }
        if (!options.dryRun) await supabaseRequest(`/rest/v1/customers?id=eq.${encodeURIComponent(existing.id)}`, { method: "PATCH", body });
        updated += 1;
        continue;
      }

      // Every new client must enter the system with its signature date.
      if (!row.signedAt) { skippedWithoutSignedAt.push(row.email); continue; }
      if (!options.dryRun) await supabaseRequest("/rest/v1/customers", {
        method: "POST",
        body: {
          ...body,
          office_name: row.officeName ?? row.responsibleName ?? row.email,
          external_office_id: row.officeId && canAssignOfficeId.get(row.email) ? row.officeId : null,
          status: "ACTIVE",
          source_channel: row.sourceChannel ?? "BASE_CLIENTES",
        },
      });
      created += 1;
    }
  } catch (error) {
    // Restore numbers released before a failed run. Contact-field updates are
    // idempotent and may safely be retried on the next synchronization.
    if (!options.dryRun) for (const customer of releases) {
      if (!customer.external_office_id) continue;
      await supabaseRequest(`/rest/v1/customers?id=eq.${encodeURIComponent(customer.id)}`, { method: "PATCH", body: { external_office_id: customer.external_office_id } }).catch(() => null);
    }
    throw error;
  }

  const sourceEmails = new Set([...sheet.byEmail.keys(), ...sheet.duplicateEmails]);
  const systemOnlyEmails = [...systemByEmail.keys()].filter(email => !sourceEmails.has(email)).sort();
  const systemCustomersWithoutEmail = customers.filter(row => !normalizedEmail(row.email)).map(row => row.office_name).sort();
  const result: ClientSheetSyncResult = {
    sourceRows: sourceRows.length + sheet.duplicateEmails.length,
    created,
    updated,
    unchanged,
    skippedWithoutSignedAt: [...new Set(skippedWithoutSignedAt)].sort(),
    ignoredWithoutEmail: sheet.ignoredWithoutEmail,
    duplicateSheetEmails: sheet.duplicateEmails,
    duplicateSystemEmails,
    duplicateOfficeIds,
    officeIdConflicts: officeIdConflicts.sort(),
    systemOnlyEmails,
    systemCustomersWithoutEmail,
  };
  if (!options.dryRun) await supabaseRequest("/rest/v1/audit_events", { method: "POST", body: { entity_type: "client_sheet_sync", entity_id: tenant.id, action: "COMPLETED", after_json: result } });
  return result;
}
