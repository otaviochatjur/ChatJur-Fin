import { dayDistance } from "./collection-policy";
import type { ReportRow } from "./collection-report-types";
export const collectionLanes = ["1 dia","2 dias","3 dias","4 a 5 dias","6 a 10 dias","11 a 20 dias","21 a 30 dias","Mais de 30 dias","Revisar vencimento"];
export function buildCollectionKanban(rows: ReportRow[], today: string) {
  const clients = new Map<string,{id:string;internalCustomerId:string|null;name:string;payments:ReportRow[];openValue:number;days:number;invalid:boolean}>();
  for(const row of rows) {
    const s=row.snapshot;
    if(s.status!=="OVERDUE")continue;
    const customerKey=row.internal_customer_id??s.customer_id;
    const client=clients.get(customerKey)??{id:customerKey,internalCustomerId:row.internal_customer_id??null,name:s.name,payments:[],openValue:0,days:0,invalid:false};
    if(!client.internalCustomerId&&row.internal_customer_id)client.internalCustomerId=row.internal_customer_id;
    client.payments.push(row);
    if(["PENDING","OVERDUE"].includes(s.status)){
      client.openValue+=Number(s.value);const days=s.due_date?dayDistance(today,s.due_date):NaN;
      if(!Number.isFinite(days))client.invalid=true;else client.days=Math.max(client.days,days);
    }
    clients.set(customerKey,client);
  }
  return [...clients.values()].map(c=>({...c,lane:c.invalid?8:c.days<=1?0:c.days===2?1:c.days===3?2:c.days<=5?3:c.days<=10?4:c.days<=20?5:c.days<=30?6:7}));
}
