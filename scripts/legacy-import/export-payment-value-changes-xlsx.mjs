import fs from "node:fs";
import XLSX from "xlsx";

const envText = fs.readFileSync(new URL("../../.env", import.meta.url), "utf8");
function readEnv(name) {
  const line = envText.split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) return null;
  let value = line.slice(name.length + 1).trim();
  if (value.startsWith("\\$")) value = value.slice(1);
  return value;
}

const SUPABASE_URL = readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? readEnv("SUPABASE_URL");
const SERVICE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function fetchAll(path) {
  const rows = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}${path}&limit=${limit}&offset=${offset}`, { headers });
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return rows;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

console.error("Buscando dados do Supabase...");
const customers = await fetchAll("/rest/v1/customers?select=id,office_name,responsible_name,email,status,external_office_id");
const subscriptions = await fetchAll("/rest/v1/subscriptions?select=id,customer_id,billing_period,value,status,plan_name_raw,started_at,source,payment_link_id");
const payments = await fetchAll("/rest/v1/payments?select=subscription_id,customer_id,value,due_date,payment_date,status&order=due_date.asc");
console.error(`customers=${customers.length} subscriptions=${subscriptions.length} payments=${payments.length}`);

const customerById = new Map(customers.map((c) => [c.id, c]));
const paymentsBySub = new Map();
for (const p of payments) {
  if (!p.subscription_id) continue;
  const arr = paymentsBySub.get(p.subscription_id) ?? [];
  arr.push(p);
  paymentsBySub.set(p.subscription_id, arr);
}

const THRESHOLD = 2;
const results = [];
for (const sub of subscriptions) {
  const customer = customerById.get(sub.customer_id);
  if (!customer) continue;
  const subPayments = (paymentsBySub.get(sub.id) ?? []).slice().sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  if (subPayments.length === 0) continue;

  const allChanges = [];
  let last = null;
  for (const p of subPayments) {
    const v = round2(Number(p.value));
    if (last !== null && v !== last) {
      allChanges.push({ date: p.due_date, from: last, to: v, status: p.status });
    }
    last = v;
  }
  const realChanges = allChanges.filter((c) => Math.abs(c.to - c.from) > THRESHOLD);

  const category = realChanges.length > 0 ? "changed" : subPayments.length >= 2 ? "never_changed" : "single_payment";

  results.push({
    officeName: customer.office_name || customer.responsible_name || "Sem nome",
    responsibleName: customer.responsible_name,
    email: customer.email,
    customerStatus: customer.status,
    billingPeriod: sub.billing_period,
    planName: sub.plan_name_raw,
    subscriptionStatus: sub.status,
    hasLink: Boolean(sub.payment_link_id),
    paymentCount: subPayments.length,
    firstValue: round2(Number(subPayments[0].value)),
    lastValue: round2(Number(subPayments[subPayments.length - 1].value)),
    firstDate: subPayments[0].due_date,
    lastDate: subPayments[subPayments.length - 1].due_date,
    category,
    changesCount: realChanges.length,
    changes: realChanges,
  });
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function fmtMoney(n) {
  return Number(n ?? 0);
}
function periodLabel(p) {
  return p === "ANNUAL" ? "Anual" : "Mensal";
}
function categoryLabel(c) {
  if (c === "changed") return "Mudou de valor";
  if (c === "never_changed") return "Nunca mudou";
  return "Pagamento único";
}
function changesSummary(changes) {
  return changes.map((c) => `${fmtDate(c.date)}: R$ ${c.from.toFixed(2)} -> R$ ${c.to.toFixed(2)}`).join(" | ");
}

// --- Sheet: Resumo ---
const monthly = results.filter((r) => r.billingPeriod === "MONTHLY");
const annual = results.filter((r) => r.billingPeriod === "ANNUAL");
function counts(list) {
  return {
    total: list.length,
    changed: list.filter((r) => r.category === "changed").length,
    neverChanged: list.filter((r) => r.category === "never_changed").length,
    single: list.filter((r) => r.category === "single_payment").length,
  };
}
const mCounts = counts(monthly);
const aCounts = counts(annual);
const attention = results.filter((r) => r.changesCount >= 3).sort((a, b) => b.changesCount - a.changesCount);

const resumoRows = [
  ["Relatório de mudanças de valor nas assinaturas", ""],
  ["Gerado em", new Date().toLocaleString("pt-BR")],
  ["Critério de mudança real", "diferença acima de R$ 2,00 entre pagamentos consecutivos (abaixo disso é arredondamento de parcelamento do Asaas)"],
  [""],
  ["Total de assinaturas com pagamento", results.length],
  ["Total de clientes", new Set(results.map((r) => r.email || r.officeName)).size],
  [""],
  ["Mensais", ""],
  ["  Total", mCounts.total],
  ["  Nunca mudaram de valor", mCounts.neverChanged],
  ["  Já mudaram de valor", mCounts.changed],
  ["  Pagamento único até agora", mCounts.single],
  [""],
  ["Anuais", ""],
  ["  Total", aCounts.total],
  ["  Nunca mudaram de valor", aCounts.neverChanged],
  ["  Já mudaram de valor", aCounts.changed],
  ["  Pagamento único até agora", aCounts.single],
  [""],
  ["Casos com 3+ mudanças (merecem revisão manual)", attention.length],
];

// --- Sheet: Todos os clientes ---
const allHeader = ["Cliente", "E-mail", "Status do cliente", "Periodicidade", "Plano", "Status da assinatura", "Qtd. pagamentos", "1º valor pago (R$)", "Valor atual (R$)", "1º vencimento", "Último vencimento", "Classificação", "Qtd. mudanças reais", "Detalhe das mudanças"];
const allRows = results
  .slice()
  .sort((a, b) => a.officeName.localeCompare(b.officeName))
  .map((r) => [
    r.officeName,
    r.email,
    r.customerStatus,
    periodLabel(r.billingPeriod),
    r.planName,
    r.subscriptionStatus,
    r.paymentCount,
    fmtMoney(r.firstValue),
    fmtMoney(r.lastValue),
    fmtDate(r.firstDate),
    fmtDate(r.lastDate),
    categoryLabel(r.category),
    r.changesCount,
    changesSummary(r.changes),
  ]);

// --- Sheet: Mudanças reais ---
const changedHeader = ["Cliente", "E-mail", "Periodicidade", "Plano", "Qtd. pagamentos", "1º valor (R$)", "Valor atual (R$)", "Qtd. mudanças", "Detalhe das mudanças"];
const changedRows = results
  .filter((r) => r.category === "changed")
  .sort((a, b) => a.officeName.localeCompare(b.officeName))
  .map((r) => [r.officeName, r.email, periodLabel(r.billingPeriod), r.planName, r.paymentCount, fmtMoney(r.firstValue), fmtMoney(r.lastValue), r.changesCount, changesSummary(r.changes)]);

// --- Sheet: Casos de atenção ---
const attentionHeader = ["Cliente", "E-mail", "Periodicidade", "Plano", "Qtd. mudanças", "Detalhe das mudanças"];
const attentionRows = attention.map((r) => [r.officeName, r.email, periodLabel(r.billingPeriod), r.planName, r.changesCount, changesSummary(r.changes)]);

// --- Sheet: Nunca mudaram ---
const neverHeader = ["Cliente", "E-mail", "Periodicidade", "Plano", "Qtd. pagamentos", "Valor (R$)", "1º vencimento", "Último vencimento"];
const neverRows = results
  .filter((r) => r.category === "never_changed")
  .sort((a, b) => a.officeName.localeCompare(b.officeName))
  .map((r) => [r.officeName, r.email, periodLabel(r.billingPeriod), r.planName, r.paymentCount, fmtMoney(r.lastValue), fmtDate(r.firstDate), fmtDate(r.lastDate)]);

// --- Sheet: Pagamento único ---
const singleHeader = ["Cliente", "E-mail", "Periodicidade", "Plano", "Valor (R$)", "Vencimento"];
const singleRows = results
  .filter((r) => r.category === "single_payment")
  .sort((a, b) => a.officeName.localeCompare(b.officeName))
  .map((r) => [r.officeName, r.email, periodLabel(r.billingPeriod), r.planName, fmtMoney(r.lastValue), fmtDate(r.firstDate)]);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumoRows), "Resumo");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([allHeader, ...allRows]), "Todos os clientes");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([changedHeader, ...changedRows]), "Mudanças reais");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([attentionHeader, ...attentionRows]), "Atenção (3+ mudanças)");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([neverHeader, ...neverRows]), "Nunca mudaram");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([singleHeader, ...singleRows]), "Pagamento único");

const outDir = process.env.USERPROFILE ? `${process.env.USERPROFILE}\\Downloads` : ".";
const outPath = `${outDir}\\Relatorio_Mudancas_de_Valor_ChatJuridico.xlsx`;
XLSX.writeFile(wb, outPath);
console.error("Planilha gerada em:", outPath);
console.error(JSON.stringify({ total: results.length, monthly: mCounts, annual: aCounts, attention: attention.length }, null, 2));
