"use client";
import { useEffect, useState } from "react";
import { collectionToday } from "@/lib/collection-policy";
import { buildCollectionKanban, collectionLanes } from "@/lib/collection-kanban";
import type { ReportRow } from "@/lib/collection-report-types";
import { money } from "@/lib/metrics";
export function CollectionKanban({onCustomerClick}:{onCustomerClick:(customerId:string)=>void}) {
  const [rows,setRows]=useState<ReportRow[]>([]);
  const [busy,setBusy]=useState(true),[error,setError]=useState(""),[sourceUpdatedAt,setSourceUpdatedAt]=useState<string|null>(null);
  useEffect(()=>{
    let alive=true;
    fetch("/api/collections/kanban",{signal:AbortSignal.timeout(30000)}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);if(alive){setRows(data.rows??[]);setSourceUpdatedAt(data.sourceUpdatedAt??null);setError("");}}).catch(reason=>{if(alive){setRows([]);setSourceUpdatedAt(null);setError(reason instanceof Error?reason.message:"Não foi possível carregar o Kanban.");}}).finally(()=>{if(alive)setBusy(false);});
    return()=>{alive=false;};
  },[]);
  const clients=buildCollectionKanban(rows,collectionToday());
  return <section className="space-y-4"><div><h2 className="text-lg font-semibold">Kanban de cobrança</h2><p className="text-sm text-muted-foreground">Todos os clientes com pagamento atrasado, independentemente do mês de vencimento. Cada cliente aparece na faixa do seu maior atraso atual.</p></div><p className="text-xs text-muted-foreground">{busy?"Carregando cobranças atrasadas…":`${clients.length} cliente(s) · ${rows.length} cobrança(s) vencida(s)`}{!busy&&sourceUpdatedAt&&` · Base atualizada em ${new Date(sourceUpdatedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}`}</p>{!busy&&error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex gap-4 overflow-x-auto pb-4">{collectionLanes.map((lane,index)=>{const cards=clients.filter(c=>c.lane===index);return <div key={lane} className="w-64 shrink-0 rounded-xl border bg-muted/30 p-3"><h3 className="mb-3 flex justify-between text-sm font-semibold">{lane}<span>{cards.length}</span></h3><div className="space-y-3">{cards.map(card=><article key={card.id} className="rounded-lg border bg-card p-3 shadow-sm"><button type="button" disabled={!card.internalCustomerId} className="w-full text-left disabled:cursor-not-allowed" onClick={()=>{if(card.internalCustomerId)onCustomerClick(card.internalCustomerId);}}><p className="text-sm font-medium underline-offset-4 hover:underline">{card.name}</p><p className="mt-2 text-sm">{money.format(card.openValue)} em aberto</p><p className="text-xs text-muted-foreground">{card.payments.length} cobrança(s) atrasada(s)</p>{!card.internalCustomerId&&<p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Cliente não vinculado à base interna</p>}</button><details className="mt-2 text-xs"><summary className="cursor-pointer">Ver cobranças</summary>{card.payments.map(({snapshot:p})=><p key={p.payment_id} className="mt-2">{p.due_date?.split("-").reverse().join("/")} · {money.format(p.value)} · {p.status}<br/>{p.stage??"Sem mensagem prevista hoje"}</p>)}</details></article>)}</div></div>})}</div>{!busy&&!clients.length&&<p className="text-sm text-muted-foreground">Nenhum cliente com pagamento atrasado.</p>}
    </section>;
}
