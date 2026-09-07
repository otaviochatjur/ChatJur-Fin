"use client";

import { useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "guest" | "ready">("loading");
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { let active = true; fetch("/api/auth").then(r => { if (active) setState(r.ok ? "ready" : "guest"); }).catch(() => { if (active) { setMessage("Não foi possível verificar sua sessão. Tente novamente."); setState("guest"); } }); return () => { active = false; }; }, []);
  if (state === "loading") return <div role="status" className="grid min-h-screen place-items-center text-muted-foreground">Verificando sessão…</div>;
  if (state === "ready") return children;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, action: signup ? "signup" : "login" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPassword("");
      if (data.confirmationRequired) setMessage("Confira seu e-mail para confirmar a conta. Depois, volte aqui para entrar.");
      else window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha de conexão."); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-background p-6"><section className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
    <LockKeyhole className="mb-6 size-7 text-primary" /><h1 className="text-2xl font-semibold">{signup ? "Criar sua conta" : "Entrar no Nexo"}</h1><p className="mt-2 text-sm text-muted-foreground">Financeiro e relacionamento · Chat Jurídico</p>
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm">E-mail<Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1" /></label>
      <label className="block text-sm">Senha<Input type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 8 : 1} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} className="mt-1" /></label>
      {signup && <p className="text-sm text-muted-foreground">Use pelo menos 8 caracteres.</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      <Button disabled={busy} className="w-full">{busy ? "Aguarde…" : signup ? "Criar conta" : "Entrar"}</Button>
    </form>
    <Button variant="link" className="mt-4 px-0" disabled={busy} onClick={() => { setSignup(!signup); setMessage(""); }}>{signup ? "Já tenho conta" : "Criar uma conta"}</Button>
  </section></main>;
}
