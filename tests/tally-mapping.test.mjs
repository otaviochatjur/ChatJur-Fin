import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root, cacheDir: 'node_modules/.vite-tests/tally-mapping', resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
after(() => vite.close());
const { mapTallyFieldsToLead } = await vite.ssrLoadModule('/lib/tally-mapping.ts');

test("the applicant's own name is not overwritten by the payee's name later in the form", () => {
  // Real shape from a production Tally submission: the applicant answers
  // "Nome completo do responsável" early in the form, then a separate
  // "Nome completo ou Razão Social do recebedor" question near the end for
  // payment/PIX data — a different person/company in general.
  const fields = [
    { label: 'Nome completo do responsável', value: 'Otavio Gaya' },
    { label: 'Nome completo ou Razão Social do recebedor', value: 'Luis Otavio Chaves Gaya' },
    { label: 'CPF ou CNPJ do recebedor', value: '02553054351' },
  ];
  const lead = mapTallyFieldsToLead(fields);
  assert.equal(lead.full_name, 'Otavio Gaya');
  assert.equal(lead.payee_name, 'Luis Otavio Chaves Gaya');
});
