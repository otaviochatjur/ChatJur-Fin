"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type ColumnDef<K extends string = string> = { key: K; label: string; defaultWidth?: number };

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

const MIN_COLUMN_WIDTH = 72;
const DEFAULT_COLUMN_WIDTH = 160;

/**
 * Per-column pixel widths, resizable by dragging each header's right edge
 * (see `ResizableTh`). In-memory only, like `useColumnVisibility` above —
 * same reasoning: every dashboard table already refetches on mount, so
 * persisting isn't worth it yet.
 *
 * `defs` only supplies each key's `defaultWidth` fallback; `getWidth`/
 * `startResize` accept any string key, so a table's always-visible first
 * column (not part of the show/hide menu, so not in `defs`) can still be
 * made resizable — just pass its own `fallback` width directly.
 */
export function useColumnWidths<K extends string = string>(defs: readonly ColumnDef<K>[] = []) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const rafRef = useRef<number | null>(null);

  function getWidth(key: string, fallback?: number) {
    return widths[key] ?? defs.find((def) => def.key === key)?.defaultWidth ?? fallback ?? DEFAULT_COLUMN_WIDTH;
  }

  function startResize(key: string, fallback?: number) {
    return (event: React.MouseEvent<HTMLElement>) => {
      // Left-click drags only — avoids hijacking right-click/middle-click.
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = getWidth(key, fallback);
      // `mousemove` can fire dozens of times per second; calling `setWidths`
      // straight from it re-renders the *whole* table (every row, every
      // per-row <Select>) on every single one of those events, which is
      // what made dragging a column border feel laggy on the bigger tables
      // (241 links × 2 <Select> each, 747 clients...). Coalescing into at
      // most one state update per animation frame — via a ref instead of
      // more state, so the coalescing itself doesn't trigger renders — caps
      // the re-render rate to the screen's refresh rate instead of the
      // mouse's event rate, without changing the resize behavior itself
      // (the column still tracks the cursor 1:1, just resampled to ~60fps).
      let pendingWidth = startWidth;
      function onMove(moveEvent: MouseEvent) {
        pendingWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + (moveEvent.clientX - startX));
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setWidths((current) => (current[key] === pendingWidth ? current : { ...current, [key]: pendingWidth }));
        });
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        // Final snap, in case the last mousemove's frame got cancelled above.
        setWidths((current) => (current[key] === pendingWidth ? current : { ...current, [key]: pendingWidth }));
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  return { getWidth, startResize };
}

/**
 * A `<TableHead>` with a fixed pixel width and a drag handle on its right
 * edge. Requires the table itself to use `table-layout: fixed` (Tailwind's
 * `table-fixed`) — with that, the header row's widths are what the browser
 * uses to size every column, so body `<TableCell>`s don't need any changes.
 */
export function ResizableTh({ width, onResizeStart, sortDirection, onSort, className, children, ...props }: React.ComponentProps<typeof TableHead> & {
  sortDirection?: "ascending" | "descending" | "none";
  onSort?: () => void;
  width: number;
  onResizeStart: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <TableHead aria-sort={onSort ? sortDirection : undefined} style={{ width, minWidth: width, maxWidth: width }} className={cn("relative pr-3", className)} {...props}>
      {onSort ? <button type="button" onClick={onSort} className="inline-flex max-w-full items-center gap-1.5 rounded py-2 text-inherit hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" title="Clique para alternar a ordenação"><span className="truncate">{children}</span>{sortDirection === "ascending" ? <ArrowUp className="size-3.5 shrink-0 text-primary" /> : sortDirection === "descending" ? <ArrowDown className="size-3.5 shrink-0 text-primary" /> : <ArrowUpDown className="size-3.5 shrink-0 opacity-40" />}</button> : children}
      <span
        onMouseDown={onResizeStart}
        onDoubleClick={(event) => event.stopPropagation()}
        role="separator"
        aria-orientation="vertical"
        title="Arraste para redimensionar a coluna"
        className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none hover:bg-blue-300/70 active:bg-blue-400/80"
      />
    </TableHead>
  );
}

export type SortValue = string | number | null | undefined;
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
export function sortTableRows<T>(rows: readonly T[], value: (row: T) => SortValue, descending = false): T[] {
  return rows.map((row, index) => ({ row, index, value: value(row) })).sort((a, b) => {
    const emptyA = a.value == null || a.value === "" || (typeof a.value === "number" && !Number.isFinite(a.value));
    const emptyB = b.value == null || b.value === "" || (typeof b.value === "number" && !Number.isFinite(b.value));
    if (emptyA || emptyB) return emptyA === emptyB ? a.index - b.index : emptyA ? 1 : -1;
    const compared = typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : collator.compare(String(a.value), String(b.value));
    return (descending ? -compared : compared) || a.index - b.index;
  }).map(item => item.row);
}
export function useTableSort() {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  return {
    header: (key: string) => ({
      sortDirection: (sort?.key === key ? sort.descending ? "descending" : "ascending" : "none") as "ascending" | "descending" | "none",
      onSort: () => setSort(current => ({ key, descending: current?.key === key ? !current.descending : false })),
    }),
    rows: <T,>(rows: readonly T[], values: (row: T) => Record<string, SortValue>): readonly T[] =>
      sort ? sortTableRows(rows, row => values(row)[sort.key], sort.descending) : rows,
  };
}
