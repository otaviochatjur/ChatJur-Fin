import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',root,configFile:false,cacheDir:'node_modules/.vite-tests/report-performance',resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
after(()=>vite.close());
const {ReportCustomerCache,parallelReportItems}=await vite.ssrLoadModule('/lib/report-customer-cache.ts');
test('reuses in-flight customer requests only inside the same tenant/report, retries failures and expires',async()=>{
  let time=0,calls=0;const cache=new ReportCustomerCache(100,2,2,()=>time);
  const read=async()=>{calls++;return {name:'Customer'};};
  await Promise.all([cache.get('tenant:a','c',read),cache.get('tenant:a','c',read)]);assert.equal(calls,1);
  await cache.get('tenant:b','c',read);assert.equal(calls,2);
  time=101;await cache.get('tenant:a','c',read);assert.equal(calls,3);
  cache.clear('tenant:a');await cache.get('tenant:a','c',read);assert.equal(calls,4);
  await assert.rejects(()=>cache.get('tenant:a','failed',async()=>{throw Error('offline');}));
  assert.deepEqual(await cache.get('tenant:a','failed',read),{name:'Customer'});
});
test('rolling workers preserve order and bound concurrency',async()=>{
  let running=0,max=0;const output=await parallelReportItems([1,2,3,4,5],async n=>{running++;max=Math.max(max,running);await new Promise(resolve=>setTimeout(resolve,n===1?15:1));running--;return n*2;},2);
  assert.deepEqual(output,[2,4,6,8,10]);assert.equal(max,2);
});
test('ALL reads 100 per page, reuses customers and counts IDs without rereading snapshots',async()=>{
  const {withWebhookTenant}=await vite.ssrLoadModule('/lib/tenant-server.ts');
  const {advanceCollectionReport}=await vite.ssrLoadModule('/lib/collection-reports-server.ts');
  const {DEFAULT_COLLECTION_SETTINGS}=await vite.ssrLoadModule('/lib/collection-rules.ts');
  const previousFetch=globalThis.fetch,previous={...process.env};
  Object.assign(process.env,{SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',ASAAS_API_KEY:'test',ASAAS_BASE_URL:'https://api.asaas.com/v3'});
  let report={id:'performance-report',mode:'ALL',status:'RUNNING',phase:0,page_offset:0,processed:0,row_count:0,report_date:'2026-09-08',rule_config:DEFAULT_COLLECTION_SETTINGS};
  const saved=new Map(),offsets=[];let customerReads=0;
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);
    if(url.host==='api.asaas.com'){
      if(url.pathname==='/v3/payments'){
        assert.equal(url.searchParams.get('limit'),'100');const offset=Number(url.searchParams.get('offset'));offsets.push(offset);
        return Response.json({hasMore:offset===0,data:Array.from({length:100},(_,i)=>({id:`p${offset+i}`,customer:`c${i%2}`,dueDate:'2026-09-01',status:'RECEIVED',value:100,billingType:'PIX'}))});
      }
      assert.ok(url.pathname.startsWith('/v3/customers/'));customerReads++;return Response.json({name:'Customer',email:'test@example.invalid'});
    }
    const table=url.pathname.split('/').at(-1);
    if(table==='nexo_integrations')return Response.json([]);
    if(table==='collection_reports'){
      if(options.method==='PATCH')report={...report,...JSON.parse(options.body)};
      return Response.json([report]);
    }
    assert.equal(table,'collection_report_rows');
    if(options.method==='POST'){for(const row of JSON.parse(options.body))saved.set(row.asaas_payment_id,row);return Response.json([]);}
    assert.equal(url.searchParams.get('select'),'id');return Response.json([...saved.keys()].map(id=>({id})));
  };
  try{
    await withWebhookTenant({id:'tenant-performance',legacy:true},async()=>{
      const first=await advanceCollectionReport(report.id);assert.equal(first.page_offset,100);assert.equal(first.status,'RUNNING');
      const second=await advanceCollectionReport(report.id);assert.equal(second.status,'COMPLETE');assert.equal(second.row_count,200);assert.equal(second.processed,200);
      await advanceCollectionReport(report.id);
    });
    assert.deepEqual(offsets,[0,100]);assert.equal(customerReads,2);assert.equal(saved.size,200);
  }finally{globalThis.fetch=previousFetch;for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ASAAS_API_KEY','ASAAS_BASE_URL']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
