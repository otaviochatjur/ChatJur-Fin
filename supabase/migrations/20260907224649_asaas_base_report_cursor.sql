alter table public.collection_reports add column source_cursor text;
notify pgrst,'reload schema';
