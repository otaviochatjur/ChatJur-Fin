"use client";
import { useEffect, useState } from "react";
import { KeyRound, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function IntegrationsSection() {
  const [status, setStatus] = useState<{ asaas: { configured: boolean; environment: string }; chat: { configured: boolean }; tally: { configured: boolean; formId: string } } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/integrations").then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setStatus(data); }).catch(e => setError(e.message)); }, []);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">As conexões e os dados desta conta são exclusivos do seu usuário.</p><Button variant="outline" onClick={async () => { await fetch("/api/auth", { method: "DELETE" }); window.location.reload(); }}><LogOut className="size-4" />Sair da conta</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!status && !error && <p role="status" className="text-sm text-muted-foreground">Carregando integrações…</p>}
    {status && <div className="grid items-start gap-6 xl:grid-cols-2">
      <IntegrationForm provider="asaas" title="Asaas" description="Importe links, clientes e pagamentos da sua conta." configured={status.asaas.configured} initialEnvironment={status.asaas.environment} />
      <IntegrationForm provider="chat-juridico" title="Chat Jurídico" description="Conecte o canal de mensagens para o acompanhamento das cobranças." configured={status.chat.configured} initialEnvironment="production" />
      <IntegrationForm provider="tally" title="Tally" description="Importe as respostas do formulário para as Candidaturas do Chat Jurídico Connect." configured={status.tally.configured} initialEnvironment="production" initialFormId={status.tally.formId} />
    </div>}
  </div>;
}

function IntegrationForm({ provider, title, description, configured, initialEnvironment, initialFormId = "2EWBOV" }: { provider: string; title: string; description: string; configured: boolean; initialEnvironment: string; initialFormId?: string }) {
  const [formId, setFormId] = useState(initialFormId);
  const [forms, setForms] = useState<{ id: string; name: string; numberOfSubmissions: number }[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const [savedFormId, setSavedFormId] = useState(initialFormId);
  const [apiKey, setApiKey] = useState("");
  const [environment, setEnvironment] = useState(initialEnvironment);
  const [connected, setConnected] = useState(configured);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [webhookToken, setWebhookToken] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey, environment, formId }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setApiKey(""); setConnected(true); setSavedFormId(formId); setWebhookToken(data.webhookToken ?? "");
      setMessage(provider === "tally" ? "Chave validada e salva. Use \"Sincronizar candidaturas\" para importar as respostas do formulário." : provider === "asaas" ? "Chave validada e salva." : "Chave validada e salva. Consulte a régua na aba Cobranças.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  async function loadForms() {
    setLoadingForms(true); setMessage("");
    try {
      const response = await fetch("/api/tally/forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setForms(data.forms); if (!data.forms.length) setMessage("Nenhum formulário disponível para esta chave.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Não foi possível listar formulários."); }
    finally { setLoadingForms(false); }
  }
  async function syncTally() {
    setSyncing(true); setSyncMessage("");
    try {
      const r = await fetch("/api/tally/sync-submissions", { method: "POST" });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setSyncMessage(data.imported > 0 ? `${data.imported} candidatura(s) nova(s) importada(s) (${data.skipped} já existente(s)).` : `Nenhuma candidatura nova (${data.skipped} já importada(s) anteriormente).`);
    } catch (e) { setSyncMessage(e instanceof Error ? e.message : "Não foi possível sincronizar."); }
    finally { setSyncing(false); }
  }
  return <section className="rounded-2xl border bg-card p-6">
    <div className="flex items-center gap-3"><KeyRound className="size-5 text-primary" /><h2 className="text-lg font-semibold">{title}</h2><span className="ml-auto text-xs text-muted-foreground">{connected ? "Chave configurada" : "Não configurada"}</span></div>
    <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    <form onSubmit={save} className="mt-6 space-y-4">
      {provider === "asaas" && <label className="block text-sm">Ambiente<select className="mt-1 h-10 w-full rounded-md border bg-card px-3" value={environment} onChange={e => setEnvironment(e.target.value)}><option value="production">Produção</option><option value="sandbox">Sandbox · testes</option></select></label>}
      <label className="block text-sm">{connected ? "Nova chave de API" : "Chave de API"}<Input type="password" autoComplete="off" spellCheck={false} required={provider !== "tally" || !connected} minLength={10} maxLength={8192} value={apiKey} onChange={e => setApiKey(e.target.value)} className="mt-1" placeholder={connected ? "Cole aqui para substituir a chave" : "Cole sua chave"} /></label>
      {provider === "tally" && <p className="text-xs text-muted-foreground">Gere um token pessoal em Tally → Configurações da conta → API.</p>}
      <p className="text-xs text-muted-foreground">Armazenada de forma criptografada no servidor. A chave salva não é exibida novamente.</p>
      {provider === "chat-juridico" && <p className="text-sm text-muted-foreground">Régua configurada para o número financeiro da skill. Revise e aprove as mensagens na aba Cobranças.</p>}
      {provider === "tally" && <div className="space-y-3"><Button type="button" variant="outline" disabled={loadingForms || busy || syncing || (!apiKey && !connected)} onClick={loadForms}>{loadingForms ? "Buscando formulários…" : "Buscar meus formulários"}</Button><label className="block text-sm">Formulário para Candidaturas{forms.length ? <select required className="mt-1 h-10 w-full rounded-md border bg-card px-3" value={formId} onChange={e => setFormId(e.target.value)}>{!forms.some(form => form.id === formId) && <option value="">Selecione um formulário</option>}{forms.map(form => <option key={form.id} value={form.id}>{form.name} · {form.numberOfSubmissions} respostas ({form.id})</option>)}</select> : <Input required value={formId} onChange={e => setFormId(e.target.value)} />}</label><p className="text-xs text-muted-foreground">Busque os formulários, escolha um e salve. Trocar o formulário preserva as candidaturas já importadas.</p></div>}
      <Button disabled={busy || syncing || loadingForms}>{busy ? "Salvando…" : "Validar e salvar"}</Button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </form>
    {provider === "tally" && connected && <div className="mt-5 space-y-2 border-t pt-5">
      <Button type="button" variant="outline" size="sm" disabled={syncing || busy || savedFormId !== formId || Boolean(apiKey)} onClick={syncTally}><RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Sincronizando…" : "Sincronizar candidaturas"}</Button>
      <p className="text-xs text-muted-foreground">Busca todas as respostas do formulário no Tally e importa as que ainda não estão nas Candidaturas.</p>
      {syncMessage && <p role="status" className="text-sm text-muted-foreground">{syncMessage}</p>}
    </div>}
    {webhookToken && <div className="mt-5 space-y-2 rounded-lg bg-muted p-4 text-sm"><p>Para atualizações automáticas, configure no Asaas o endereço abaixo e este token. Copie o token agora; ele não será exibido novamente.</p><code className="block break-all">{window.location.origin}/api/webhooks/asaas</code><code className="block break-all select-all">{webhookToken}</code></div>}
  </section>;
}
