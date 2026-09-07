"use client";

import { useEffect } from "react";

/**
 * Embeds the public "Chat Jurídico Connect" application form (Tally) — the
 * single form shared by Parceiro/Embaixador/Institucional candidates.
 * Category classification happens later, manually, from the "Candidaturas"
 * tab once the submission lands in `connect_leads` via
 * app/api/webhooks/tally.
 */
export function ConnectForm() {
  useEffect(() => {
    // The global script (mounted once in app/layout.tsx via
    // TallyEmbedLoader) only auto-wires iframes present when IT loads; if
    // this component mounts later (e.g. user navigates to this tab after
    // the script already finished loading), re-trigger it explicitly so
    // this iframe gets picked up and `dynamicHeight` works.
    window.Tally?.loadEmbeds();
  }, []);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-card p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Quer se conectar ao Chat Jurídico?</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">Preencha seus dados e nosso time avaliará o formato de parceria mais adequado.</p>
      </div>
      <iframe
        src="https://tally.so/embed/2EWBOV?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1"
        data-tally-src="https://tally.so/embed/2EWBOV?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1"
        loading="lazy"
        width="100%"
        height={800}
        frameBorder={0}
        title="Chat Jurídico Connect"
      />
    </section>
  );
}
