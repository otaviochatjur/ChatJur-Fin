"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function SectionLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  return <div role="status" className="space-y-3 rounded-2xl border bg-card p-8 text-sm text-muted-foreground">
    <p>{slow ? "Esta seção está demorando mais que o esperado para abrir." : "Carregando seção…"}</p>
    {slow && <Button variant="outline" onClick={() => window.location.reload()}>Recarregar página</Button>}
  </div>;
}

export class SectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="space-y-3 rounded-2xl border bg-card p-8 text-sm">
      <p>Não foi possível abrir esta seção. Recarregue a página para buscar a versão atual.</p>
      <Button variant="outline" onClick={() => window.location.reload()}>Recarregar página</Button>
    </div>;
    return this.props.children;
  }
}
