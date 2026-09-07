import { dayDistance } from "./collection-policy";
import type { ReportRow } from "./collection-report-types";
export const collectionLanes = ["Em dia","1 dia","2 dias","3 dias","4 a 5 dias","6 a 10 dias","11 a 20 dias","21 a 30 dias","Mais de 30 dias","Revisar vencimento"];
export function buildCollectionKanban(rows: ReportRow[], month: string, today: string) {
  const clients = new Map<string,{id:string;name:string;payments:ReportRow[];openValue:number;days:number;invalid:boolean}>();
  for(const row of rows) {
    const s=row.snapshot;
    if(month && !s.due_date?.startsWith(month))continue;
    if(["CANCELLED","REFUNDED","REFUND_REQUESTED","CHARGEBACK_REQUESTED","CHARGEBACK_DISPUTE"].includes(s.status))continue;
    const client=clients.get(s.customer_id)??{id:s.customer_id,name:s.name,payments:[],openValue:0,days:0,invalid:false};
    client.payments.push(row);
    if(["PENDING","OVERDUE"].includes(s.status)){
      client.openValue+=Number(s.value);const days=s.due_date?dayDistance(today,s.due_date):NaN;
      if(!Number.isFinite(days))client.invalid=true;else client.days=Math.max(client.days,days);
    }
    clients.set(s.customer_id,client);
  }
  return [...clients.values()].map(c=>({...c,lane:c.invalid?9:c.days<=0?0:c.days===1?1:c.days===2?2:c.days===3?3:c.days<=5?4:c.days<=10?5:c.days<=20?6:c.days<=30?7:8}));
}
