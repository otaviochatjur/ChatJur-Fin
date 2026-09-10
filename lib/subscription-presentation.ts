import { actorCategoryLabel, type CommercialActor, type Subscription } from "./metrics";

type Actor = Pick<CommercialActor, "id" | "name" | "role" | "tier">;
type NamedPlan = { name: string } | null;
export type SubscriptionWithRelations = Subscription & {
  plans?: NamedPlan;
  actor_custom_plans?: NamedPlan;
  commercial_actors?: Actor | null;
  payment_links?: {
    plans: NamedPlan;
    actor_custom_plans: NamedPlan;
    commercial_actors: Actor | null;
  } | null;
};

/** Resolve labels only; preserve the real subscription ID and financial snapshot. */
export function presentSubscription(subscription: SubscriptionWithRelations): Subscription {
  const linked = Boolean(subscription.payment_link_id);
  const relation = linked ? subscription.payment_links : null;
  const plan = relation?.plans ?? relation?.actor_custom_plans;
  const actor = relation?.commercial_actors;
  return {
    ...subscription,
    // Linked subscriptions always inherit the plan currently bound to the
    // payment link. Only a plan explicitly registered by the operator may
    // use its own typed name; an Asaas/link label is never presented as the
    // product plan.
    display_plan_name: plan?.name ?? (subscription.source === "MANUAL" ? subscription.plan_name_raw ?? "—" : "—"),
    display_actor_id: actor?.id ?? null,
    display_actor_label: actor ? `${actorCategoryLabel(actor)} · ${actor.name}` : null,
  };
}

/** Keep every current linked subscription visible; never pick a customer's plan arbitrarily. */
export function currentLinkedSubscriptions(subscriptions: Subscription[]) {
  return subscriptions.filter(s => s.payment_link_id && s.display_plan_name && s.display_plan_name !== "—" && s.status !== "CANCELLED" && s.status !== "FROZEN");
}
