import { Badge } from "@/components/ui/badge";

const styles = {
  ACTIVE: { className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Ativo" },
  INACTIVE: { className: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400", label: "Inativo" },
  PENDING: { className: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500", label: "Pendente" },
} as const;

export function StatusBadge({ status }: { status: keyof typeof styles }) {
  const style = styles[status];
  return (
    <Badge variant="outline" className={style.className}>
      <span className={`mr-1.5 size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </Badge>
  );
}
