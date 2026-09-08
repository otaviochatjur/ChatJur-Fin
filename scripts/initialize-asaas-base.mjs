// Authorized initial synchronization and verification; no outbound financial mutations.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
Object.assign(process.env,parseEnv(readFileSync('.env','utf8')));
// Match Vite's dotenv expansion of escaped dollar signs in the legacy Asaas key.
if (process.env.ASAAS_API_KEY) process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY.replaceAll(String.fromCharCode(92,36), String.fromCharCode(36));
const root=process.cwd();
const vite=await createServer({appType:'custom',root,configFile:false,cacheDir:'node_modules/.vite-tests/initialize-asaas-base',resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
try {
  const {adminRequest,withWebhookTenant}=await vite.ssrLoadModule('/lib/tenant-server.ts');
  const [tenant]=await adminRequest('/rest/v1/nexo_tenants?reserved_email=eq.otavio%40chatjuridico.com.br&select=*');assert.ok(tenant?.owner_user_id);
  await withWebhookTenant(tenant,async()=>{
    const {supabaseRequest}=await vite.ssrLoadModule('/lib/supabase-server.ts');
    const linkFields='id,actor_id,plan_id,custom_plan_id,price_version_id,value,billing_period,status';
    async function links(){const rows=[];for(let offset=0;;offset+=500){const page=await supabaseRequest(`/rest/v1/payment_links?select=${linkFields}&order=id.asc&limit=500&offset=${offset}`);rows.push(...page);if(page.length<500)return rows;}}
    const before=await links();
    const {startAsaasBaseSync,advanceAsaasBaseSync}=await vite.ssrLoadModule('/lib/asaas-base.ts');
    const started=Date.now();let state=await startAsaasBaseSync(false),step=0;
    while(state.status==='RUNNING'){
      state=await advanceAsaasBaseSync(state.generation);
      if(++step%10===0||state.status==='READY')console.log(JSON.stringify({step,phase:state.phase,processed:state.processed,status:state.status,seconds:Math.round((Date.now()-started)/1000)}));
      if(step>10000)throw Error('Too many pages; saved progress can be resumed.');
    }
    const after=new Map((await links()).map(row=>[row.id,row]));
    for(const row of before)assert.deepEqual(after.get(row.id),row,'Existing commercial link fields changed');
    console.log(`PASS: ${before.length} existing links retained their commercial associations, amounts and local status.`);
    const {createCollectionReport,advanceCollectionReport,reportRows}=await vite.ssrLoadModule('/lib/collection-reports-server.ts');
    const previousFetch=globalThis.fetch;let remoteCalls=0;
    globalThis.fetch=(url,options)=>{if(new URL(url).host.includes('asaas.com'))remoteCalls++;return previousFetch(url,options);};
    try {
      const reportStart=Date.now();let report=await createCollectionReport('ALL');
      assert.equal(report.source_generation,state.active_generation);
      while(report.status!=='COMPLETE')report=await advanceCollectionReport(report.id);
      const rows=await reportRows(report.id);assert.equal(rows.length,report.row_count);assert.equal(remoteCalls,0);
      console.log(JSON.stringify({reportRows:rows.length,reportSeconds:Number(((Date.now()-reportStart)/1000).toFixed(2)),asaasCalls:remoteCalls,reportId:report.id}));
    }finally{globalThis.fetch=previousFetch;}
  });
}finally{await vite.close();}
