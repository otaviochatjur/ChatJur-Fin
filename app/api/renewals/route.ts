import { supabaseRequest } from "@/lib/supabase-server";
import { calculateAnnualRenewals,type RenewalSubscription,type RenewalPayment } from "@/lib/annual-renewals";
import { collectionToday } from "@/lib/collection-policy";
async function all<T>(path:string) {
  const rows:T[]=[];
  for(let offset=0;;offset+=500){const page=await supabaseRequest<T[]>(`${path}&limit=500&offset=${offset}`);rows.push(...page);if(page.length<500)return rows;}
}
export async function GET() {
  try {
    const [subscriptions,payments,customers]=await Promise.all([
      all<RenewalSubscription>("/rest/v1/subscriptions?select=id,customer_id,billing_period,status,value,asaas_installment_id,installments,payment_links(plans(id,name),actor_custom_plans(id,name),commercial_actors(name))&billing_period=eq.ANNUAL&order=id.asc"),
      all<RenewalPayment>("/rest/v1/payments?select=id,subscription_id,asaas_payment_id,status,payment_date,confirmed_date,cycle_installment:raw_payload->>installment,cycle_subscription:raw_payload->>subscription&status=in.(RECEIVED,CONFIRMED,RECEIVED_IN_CASH)&order=id.asc"),
      all<{id:string;office_name:string}>("/rest/v1/customers?select=id,office_name&order=id.asc"),
    ]);
    const names=new Map(customers.map(c=>[c.id,c.office_name]));
    return Response.json({renewals:calculateAnnualRenewals(subscriptions,payments,collectionToday()).map(row=>({...row,customerName:names.get(row.customerId)??"Cliente não identificado"}))},{headers:{"Cache-Control":"no-store"}});
  } catch(e){return Response.json({error:e instanceof Error?e.message:"Não foi possível consultar as renovações."},{status:400});}
}
