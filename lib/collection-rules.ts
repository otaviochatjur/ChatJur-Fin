import { z } from "zod";
export const ruleSchema = z.object({ days: z.number().int().min(-30).max(365), template: z.string().regex(/^[a-z0-9_]{1,100}$/), label: z.string().trim().min(1).max(100) });
const rulesSchema = z.array(ruleSchema).max(50).refine(rules => new Set(rules.map(r=>r.days)).size === rules.length, "Não repita o mesmo dia na régua.");
export const collectionSettingsSchema = z.object({
  rules: rulesSchema,
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(100), rules: rulesSchema })).max(50),
  customers: z.array(z.object({ customerId: z.string().min(1).max(100), name: z.string().max(250), categoryId: z.string().uuid().nullable(), rules: rulesSchema.nullable() })).max(5000),
}).superRefine((config,ctx) => {
  if (new Set(config.categories.map(c=>c.id)).size !== config.categories.length || new Set(config.customers.map(c=>c.customerId)).size !== config.customers.length) ctx.addIssue({ code: "custom", message: "Categorias ou clientes repetidos." });
  for (const customer of config.customers) if (customer.categoryId && !config.categories.some(c=>c.id===customer.categoryId)) ctx.addIssue({ code: "custom", message: "A categoria de um cliente não existe mais." });
});
export type CollectionRule = z.infer<typeof ruleSchema>;
export type CollectionSettings = z.infer<typeof collectionSettingsSchema>;
export const DEFAULT_COLLECTION_SETTINGS: CollectionSettings = {
  rules: [
    [-5,"cobranca_d_menos_5"], [0,"cobranca_d_000"], [1,"cobranca_d_mais_01"], [2,"cobranca_d_mais_002"], [5,"cobranca_d_mais_5"], [10,"cobranca_d_mais_10"], [20,"cobranca_d_mais_20"], [25,"cobranca_d_mais_025"], [30,"cobranca_d_mais_30_cancelamento"],
  ].map(([days,template])=>({ days: Number(days), template: String(template), label: Number(days)<0 ? "Aviso antecipado" : Number(days)===0 ? "Vence hoje" : `${days} dias de atraso` })),
  categories: [], customers: [],
};
export function rulesForCustomer(settings: CollectionSettings, customerId: string) {
  const customer = settings.customers.find(c=>c.customerId===customerId);
  if (customer?.rules) return customer.rules;
  return settings.categories.find(c=>c.id===customer?.categoryId)?.rules ?? settings.rules;
}
