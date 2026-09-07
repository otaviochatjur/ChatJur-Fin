import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType:'custom', configFile:false, root, cacheDir:'node_modules/.vite-tests/annual-renewals', resolve:{alias:{'@':root}}, server:{middlewareMode:true,hmr:false}, optimizeDeps:{noDiscovery:true,include:[]} });
after(()=>vite.close());
const { calculateAnnualRenewals: calculate, annualAnniversary } = await vite.ssrLoadModule('/lib/annual-renewals.ts');
const s = { id:'s', customer_id:'c', billing_period:'ANNUAL', status:'ACTIVE', value:1200, installments:12, payment_links:{plans:{id:'plan',name:'Plano anual'}} };
const p = (id,date,cycle='old') => ({id,asaas_payment_id:id,subscription_id:'s',status:'RECEIVED',payment_date:date,confirmed_date:null,cycle_installment:cycle});
test('installments do not restart annual validity, but early renewal does',()=>{
  assert.equal(calculate([s],[p('a','2026-01-10'),p('b','2026-02-10')],'2026-09-07')[0].renewsAt,'2027-01-10');
  const result=calculate([s],[p('a','2026-01-10'),p('b','2026-07-10'),p('c','2026-06-01','new'),p('d','2026-07-01','new')],'2026-09-07')[0];
  assert.equal(result.startedAt,'2026-06-01');assert.equal(result.renewsAt,'2027-06-01');assert.equal(result.needsReview,false);
});
test('unpaid and future payments do not start validity; monthly and unlinked plans are excluded',()=>{
  const result=calculate([s],[{...p('a','2026-01-01'),status:'PENDING'},p('b','2027-01-01')],'2026-09-07')[0];
  assert.equal(result.startedAt,null);assert.equal(result.needsReview,true);
  assert.deepEqual(calculate([{...s,billing_period:'MONTHLY'},{...s,id:'x',payment_links:null}],[],'2026-09-07'),[]);
});
test('annual recurring invoices reset validity; unknown cycles require review',()=>{
  const payments=[p('a','2025-08-01',null),p('b','2026-07-01',null)].map(p=>({...p,cycle_subscription:'recurring'}));
  assert.equal(calculate([{...s,installments:1}],payments,'2026-09-07')[0].renewsAt,'2027-07-01');
  assert.equal(calculate([s],[p('a','2026-01-01',null)],'2026-09-07')[0].needsReview,true);
  assert.equal(annualAnniversary('2024-02-29'),'2025-02-28');
});
test('separate annual plans remain separate for one customer',()=>{
  assert.equal(calculate([s,{...s,id:'s2',payment_links:{plans:{id:'p2',name:'Outro'}}}],[],'2026-09-07').length,2);
});
test('cadence defers weekends and national holidays using earliest converging stage',async()=>{
  const { collectionSchedule }=await vite.ssrLoadModule('/lib/collection-policy.ts');
  assert.equal(collectionSchedule('2026-09-05','2026-09-07').stage,null);
  assert.equal(collectionSchedule('2026-09-05','2026-09-08').trigger,0);
  assert.equal(collectionSchedule('2026-04-03','2026-04-03').stage,null);
  assert.equal(collectionSchedule('2026-09-01','2026-10-01').stage,'cobranca_d_mais_30_cancelamento');
});
test('individual rules take precedence over category and default, including explicit disabling',async()=>{
  const { rulesForCustomer,DEFAULT_COLLECTION_SETTINGS }=await vite.ssrLoadModule('/lib/collection-rules.ts');
  const category=[{days:3,template:'especial',label:'Especial'}];
  const settings={...DEFAULT_COLLECTION_SETTINGS,categories:[{id:'cat',name:'Categoria',rules:category}],customers:[{customerId:'c',name:'Cliente',categoryId:'cat',rules:null}]};
  assert.deepEqual(rulesForCustomer(settings,'c'),category);
  settings.customers[0].rules=[];assert.deepEqual(rulesForCustomer(settings,'c'),[]);
  assert.deepEqual(rulesForCustomer(settings,'other'),DEFAULT_COLLECTION_SETTINGS.rules);
});
