// Explicit operator utility; imports a reviewed JSON extraction, never sends messages.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const env = parseEnv(readFileSync(".env","utf8"));
const records = JSON.parse(readFileSync(process.argv[2],"utf8"));
async function db(path, options = {}) {
  const r = await fetch(env.SUPABASE_URL+path,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates,return=representation"}});
  if(!r.ok) throw new Error(`Database returned ${r.status}`);
  const text = await r.text();return text?JSON.parse(text):null;
}
const tenants = await db("/rest/v1/nexo_tenants?reserved_email=eq.otavio%40chatjuridico.com.br&select=id,owner_user_id");
assert.equal(tenants.length,1);assert.ok(tenants[0].owner_user_id);
const tenantId=tenants[0].id;
const rows=records.map(record=>{
  assert.match(record.executedAt,/^2026-09-\d\dT/);
  const hash=createHash("sha256").update(`${tenantId}:${record.source.file}:${record.source.sheet}:${record.source.row}`).digest("hex").slice(0,32);
  const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
  return {id,tenant_id:tenantId,entity_type:"collection_send",entity_id:`legacy:${id}`,action:record.status==="Enviado"?"SENT":"SKIPPED",created_at:record.executedAt,after_json:{imported:true,source:record.source,original_status:record.status,original_customer_status:record.customerStatus,date:record.executedAt.slice(0,10),stage:record.template,days:record.days,text:"",parameters:{},language:"pt_BR",blocked:record.status==="Enviado"?null:record.status,contact:{id:"",name:record.name,phone:record.phone,is_active:record.customerStatus==="Ativo",instance_id:null},payment:{id:`legacy:${id}`,contact_id:null,contact_name:record.name,chat_id:null,due_date:record.dueDate,value:record.value,status:"UNKNOWN_AT_IMPORT",invoice_url:null},email:record.email}};
});
let inserted=0;
for(let i=0;i<rows.length;i+=100)inserted+=(await db("/rest/v1/audit_events?on_conflict=id",{method:"POST",body:JSON.stringify(rows.slice(i,i+100))})).length;
const saved=await db("/rest/v1/audit_events?entity_type=eq.collection_send&after_json->source->>file=eq.Cobran%C3%A7a_2026_09.xlsx&select=id,action,tenant_id");
assert.equal(saved.filter(r=>r.tenant_id===tenantId).length,rows.length);
console.log(JSON.stringify({inserted,total:saved.length,sent:saved.filter(r=>r.action==="SENT").length,skipped:saved.filter(r=>r.action==="SKIPPED").length}));
