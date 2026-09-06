-- Supersedes 202609052300_payment_links_incremental_sync.sql.
--
-- That migration assumed Asaas's `GET /payments?paymentLink=X` filter
-- actually scoped results to link X, so a per-link watermark made sense.
-- Confirmed empirically that it doesn't: a real link id, a bogus one, and
-- no filter at all all returned the exact same totalCount for this account.
-- So the sync route never really did "one incremental scan per link" — it
-- did one FULL-ACCOUNT scan per link, every time. `app/api/asaas/sync-payments/route.ts`
-- now does a single global paginated walk instead (each payment already
-- carries its own correct `paymentLink` id, used to route it), with one
-- global watermark tracked via `audit_events` (entity_type "payment_sync")
-- rather than this per-link column. Dropping it since nothing reads/writes
-- it anymore.
--
-- Idempotent: safe to re-run.

alter table public.payment_links drop column if exists last_synced_at;
