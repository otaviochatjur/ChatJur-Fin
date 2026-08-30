import { Activity, BadgeDollarSign, Handshake, Link2, Users } from "lucide-react";
import { money, roleLabels, type AuditEvent, type CommercialActor } from "@/lib/metrics";

const actionLabels: Record<string, string> = { CREATED: "criado(a)", UPDATED: "atualizado(a)" };
const entityLabels: Record<string, string> = {
  commercial_actor: "Cadastro comercial",
  actor_price_version: "Versão de preço",
  payment_link: "Link de pagamento",
  customer_attribution: "Atribuição de cliente",
};

export function OverviewSection({ actors, totals, auditEvents }: { actors: CommercialActor[]; totals: { activeLinks: number; mrr: number; clients: number }; auditEvents: AuditEvent[] }) {
  const byRole = { PARTNER: 0, AMBASSADOR: 0, EXTERNAL_SALES: 0 } as Record<CommercialActor["role"], number>;
  for (const actor of actors) byRole[actor.role] += 1;

  const cards = [
    { label: "MRR total", value: money.format(totals.mrr), note: "Somado sobre links ativos", Icon: BadgeDollarSign },
    { label: "Clientes atribuídos", value: String(totals.clients), note: "Distintos em customer_attributions", Icon: Users },
    { label: "Links ativos", value: String(totals.activeLinks), note: "Contratos abertos no Asaas", Icon: Link2 },
    { label: "Rede comercial", value: String(actors.length), note: `${byRole.PARTNER} parceiros · ${byRole.AMBASSADOR} embaixadores · ${byRole.EXTERNAL_SALES} comerciais`, Icon: Handshake },
  ];

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, note, Icon }) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{label}</span>
              <span className="grid size-9 place-items-center rounded-xl bg-[#edf8f2] text-[#167354]"><Icon className="size-4" /></span>
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </article>
        ))}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h2 className="font-semibold">Atividade recente</h2>
            <p className="mt-1 text-sm text-slate-500">Últimos eventos registrados na auditoria (Supabase)</p>
          </div>
          <Activity className="size-4 text-slate-400" />
        </div>
        <ul className="divide-y divide-slate-100">
          {auditEvents.length === 0 && <li className="p-5 text-sm text-slate-500">Nenhum evento registrado ainda.</li>}
          {auditEvents.map((event) => (
            <li key={event.id} className="flex items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium">{entityLabels[event.entity_type] ?? event.entity_type} {actionLabels[event.action] ?? event.action.toLowerCase()}</p>
                <p className="text-xs text-slate-500">{event.actor_email ?? "Sistema"}</p>
              </div>
              <span className="text-xs text-slate-400">{new Date(event.created_at).toLocaleString("pt-BR")}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
        <h2 className="font-semibold">Papéis mantidos separadamente</h2>
        <p className="mt-1 text-sm text-slate-500">Cada papel comercial acumula clientes e MRR de forma independente, mesmo quando um mesmo cliente tem parceiro e comercial externo atribuídos.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(Object.entries(byRole) as [CommercialActor["role"], number][]).map(([role, count]) => (
            <div key={role} className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-slate-500">{roleLabels[role]}</p>
              <p className="mt-1 text-xl font-semibold">{count}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
