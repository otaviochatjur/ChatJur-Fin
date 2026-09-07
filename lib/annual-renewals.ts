import { isPaidStatus } from "./metrics";
import { dayDistance } from "./collection-policy";
export type RenewalSubscription = { id:string;customer_id:string;billing_period:string;status:string|null;value:number;asaas_installment_id?:string|null;installments?:number|null;payment_links?:{plans?:{id:string;name:string}|null;actor_custom_plans?:{id:string;name:string}|null;commercial_actors?:{name:string}|null}|null };
export type RenewalPayment = { id:string;subscription_id:string|null;asaas_payment_id:string;status:string;payment_date:string|null;confirmed_date:string|null;cycle_installment?:string|null;cycle_subscription?:string|null };
export type AnnualRenewal = { id:string;customerId:string;plan:string;actor:string|null;startedAt:string|null;renewsAt:string|null;daysLeft:number|null;value:number;needsReview:boolean };
export function annualAnniversary(start:string) {
  const [year,month,day]=start.split("-").map(Number);
  const lastDay=new Date(Date.UTC(year+1,month,0)).getUTCDate();
  return `${year+1}-${String(month).padStart(2,"0")}-${String(Math.min(day,lastDay)).padStart(2,"0")}`;
}
export function calculateAnnualRenewals(subscriptions:RenewalSubscription[],payments:RenewalPayment[],today:string):AnnualRenewal[] {
  const bySubscription=new Map(subscriptions.filter(s=>s.billing_period==="ANNUAL").map(s=>[s.id,s]));
  const groups=new Map<string,{subscriptions:RenewalSubscription[];cycles:Map<string,{start:string;subscription:RenewalSubscription;uncertain:boolean}>}>();
  for(const s of bySubscription.values()) {
    const relation=s.payment_links;const plan=relation?.plans??relation?.actor_custom_plans;
    if(!plan)continue;
    const key=`${s.customer_id}:${relation?.plans?'plan':'custom'}:${plan.id}`;
    const group=groups.get(key)??{subscriptions:[] as RenewalSubscription[],cycles:new Map<string,{start:string;subscription:RenewalSubscription;uncertain:boolean}>()};group.subscriptions.push(s);groups.set(key,group);
  }
  for(const p of payments) {
    if(!isPaidStatus(p.status))continue;
    const s=bySubscription.get(p.subscription_id??"");if(!s)continue;
    const plan=s.payment_links?.plans??s.payment_links?.actor_custom_plans;if(!plan)continue;
    const date=(p.payment_date??p.confirmed_date)?.slice(0,10);
    if(!date||!Number.isFinite(dayDistance(today,date))||date>today)continue;
    const key=`${s.customer_id}:${s.payment_links?.plans?'plan':'custom'}:${plan.id}`;
    // Installments belong to one annual contract. A recurring annual invoice without
    // installments is itself a new paid annual period. Missing cycle metadata never
    // makes every historical installment into a renewal.
    const installment=p.cycle_installment??s.asaas_installment_id;
    const recurring=p.cycle_subscription && !(Number(s.installments)>1);
    const cycle=installment?`installment:${installment}`:recurring?`annual-payment:${p.asaas_payment_id}`:`local:${s.id}`;
    const group=groups.get(key)!;const previous=group.cycles.get(cycle);
    if(!previous||date<previous.start)group.cycles.set(cycle,{start:date,subscription:s,uncertain:!installment&&!recurring});
  }
  return [...groups].flatMap(([id,group])=>{
    const active=group.subscriptions.filter(s=>s.status!=="CANCELLED"&&s.status!=="FROZEN");if(!active.length)return [];
    const latest=[...group.cycles.values()].sort((a,b)=>b.start.localeCompare(a.start))[0];
    const s=latest?.subscription??active[0],plan=s.payment_links?.plans??s.payment_links?.actor_custom_plans;
    const renewsAt=latest?annualAnniversary(latest.start):null;
    return [{id,customerId:s.customer_id,plan:plan!.name,actor:s.payment_links?.commercial_actors?.name??null,startedAt:latest?.start??null,renewsAt,daysLeft:renewsAt?dayDistance(renewsAt,today):null,value:s.value,needsReview:!latest||latest.uncertain}];
  }).sort((a,b)=>(a.renewsAt??"9999").localeCompare(b.renewsAt??"9999"));
}
