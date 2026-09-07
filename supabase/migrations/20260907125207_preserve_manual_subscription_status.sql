-- A paid webhook must not reactivate a subscription disabled by its owner.
alter table public.subscriptions add column if not exists status_manually_set boolean not null default false;
notify pgrst, 'reload schema';
