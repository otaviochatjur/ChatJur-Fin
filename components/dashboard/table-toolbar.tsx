"use client";

import { useState } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ColumnDef<K extends string = string> = { key: K; label: string };

/**
 * Column show/hide for a single table. In-memory only (resets on reload) —
 * every dashboard table already refetches from Supabase on mount, so
 * persisting this isn't worth the added complexity yet. `defs` is the full,
 * ordered column list; callers wrap each `<TableHead>`/`<TableCell>` with
 * `isVisible("key") && (...)` and use `visibleCount` for empty-state
 * `colSpan`.
 */
export function useColumnVisibility<K extends string>(defs: readonly ColumnDef<K>[]) {
  const [hidden, setHidden] = useState<Set<K>>(() => new Set());

  function isVisible(key: K) {
    return !hidden.has(key);
  }

  function toggle(key: K) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const visibleCount = defs.length - hidden.size;

  return { isVisible, toggle, visibleCount };
}

/** Dropdown with a checkbox per column, driven by `useColumnVisibility`. */
export function ColumnVisibilityMenu<K extends string>({ defs, isVisible, toggle }: {
  defs: readonly ColumnDef<K>[];
  isVisible: (key: K) => boolean;
  toggle: (key: K) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5"><Columns3 className="size-3.5" />Colunas</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Mostrar colunas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {defs.map((def) => (
          <DropdownMenuCheckboxItem
            key={def.key}
            checked={isVisible(def.key)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggle(def.key)}
          >
            {def.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
