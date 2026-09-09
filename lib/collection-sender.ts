import type { ChatInstance } from "./chat-juridico-server";
import { FINANCIAL_INSTANCE } from "./collection-policy";

/** Keep the Financeiro WhatsApp selected whenever it is available. */
export function preferredCollectionInstance(instances: ChatInstance[]) {
  return instances.find(instance => instance.id === FINANCIAL_INSTANCE)?.id
    ?? instances.find(instance => /financeir/i.test(instance.name ?? ""))?.id
    ?? instances.find(instance => (instance.approved_template_count ?? 0) > 0)?.id
    ?? instances[0]?.id
    ?? "";
}
