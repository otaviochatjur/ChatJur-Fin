"use client";
import { useEffect,useState } from "react";
import { Table,TableBody,TableCell,TableHeader,TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableTh,useTableSort,useColumnWidths } from "./table-toolbar";
import type { AnnualRenewal } from "@/lib/annual-renewals";
import { money } from "@/lib/metrics";
type Row=AnnualRenewal&{customerName:string};
const fmt=(date:string|null)=>date?date.split("-").reverse().join("/"):"—";
export function RenewalsSection() {
 const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(true),[filter,setFilter]=useState("30"),[search,setSearch]=useState("");
 const sort=useTableSort(),widths=useColumnWidths();
 async function load(){try{const r=await fetch("/api/renewals",{signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok)throw new Error(data.error);setRows(data.renewals);setError("");}catch(e){setError(e instanceof Error?e.message:"Falha ao consultar.");}finally{setBusy(false);}}
 // eslint-disable-next-line react-hooks/set-state-in-effect -- load updates state only after its awaited request.
 useEffect(()=>{void load();},[]);
 const visible=rows.filter(row=>(filter==="all"||(filter==="review"?row.needsReview:row.daysLeft!==null&&row.daysLeft<=Number(filter)))&&[row.customerName,row.plan].some(s=>s.toLowerCase().includes(search.toLowerCase())));
 return <section className="overflow-hidden rounded-2xl border bg-card"><div className="space-y-2 p-5"><h2 className="font-semibold">Renovações de clientes anuais</h2><p className="text-sm text-muted-foreground">Um ano a partir da primeira parcela paga de cada contrato. Uma renovação antecipada inicia a nova vigência no primeiro pagamento do novo ciclo.</p><p className="text-xs text-muted-foreground">Parcelas seguintes do mesmo parcelamento não prorrogam o contrato. Registros sem identificação do ciclo ou sem pagamento confirmado são sinalizados para revisão.</p></div><div className="flex flex-wrap gap-2 px-5 pb-5"><Input className="max-w-sm" placeholder="Buscar cliente ou plano" value={search} onChange={e=>setSearch(e.target.value)}/>{[["30","Até 30 dias"],["60","Até 60 dias"],["90","Até 90 dias"],["all","Todos"],["review","Revisar dados"]].map(([value,label])=><Button key={value} variant={filter===value?"default":"outline"} onClick={()=>setFilter(value)}>{label}</Button>)}</div>{busy&&<p role="status" className="p-5 text-sm">Consultando pagamentos dos contratos…</p>}{error&&<div role="alert" className="p-5 text-sm text-destructive">{error}<Button variant="ghost" onClick={()=>void load()}>Tentar novamente</Button></div>}
 <Table className="table-fixed"><TableHeader><TableRow>{[["client","Cliente",220],["plan","Plano",240],["start","Início da vigência",160],["renewal","Renovação",160],["status","Situação",200],["value","Valor anual",140]].map(([key,label,width])=><ResizableTh key={key} {...sort.header(String(key))} width={widths.getWidth(String(key),Number(width))} onResizeStart={widths.startResize(String(key),Number(width))}>{label}</ResizableTh>)}</TableRow></TableHeader><TableBody>{sort.rows(visible,row=>({client:row.customerName,plan:row.plan,start:row.startedAt,renewal:row.renewsAt,status:row.daysLeft,value:row.value})).map(row=><TableRow key={row.id}><TableCell className="font-medium">{row.customerName}</TableCell><TableCell>{row.plan}{row.actor&&<p className="text-xs text-muted-foreground">{row.actor}</p>}</TableCell><TableCell>{fmt(row.startedAt)}</TableCell><TableCell>{fmt(row.renewsAt)}</TableCell><TableCell>{row.daysLeft===null?"Sem pagamento confirmado":row.daysLeft<0?`Vencido há ${-row.daysLeft} dias`:row.daysLeft===0?"Renova hoje":`Em ${row.daysLeft} dias`}{row.needsReview&&<p className="text-xs text-amber-700 dark:text-amber-300">Conferir identificação do ciclo</p>}</TableCell><TableCell>{money.format(row.value)}</TableCell></TableRow>)}{!busy&&!visible.length&&<TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Nenhum cliente anual neste filtro.</TableCell></TableRow>}</TableBody></Table>
 </section>;
}
