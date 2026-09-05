"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActorRoleSection } from "@/components/dashboard/actor-role-section";
import { ConnectLeadsSection } from "@/components/dashboard/connect-leads-section";
import type { ActorMetrics, CommercialActor, ConnectLead, Plan } from "@/lib/metrics";

/**
 * "Chat Jurídico Connect" — the official partner program: Parceiro/Parceiro
 * Plus, Embaixador and Institucional, plus the review queue for
 * candidacies submitted through the separate public application form.
 */
export function ConnectSection({ actors, metrics, plans, leads, onChanged }: { actors: CommercialActor[]; metrics: Record<string, ActorMetrics>; plans: Plan[]; leads: ConnectLead[]; onChanged: () => void }) {
  const pendingCount = leads.filter((lead) => lead.status === "PENDING").length;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="partners">
        <TabsList className="grid w-full grid-cols-4 lg:w-fit lg:grid-cols-4">
          <TabsTrigger value="partners">Parceiros</TabsTrigger>
          <TabsTrigger value="ambassadors">Embaixadores</TabsTrigger>
          <TabsTrigger value="institutional">Institucional</TabsTrigger>
          <TabsTrigger value="leads">
            Candidaturas
            {pendingCount > 0 && <span className="ml-1.5 grid size-4 place-items-center rounded-full bg-[#3b82f6] text-[10px] font-semibold text-white">{pendingCount}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="partners" className="mt-5">
          <ActorRoleSection
            actors={actors}
            role="PARTNER"
            metrics={metrics}
            plans={plans}
            onChanged={onChanged}
            title="Parceiros cadastrados"
            subtitle="Parceiro e Parceiro Plus — tabela própria, links e clientes originados"
            addLabel="Novo parceiro"
            dialogTitle="Cadastrar parceiro"
            dialogDescription="Depois do cadastro, defina preços, gere links e ajuste o tier (Parceiro/Plus) na aba Dados do parceiro."
            emptyMessage="Nenhum parceiro cadastrado ainda."
            emptyWorkspaceMessage="Cadastre um parceiro para ver preços e links."
            columnLabel="Parceiro"
          />
        </TabsContent>
        <TabsContent value="ambassadors" className="mt-5">
          <ActorRoleSection
            actors={actors}
            role="AMBASSADOR"
            metrics={metrics}
            plans={plans}
            onChanged={onChanged}
            title="Embaixadores cadastrados"
            subtitle="Tabela própria, links e clientes originados"
            addLabel="Novo embaixador"
            dialogTitle="Cadastrar embaixador"
            dialogDescription="Depois do cadastro, você poderá definir preços e gerar links."
            emptyMessage="Nenhum embaixador cadastrado ainda."
            emptyWorkspaceMessage="Cadastre um embaixador para ver preços e links."
            columnLabel="Embaixador"
          />
        </TabsContent>
        <TabsContent value="institutional" className="mt-5">
          <ActorRoleSection
            actors={actors}
            role="INSTITUTIONAL"
            metrics={metrics}
            plans={plans}
            onChanged={onChanged}
            title="Parceiros institucionais"
            subtitle="OABs/subseções, associações, universidades, entidades de classe"
            addLabel="Novo institucional"
            dialogTitle="Cadastrar parceiro institucional"
            dialogDescription="Depois do cadastro, você poderá definir preços e gerar links."
            emptyMessage="Nenhum parceiro institucional cadastrado ainda."
            emptyWorkspaceMessage="Cadastre um parceiro institucional para ver preços e links."
            columnLabel="Instituição"
          />
        </TabsContent>
        <TabsContent value="leads" className="mt-5">
          <ConnectLeadsSection leads={leads} onChanged={onChanged} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
