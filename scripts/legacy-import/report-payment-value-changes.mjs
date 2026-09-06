import fs from "node:fs";

const envText = fs.readFileSync(new URL("../../.env", import.meta.url), "utf8");
function readEnv(name) {
  const line = envText.split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) return null;
  let value = line.slice(name.length + 1).trim();
  // Mirror dotenv-expand's escape handling for a literal leading '$'.
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

function round2(n) {
  return Math.round(n * 100) / 100;
}

const results = [];
for (const sub of subscriptions) {
  const customer = customerById.get(sub.customer_id);
  if (!customer) continue;
  const subPayments = (paymentsBySub.get(sub.id) ?? []).slice().sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  if (subPayments.length === 0) continue;

  const changes = [];
  let last = null;
  for (const p of subPayments) {
    const v = round2(Number(p.value));
    if (last !== null && v !== last) {
      changes.push({ date: p.due_date, from: last, to: v, status: p.status });
    }
    last = v;
  }

  results.push({
    customerId: customer.id,
    officeName: customer.office_name,
    responsibleName: customer.responsible_name,
    email: customer.email,
    customerStatus: customer.status,
    subscriptionId: sub.id,
    billingPeriod: sub.billing_period,
    planName: sub.plan_name_raw,
    subscriptionStatus: sub.status,
    source: sub.source,
    hasLink: Boolean(sub.payment_link_id),
    paymentCount: subPayments.length,
    firstValue: round2(Number(subPayments[0].value)),
    lastValue: round2(Number(subPayments[subPayments.length - 1].value)),
    firstDate: subPayments[0].due_date,
    lastDate: subPayments[subPayments.length - 1].due_date,
    changed: changes.length > 0,
    changes,
  });
}

const monthlyNeverChanged = results.filter((r) => r.billingPeriod === "MONTHLY" && !r.changed && r.paymentCount >= 2);
const monthlyChanged = results.filter((r) => r.billingPeriod === "MONTHLY" && r.changed);
const monthlySingle = results.filter((r) => r.billingPeriod === "MONTHLY" && r.paymentCount === 1);
const annualNeverChanged = results.filter((r) => r.billingPeriod === "ANNUAL" && !r.changed && r.paymentCount >= 2);
const annualChanged = results.filter((r) => r.billingPeriod === "ANNUAL" && r.changed);
const annualSingle = results.filter((r) => r.billingPeriod === "ANNUAL" && r.paymentCount === 1);

console.error(JSON.stringify({
  total: results.length,
  monthlyNeverChanged: monthlyNeverChanged.length,
  monthlyChanged: monthlyChanged.length,
  monthlySingle: monthlySingle.length,
  annualNeverChanged: annualNeverChanged.length,
  annualChanged: annualChanged.length,
  annualSingle: annualSingle.length,
  totalChangeEvents: results.reduce((sum, r) => sum + r.changes.length, 0),
}, null, 2));

fs.writeFileSync(new URL("./_tmp-value-changes-output.json", import.meta.url), JSON.stringify(results));
console.error("wrote _tmp-value-changes-output.json");
