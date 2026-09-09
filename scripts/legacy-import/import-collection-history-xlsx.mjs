import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import XLSX from "xlsx";

const [fileArg, reportId, flag] = process.argv.slice(2);
if (!fileArg || !/^[a-f0-9-]{36}$/i.test(reportId ?? "")) {
  throw new Error("Use: node import-collection-history-xlsx.mjs <arquivo.xlsx> <report-id> [--apply]");
}
const tenantId = "60c1aa5a-9503-4888-a6be-59026301e8ce";
const instanceId = "46a8a400-70a2-43fd-bfeb-1e286871711b";
const sourceFile = basename(fileArg);
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase não configurado.");

function normalized(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9@.]+/g, " ").trim();
}
function dateIso(value) {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}
function executionIso(value) {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Data de execução inválida: ${value}`);
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]) + 3, Number(match[5]))).toISOString();
}
function deterministicUuid(key) {
  const value = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  value[12] = "4"; value[16] = "8";
  const hex = value.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function db(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function dbAll(path) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await db(`${path}${separator}limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const workbook = XLSX.readFile(resolve(fileArg), { cellDates: false });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const [targetReport] = await db(`/rest/v1/collection_reports?tenant_id=eq.${tenantId}&id=eq.${reportId}&select=id,report_date,mode&limit=1`);
if (!targetReport || targetReport.mode !== "DAILY") throw new Error("O relatório informado precisa ser uma régua diária existente.");
const reportDate = targetReport.report_date;
const displayDate = reportDate.split("-").reverse().join("/");
const sourceRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }).slice(1)
  .map((cells, index) => ({ row: index + 2, cells }))
  .filter(({ cells }) => String(cells[0] ?? "").startsWith(displayDate) && normalized(cells[9]) === "enviado" && normalized(cells[2]) !== "davilessa2002@gmail.com");

const dailyReports = await db(`/rest/v1/collection_reports?tenant_id=eq.${tenantId}&mode=eq.DAILY&report_date=eq.${reportDate}&select=id&order=created_at.desc&limit=100`);
const reportIds = [reportId, ...dailyReports.map(report => report.id).filter(id => id !== reportId)];
const savedRows = await dbAll(`/rest/v1/collection_report_rows?tenant_id=eq.${tenantId}&report_id=in.(${reportIds.join(",")})&select=report_id,asaas_payment_id,snapshot`);
savedRows.sort((a, b) => Number(b.report_id === reportId) - Number(a.report_id === reportId));
const reportRows = [...new Map(savedRows.map(row => [row.asaas_payment_id, row])).values()];

// A confirmed legacy send may refer to a charge that changed status before
// the first system report was generated. Use the synchronized Asaas base as
// a final identity source, while keeping the spreadsheet as the send record.
const [baseState] = await db("/rest/v1/asaas_base_sync?select=active_generation&limit=1");
if (baseState?.active_generation) {
  const [baseCustomers, basePayments] = await Promise.all([
    dbAll(`/rest/v1/asaas_base_objects?tenant_id=eq.${tenantId}&generation=eq.${baseState.active_generation}&kind=eq.CUSTOMER&select=external_id,payload`),
    dbAll(`/rest/v1/asaas_base_objects?tenant_id=eq.${tenantId}&generation=eq.${baseState.active_generation}&kind=eq.PAYMENT&select=external_id,payload`),
  ]);
  const customerById = new Map(baseCustomers.map(row => [row.external_id, row.payload]));
  const knownPayments = new Set(reportRows.map(row => row.asaas_payment_id));
  for (const row of basePayments) {
    if (knownPayments.has(row.external_id)) continue;
    const payment = row.payload, customer = customerById.get(payment.customer) ?? {};
    reportRows.push({ fromBase: true, asaas_payment_id: row.external_id, snapshot: { customer_id: payment.customer, name: customer.name ?? "", email: customer.email ?? "", phone: customer.mobilePhone ?? customer.phone ?? "", due_date: payment.dueDate ?? null, value: Number(payment.value), stage: null, status: payment.status, invoice_url: payment.invoiceUrl ?? null } });
  }
}
const unused = new Set(reportRows.map((_, index) => index));
const imported = [], unmatched = [];
for (const source of sourceRows) {
  const [executedAt, name, email, phone, , template, dueDate, value, days] = source.cells;
  const due = dateIso(dueDate), amount = Number(value);
  const baseMatch = row => row.snapshot.due_date === due && Math.abs(Number(row.snapshot.value) - amount) < 0.005 && (row.fromBase || row.snapshot.stage === template);
  const choices = [...unused];
  let index = choices.find(index => baseMatch(reportRows[index]) && normalized(reportRows[index].snapshot.name) === normalized(name));
  if (index === undefined && email) index = choices.find(index => baseMatch(reportRows[index]) && normalized(reportRows[index].snapshot.email) === normalized(email));
  if (index === undefined) { unmatched.push({ row: source.row, name, email, due, amount, template }); continue; }
  unused.delete(index);
  const matched = reportRows[index], snapshot = matched.snapshot;
  const digits = String(phone ?? snapshot.phone ?? "").replace(/\D/g, "");
  const normalizedPhone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  imported.push({
    id: deterministicUuid(`${tenantId}:${sourceFile}:${source.row}`), tenant_id: tenantId,
    entity_type: "collection_send", entity_id: matched.asaas_payment_id, action: "SENT", created_at: executionIso(executedAt),
    after_json: {
      imported: true, original_status: "Enviado", source: { file: sourceFile, row: source.row }, report_id: reportId,
      date: reportDate, days: Number(days), stage: template, text: "", blocked: null, instance_id: instanceId, language: "pt_BR", parameters: {},
      contact: { id: snapshot.customer_id, name: name ?? snapshot.name, phone: normalizedPhone, status: "ACTIVE", is_active: true, instance_id: instanceId },
      payment: { id: matched.asaas_payment_id, asaas_payment_id: matched.asaas_payment_id, contact_id: snapshot.customer_id, contact_name: name ?? snapshot.name, chat_id: null, due_date: due, value: amount, status: snapshot.status, invoice_url: snapshot.invoice_url ?? null },
    },
  });
}

console.log(JSON.stringify({ sourceRows: sourceRows.length, matched: imported.length, unmatched }, null, 2));
if (unmatched.length) throw new Error("A importação foi interrompida porque há linhas sem correspondência no relatório.");
if (flag === "--apply" && imported.length) {
  await db("/rest/v1/audit_events?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(imported) });
  console.log(`Importados ${imported.length} envios confirmados.`);
}
