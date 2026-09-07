import { Badge } from "@/components/ui/badge";

const styles = {
  ACTIVE: { className: "border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500", label: "Ativo" },
  INACTIVE: { className: "border-slate-200 dark:border-border bg-slate-50 dark:bg-muted text-slate-500 dark:text-muted-foreground", dot: "bg-slate-400", label: "Inativo" },
  PENDING: { className: "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300", dot: "bg-amber-500", label: "Pendente" },
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
