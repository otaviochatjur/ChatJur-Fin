// Runs the real webhook handler locally with a temporary signing secret.
// Leaves one clearly identified test application in the owner's database.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
Object.assign(process.env, parseEnv(readFileSync('.env','utf8')));
process.env.TALLY_WEBHOOK_SECRET = randomBytes(32).toString('hex');
const root=process.cwd();
const vite=await createServer({appType:'custom',configFile:false,root,cacheDir:'node_modules/.vite-tests/tally-local',resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
let server;
try {
  const {POST}=await vite.ssrLoadModule('/app/api/webhooks/tally/route.ts');
  const {adminRequest,withWebhookTenant}=await vite.ssrLoadModule('/lib/tenant-server.ts');
  const [tenant]=await adminRequest('/rest/v1/nexo_tenants?reserved_email=eq.otavio%40chatjuridico.com.br&select=*');
  assert.ok(tenant?.owner_user_id && tenant.legacy);
  server=createHttpServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const response=await POST(new Request(`http://127.0.0.1${req.url}`,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}));
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());
    } catch {res.writeHead(500);res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/webhooks/tally`;
  const submission='nexo-local-simulation-2026-09';
  const body=JSON.stringify({eventId:submission,eventType:'FORM_RESPONSE',createdAt:new Date().toISOString(),data:{formId:'2EWBOV',submissionId:submission,responseId:submission,fields:[{label:'Nome completo',value:'TESTE LOCAL — Integração Tally'},{label:'E-mail',value:'teste-tally@example.invalid'},{label:'Por que deseja participar?',value:'Simulação local autorizada. Registro de teste, sem candidatura real.'}]}});
  const send=signature=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Tally-Signature':signature},body});
  assert.equal((await send('invalid')).status,401);
  const signature=createHmac('sha256',process.env.TALLY_WEBHOOK_SECRET).update(body).digest('base64');
  const first=await send(signature);assert.equal(first.status,200,await first.text());
  const second=await send(signature);assert.equal(second.status,200);assert.equal((await second.json()).deduplicated,true);
  const saved=await adminRequest(`/rest/v1/connect_leads?tenant_id=eq.${tenant.id}&tally_submission_id=eq.${submission}&select=id,full_name,tally_form_id`);
  assert.equal(saved.length,1);assert.equal(saved[0].full_name,'TESTE LOCAL — Integração Tally');assert.equal(saved[0].tally_form_id,'2EWBOV');
  console.log('PASS: local HTTP webhook, invalid signature rejected, signed submission saved, repeat deduplicated. One TESTE LOCAL application retained.');
  const renewals=await vite.ssrLoadModule('/app/api/renewals/route.ts');
  const response=await withWebhookTenant(tenant,()=>renewals.GET());
  const result=await response.json();assert.equal(response.status,200,result.error);
  console.log(`PASS: real renewal query returned ${result.renewals.length} annual client plans (${result.renewals.filter(r=>r.needsReview).length} need historical review).`);
  const reports=await vite.ssrLoadModule('/lib/collection-reports-server.ts');
  await withWebhookTenant(tenant,async()=>{
    const report=await reports.createCollectionReport('DAILY');
    assert.equal(report.status,'COMPLETE');
    assert.equal((await reports.readCollectionReport(report.id)).status,'COMPLETE');
    assert.equal((await reports.reportRows(report.id)).length,0);
    console.log('PASS: holiday daily report persisted and reloaded, zero scheduled sends.');
  });
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  await vite.close();
}
