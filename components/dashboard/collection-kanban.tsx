"use client";
import { useState } from "react";
import { collectionToday } from "@/lib/collection-policy";
import { buildCollectionKanban, collectionLanes } from "@/lib/collection-kanban";
import type { ReportRow } from "@/lib/collection-report-types";
import { money } from "@/lib/metrics";
import { Input } from "@/components/ui/input";
export function CollectionKanban({rows}:{rows:ReportRow[]}) {
  const [month,setMonth]=useState(collectionToday().slice(0,7));
  const clients=buildCollectionKanban(rows,month,collectionToday());
  return <section className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Kanban de cobrança</h2><p className="text-sm text-muted-foreground">Clientes agrupados pelo maior atraso entre as cobranças do relatório selecionado. O mês considera o vencimento; os dias de atraso são calculados para hoje.</p></div><label className="text-sm">Mês de vencimento<Input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label></div><p className="text-xs text-muted-foreground">Para incluir clientes em dia e pagamentos recebidos, selecione um relatório de Todas as cobranças. As colunas refletem vencimento e pagamento; alterações de régua são feitas em Configurar régua.</p>
    <div className="flex gap-4 overflow-x-auto pb-4">{collectionLanes.map((lane,index)=>{const cards=clients.filter(c=>c.lane===index);return <div key={lane} className="w-64 shrink-0 rounded-xl border bg-muted/30 p-3"><h3 className="mb-3 flex justify-between text-sm font-semibold">{lane}<span>{cards.length}</span></h3><div className="space-y-3">{cards.map(card=><article key={card.id} className="rounded-lg border bg-card p-3 shadow-sm"><p className="text-sm font-medium">{card.name}</p><p className="mt-2 text-sm">{money.format(card.openValue)} em aberto</p><p className="text-xs text-muted-foreground">{card.payments.length} cobrança(s) no mês</p><details className="mt-2 text-xs"><summary className="cursor-pointer">Ver cobranças</summary>{card.payments.map(({snapshot:p})=><p key={p.payment_id} className="mt-2">{p.due_date?.split("-").reverse().join("/")} · {money.format(p.value)} · {p.status}<br/>{p.stage??"Sem mensagem prevista na consulta"}</p>)}</details></article>)}</div></div>})}</div>{!clients.length&&<p className="text-sm text-muted-foreground">Nenhum cliente nesse mês nos dados do relatório selecionado.</p>}
  </section>;
}
