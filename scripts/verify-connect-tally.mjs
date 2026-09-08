// Authorized read/import verification for the existing owner's account. No messages are sent.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
Object.assign(process.env,parseEnv(readFileSync('.env','utf8')));
const root=process.cwd();
const vite=await createServer({appType:'custom',root,configFile:false,cacheDir:'node_modules/.vite-tests/verify-connect-tally',resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
try {
  const {adminRequest,withWebhookTenant}=await vite.ssrLoadModule('/lib/tenant-server.ts');
  const [tenant]=await adminRequest('/rest/v1/nexo_tenants?reserved_email=eq.otavio%40chatjuridico.com.br&select=*');
  assert.ok(tenant?.owner_user_id);
  await withWebhookTenant(tenant,async()=>{
    const {getIntegration,openSecret}=await vite.ssrLoadModule('/lib/integrations-server.ts');
    const {listTallyForms}=await vite.ssrLoadModule('/lib/tally-forms.ts');
    const {syncTallySubmissions}=await vite.ssrLoadModule('/lib/tally-sync.ts');
    const integration=await getIntegration('tally');assert.ok(integration?.account_id);
    const key=openSecret(integration.encrypted_key,tenant.id,'tally');
    const forms=await listTallyForms(key);
    assert.ok(forms.some(form=>form.id===integration.account_id));
    console.log(`PASS: API lists ${forms.length} forms, including the saved form.`);
    const imported=await syncTallySubmissions(key,integration.account_id);
    console.log(`Tally sync: ${JSON.stringify(imported)}`);
    const {GET}=await vite.ssrLoadModule('/app/api/dashboard-summary/route.ts');
    const response=await GET();assert.equal(response.status,200);
    const data=await response.json();
    console.log(`PASS: dashboard summary responded successfully (${Object.keys(data).length} fields).`);
  });
}finally{await vite.close();}
