ALTER TABLE public.nexo_integrations DROP CONSTRAINT nexo_integrations_provider_check;
ALTER TABLE public.nexo_integrations ADD CONSTRAINT nexo_integrations_provider_check CHECK (provider IN ('asaas', 'chat-juridico', 'tally'));
