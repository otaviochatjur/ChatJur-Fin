"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActorRoleSection } from "@/components/dashboard/actor-role-section";
import type { ActorMetrics, CommercialActor, Plan } from "@/lib/metrics";

/**
 * "Comercial" — plain sales staff, unrelated to the Chat Jurídico Connect
 * partner program: Comercial interno (salaried, no repasse) and Comercial
 * externo (independent, commissioned via the Repasses tab).
 */
export function CommercialSection({ actors, metrics, plans, onChanged }: { actors: CommercialActor[]; metrics: Record<string, ActorMetrics>; plans: Plan[]; onChanged: () => void }) {
  return (
    <Tabs defaultValue="internal">
      <TabsList className="grid w-full grid-cols-2 lg:w-fit lg:grid-cols-2">
        <TabsTrigger value="internal">Comercial interno</TabsTrigger>
        <TabsTrigger value="external">Comercial externo</TabsTrigger>
      </TabsList>
      <TabsContent value="internal" className="mt-5">
        <ActorRoleSection
          actors={actors}
          role="INTERNAL_SALES"
          metrics={metrics}
          plans={plans}
          onChanged={onChanged}
          title="Comercial interno"
          subtitle="Equipe própria (salário) — preços e links, sem repasse/comissão"
          addLabel="Novo comercial interno"
          dialogTitle="Cadastrar comercial interno"
          dialogDescription="Membro da equipe própria — não entra nos repasses."
          emptyMessage="Nenhum comercial interno cadastrado ainda."
          emptyWorkspaceMessage="Cadastre um comercial interno para ver preços e links."
          columnLabel="Nome"
        />
      </TabsContent>
      <TabsContent value="external" className="mt-5">
        <ActorRoleSection
          actors={actors}
          role="EXTERNAL_SALES"
          metrics={metrics}
          plans={plans}
          onChanged={onChanged}
          title="Equipe comercial externa"
          subtitle="Vendedores independentes com tabela própria e links de assinatura"
          addLabel="Novo comercial"
          dialogTitle="Cadastrar comercial externo"
          dialogDescription="O comercial poderá receber atribuição de leads, contratos e MRR."
          emptyMessage="Nenhum comercial externo cadastrado ainda."
          emptyWorkspaceMessage="Cadastre um comercial externo para ver preços e links."
          columnLabel="Comercial"
          showEmailField
        />
      </TabsContent>
    </Tabs>
  );
}
