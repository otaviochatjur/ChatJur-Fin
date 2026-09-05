import { supabaseRequest } from "./supabase-server";

export const CLIENT_SHEET_ID = "1rJaoFgtfLMCezYg77Z9Y0FFdL6ACWL47BJjdHI3VbJc";
export const CLIENT_SHEET_TAB = "⭐ Base de Clientes";
type Existing = { id: string; external_office_id: string | null; office_name: string; email: string | null };
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
export function parseClientRows(values: unknown[][]) {
  const headers = values[0]?.map(normalize) ?? [];
  for (const name of ["office_id", "nome do escritório", "email", "status"]) if (!headers.includes(name)) throw new Error(`Coluna obrigatória ausente: ${name}`);
  const rows: { row: number; customer: { external_office_id: string; office_name: string; email: string | null; responsible_name: string | null; phone: string | null; status: string; source_channel: string; signed_at: string | null; city: string | null; state: string | null } }[] = [];
  const issues: { row: number; reason: string }[] = [];
  const ids = new Set<string>();
  values.slice(1).forEach((cells, index) => {
    const get = (name: string) => String(cells[headers.indexOf(name)] ?? "").trim();
    const name = get("nome do escritório");
    if (!name) return;
    const id = get("office_id");
    const status = ({ ativo: "ACTIVE", cancelado: "CANCELLED", congelada: "FROZEN", congelado: "FROZEN" } as Record<string, string>)[normalize(get("status"))];
    if (!id || !status || ids.has(id)) { issues.push({ row: index + 2, reason: !id ? "Preencha office_id" : !status ? "Status inválido" : "office_id repetido na planilha" }); return; }
    ids.add(id);
    rows.push({ row: index + 2, customer: { external_office_id: id, office_name: name, email: get("email").toLowerCase() || null, responsible_name: get("nome do responsável") || null, phone: get("whatsapp responsável") || null, status, source_channel: "GOOGLE_SHEETS", signed_at: parseSheetDate(get("assinado em")), city: get("cidade") || null, state: get("estado") || null } });
  });
  // A duplicated identifier is ambiguous for both rows, not just the second.
  const duplicateIds = new Set(values.slice(1).map(r => String(r[headers.indexOf("office_id")] ?? "").trim()).filter((id, i, all) => id && all.indexOf(id) !== i));
  return { rows: rows.filter(r => !duplicateIds.has(r.customer.external_office_id)), issues };
}

export async function importSheetClients(values: unknown[][], dryRun = false) {
  const parsed = parseClientRows(values);
  const existing: Existing[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await supabaseRequest<Existing[]>(`/rest/v1/customers?select=id,external_office_id,office_name,email&order=id&limit=500&offset=${offset}`);
    existing.push(...page);
    if (page.length < 500) break;
  }
  let created = 0, preserved = 0;
  for (const { row, customer } of parsed.rows) {
    if (existing.some(e => e.external_office_id === customer.external_office_id)) { preserved++; continue; }
    const candidates = existing.filter(e => (customer.email && normalize(e.email) === customer.email) || normalize(e.office_name) === normalize(customer.office_name));
    if (candidates.length) { parsed.issues.push({ row, reason: "Cadastro semelhante já existe com outro identificador; conferir antes de importar" }); continue; }
    if (!dryRun) {
      const inserted = await supabaseRequest<Existing[]>("/rest/v1/customers?on_conflict=external_office_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: customer });
      if (!inserted.length) { preserved++; continue; }
      existing.push(inserted[0]);
    } else existing.push({ ...customer, id: "preview" });
    created++;
  }
  return { created, preserved, issues: parsed.issues, dryRun };
}

function parseSheetDate(value: string) {
  const parts = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!parts) return null;
  const date = `${parts[3]}-${parts[2]}-${parts[1]}`;
  return !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
}
