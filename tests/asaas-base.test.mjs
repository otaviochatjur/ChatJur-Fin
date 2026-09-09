import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',root,configFile:false,cacheDir:'node_modules/.vite-tests/asaas-base',resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
after(()=>vite.close());
const {withWebhookTenant}=await vite.ssrLoadModule('/lib/tenant-server.ts');
const {advanceAsaasBaseSync,updateAsaasBasePayment}=await vite.ssrLoadModule('/lib/asaas-base.ts');
async function mocked(run){
  const original=globalThis.fetch,previous={...process.env};Object.assign(process.env,{SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',ASAAS_API_KEY:'test',ASAAS_BASE_URL:'https://api.asaas.com/v3'});
  try{await withWebhookTenant({id:'tenant-test',legacy:true},run);}
  finally{globalThis.fetch=original;for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ASAAS_API_KEY','ASAAS_BASE_URL']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
}
test('sync stages customers, payments and deleted links without switching the active generation early',()=>mocked(async()=>{
  let state={generation:'new',active_generation:'old',status:'RUNNING',phase:0,page_offset:0,processed:0};const kinds=[];
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input),table=url.pathname.split('/').at(-1);
    if(url.host==='api.asaas.com'){
      assert.equal(url.searchParams.get('limit'),'100');
      if(table==='paymentLinks')assert.equal(url.searchParams.get('includeDeleted'),'true');
      return Response.json({hasMore:false,data:[{id:table+'1'}]});
    }
    if(table==='nexo_integrations')return Response.json([]);
    if(table==='asaas_base_objects'){const rows=JSON.parse(options.body);assert.equal(rows[0].tenant_id,'tenant-test');assert.equal(rows[0].generation,'new');kinds.push(rows[0].kind);return Response.json([]);}
    if(table==='finish_asaas_base_sync'){assert.deepEqual(JSON.parse(options.body),{p_tenant:'tenant-test',p_generation:'new',p_offset:0});state={...state,active_generation:'new',status:'READY'};return Response.json(state);}
    assert.equal(table,'asaas_base_sync');if(options.method==='PATCH')state={...state,...JSON.parse(options.body)};return Response.json([state]);
  };
  assert.equal((await advanceAsaasBaseSync('new')).active_generation,'old');
  assert.equal((await advanceAsaasBaseSync('new')).active_generation,'old');
  assert.equal((await advanceAsaasBaseSync('new')).active_generation,'new');
  assert.deepEqual(kinds,['CUSTOMER','PAYMENT','LINK']);assert.equal(state.processed,3);
}));
test('a delayed webhook fetches current payment state and updates active and in-progress generations',()=>mocked(async()=>{
  const writes=[];
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input),table=url.pathname.split('/').at(-1);
    if(url.host==='api.asaas.com')return Response.json(url.pathname.includes('/payments/')?{id:'pay',customer:'cus',status:'RECEIVED'}:{id:'cus',name:'Client'});
    if(table==='nexo_integrations')return Response.json([]);
    if(table==='asaas_base_sync')return Response.json([{generation:'new',active_generation:'old',status:'RUNNING'}]);
    assert.equal(table,'asaas_base_objects');writes.push(...JSON.parse(options.body));return Response.json([]);
  };
  await updateAsaasBasePayment({id:'pay',customer:'cus',status:'OVERDUE',value:100});
  const payments=writes.filter(r=>r.kind==='PAYMENT');assert.deepEqual(payments.map(r=>r.generation),['old','new']);assert.ok(payments.every(r=>r.payload.status==='RECEIVED'));
}));
test('a saved base report uses only database reads and persists its pagination cursor',()=>mocked(async()=>{
  const {advanceBaseReport}=await vite.ssrLoadModule('/lib/asaas-base-report.ts');
  const {DEFAULT_COLLECTION_SETTINGS}=await vite.ssrLoadModule('/lib/collection-rules.ts');
  const report={id:'report',mode:'ALL',source_generation:'g',source_cursor:'pay0',page_offset:1,processed:1,row_count:1,rule_config:DEFAULT_COLLECTION_SETTINGS,report_date:'2026-09-08'};
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);assert.equal(url.host,'db.invalid');const table=url.pathname.split('/').at(-1);
    if(table==='asaas_base_payments'){assert.equal(url.searchParams.get('generation'),'eq.g');assert.equal(url.searchParams.get('external_id'),'gt.pay0');return Response.json([{external_id:'pay1',payload:{id:'pay1',customer:'c',status:'RECEIVED',value:100},customer_payload:{name:'Client'}}]);}
    if(table==='asaas_customer_exclusions')return Response.json([]);
    if(table==='collection_report_rows')return Response.json([]);
    assert.equal(table,'collection_reports');return Response.json([{...report,...JSON.parse(options.body)}]);
  };
  const result=await advanceBaseReport(report);assert.equal(result.status,'COMPLETE');assert.equal(result.row_count,2);assert.equal(result.source_cursor,'pay1');
}));
test('the daily rule is derived from the synchronized base and keeps only open payments scheduled for the day',()=>mocked(async()=>{
  const {advanceBaseReport}=await vite.ssrLoadModule('/lib/asaas-base-report.ts');
  const {DEFAULT_COLLECTION_SETTINGS}=await vite.ssrLoadModule('/lib/collection-rules.ts');
  const report={id:'daily',mode:'DAILY',source_generation:'g',source_cursor:null,page_offset:0,processed:0,row_count:0,status:'RUNNING',rule_config:DEFAULT_COLLECTION_SETTINGS,report_date:'2026-09-08'};
  const saved=[];
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);assert.equal(url.host,'db.invalid');const table=url.pathname.split('/').at(-1);
    if(table==='asaas_base_payments'){assert.equal(url.searchParams.get('payload->>status'),'in.(PENDING,OVERDUE)');return Response.json([
      {external_id:'due-today',payload:{id:'due-today',customer:'c1',status:'PENDING',dueDate:'2026-09-08',value:100},customer_payload:{name:'Due today'}},
      {external_id:'already-paid',payload:{id:'already-paid',customer:'c2',status:'RECEIVED',dueDate:'2026-09-08',value:100},customer_payload:{name:'Paid'}},
      {external_id:'no-stage',payload:{id:'no-stage',customer:'c3',status:'OVERDUE',dueDate:'2026-08-30',value:100},customer_payload:{name:'No stage'}},
    ]);}
    if(table==='asaas_customer_exclusions')return Response.json([]);
    if(table==='collection_report_rows'){if(options.method==='POST')saved.push(...JSON.parse(options.body));return Response.json([]);}
    assert.equal(table,'collection_reports');return Response.json([{...report,...JSON.parse(options.body)}]);
  };
  const result=await advanceBaseReport(report);
  assert.deepEqual(saved.map(row=>row.asaas_payment_id),['due-today']);
  assert.equal(result.processed,3);assert.equal(result.row_count,1);assert.equal(result.status,'COMPLETE');
}));
test('opening collections reuses the current daily rule instead of creating a duplicate report',()=>mocked(async()=>{
  const {createCollectionReport}=await vite.ssrLoadModule('/lib/collection-reports-server.ts');
  const {collectionToday}=await vite.ssrLoadModule('/lib/collection-policy.ts');
  const {DEFAULT_COLLECTION_SETTINGS}=await vite.ssrLoadModule('/lib/collection-rules.ts');
  const updatedAt='2026-09-09T10:00:00.000Z';
  const existing={id:'daily-existing',mode:'DAILY',report_date:collectionToday(),status:'COMPLETE',source_generation:'base-current',source_updated_at:updatedAt,rule_config:DEFAULT_COLLECTION_SETTINGS};
  let mutations=0;
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);assert.equal(url.host,'db.invalid');const table=url.pathname.split('/').at(-1);
    if(options.method&&options.method!=='GET')mutations++;
    if(table==='asaas_base_sync')return Response.json([{active_generation:'base-current',status:'READY',completed_at:updatedAt,last_event_at:null}]);
    if(table==='collection_settings')return Response.json([]);
    if(table==='collection_reports')return Response.json([existing]);
    throw new Error(`Unexpected table ${table}`);
  };
  const result=await createCollectionReport('DAILY');
  assert.equal(result.id,'daily-existing');assert.equal(mutations,0);
}));
test('a changed synchronized base recalculates the same daily report in place',()=>mocked(async()=>{
  const {createCollectionReport}=await vite.ssrLoadModule('/lib/collection-reports-server.ts');
  const {collectionToday}=await vite.ssrLoadModule('/lib/collection-policy.ts');
  const {DEFAULT_COLLECTION_SETTINGS}=await vite.ssrLoadModule('/lib/collection-rules.ts');
  const existing={id:'daily-existing',mode:'DAILY',report_date:collectionToday(),status:'COMPLETE',source_generation:'base-current',source_updated_at:'2026-09-09T09:00:00.000Z',rule_config:DEFAULT_COLLECTION_SETTINGS};
  const mutations=[];
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);assert.equal(url.host,'db.invalid');const table=url.pathname.split('/').at(-1);
    if(table==='asaas_base_sync')return Response.json([{active_generation:'base-current',status:'READY',completed_at:'2026-09-09T10:00:00.000Z',last_event_at:null}]);
    if(table==='collection_settings')return Response.json([]);
    if(table==='collection_reports'&&(!options.method||options.method==='GET'))return Response.json([existing]);
    mutations.push({table,method:options.method,body:options.body?JSON.parse(options.body):null});
    if(table==='collection_reports')return Response.json([{...existing,...JSON.parse(options.body)}]);
    return Response.json([]);
  };
  const result=await createCollectionReport('DAILY');
  assert.equal(result.id,'daily-existing');assert.equal(result.status,'RUNNING');assert.equal(result.row_count,0);
  assert.deepEqual(mutations.map(item=>[item.table,item.method]),[['collection_report_rows','DELETE'],['audit_events','DELETE'],['collection_reports','PATCH']]);
}));
