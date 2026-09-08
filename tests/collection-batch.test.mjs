import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',root,configFile:false,cacheDir:'node_modules/.vite-tests/collection-batch',resolve:{alias:{'@':root}},server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
after(()=>vite.close());
const {selectedCollectionPreviews,runCollectionBatch}=await vite.ssrLoadModule('/lib/collection-batch.ts');
const row=id=>({payment:{id},blocked:null,approval:'signed'});
test('only selected eligible signed and unprocessed previews can be dispatched',()=>{
  const rows=[row('a'),{...row('b'),blocked:'inactive'},{...row('c'),approval:undefined},row('d'),row('e')];
  assert.deepEqual(selectedCollectionPreviews(rows,new Set(['a','b','c','d']),{d:'Enviado'}).map(r=>r.payment.id),['a']);
});
test('dispatches sequentially and stops after an uncertain response without retry',async()=>{
  const calls=[],results=[];
  await runCollectionBatch([row('a'),row('b'),row('c')],async r=>{calls.push(r.payment.id);if(r.payment.id==='b')throw new Error('timeout');return {ok:true,message:'Enviado'};},(r,result)=>results.push(result),()=>false);
  assert.deepEqual(calls,['a','b']);assert.equal(results[1].ok,false);
});
test('pause takes effect after the current message, preserving remaining selections',async()=>{
  const calls=[];let stop=false;
  const count=await runCollectionBatch([row('a'),row('b')],async r=>{calls.push(r.payment.id);stop=true;return {ok:true,message:'Enviado'};},()=>{},()=>stop);
  assert.equal(count,1);assert.deepEqual(calls,['a']);
});
test('Tally form listing follows pages and never follows redirects with credentials',async()=>{
  const {listTallyForms}=await vite.ssrLoadModule('/lib/tally-forms.ts');
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(new URL(url).searchParams.get('page'),String(calls));return Response.json({items:[{id:`f${calls}`,name:`Form ${calls}`}],hasMore:calls===1});};
    assert.equal((await listTallyForms('fake')).length,2);
    globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://elsewhere.invalid'}});
    await assert.rejects(()=>listTallyForms('fake'),/302/);
  }finally{globalThis.fetch=original;}
});


test('report selections map Asaas IDs to Chat IDs without selecting other recipients', async () => {
  const { selectedChatPaymentIds, selectedCollectionPreviews } = await vite.ssrLoadModule('/lib/collection-batch.ts');
  const rows = [
    { payment: { id: 'chat-a', asaas_payment_id: 'asaas-a' }, approval: 'signed', blocked: null },
    { payment: { id: 'chat-b', asaas_payment_id: 'asaas-b' }, approval: 'signed', blocked: null },
    { payment: { id: 'chat-c', asaas_payment_id: 'asaas-c' }, approval: 'signed', blocked: 'Inactive' },
  ];
  const ids = selectedChatPaymentIds(rows, new Set(['asaas-a','asaas-c']));
  assert.deepEqual(selectedCollectionPreviews(rows, ids, {}).map(row => row.payment.id), ['chat-a']);
  assert.equal(selectedCollectionPreviews(rows, selectedChatPaymentIds(rows, new Set()), {}).length, 0);
});
