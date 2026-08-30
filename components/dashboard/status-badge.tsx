import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" }) {
  const active = status === "ACTIVE";
  return (
    <Badge variant="outline" className={active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
      <span className={`mr-1.5 size-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active ? "Ativo" : "Inativo"}
    </Badge>
  );
}
