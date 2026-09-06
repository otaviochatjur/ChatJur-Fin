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
      function onMove(moveEvent: MouseEvent) {
        const next = Math.max(MIN_COLUMN_WIDTH, startWidth + (moveEvent.clientX - startX));
        setWidths((current) => ({ ...current, [key]: next }));
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
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
export function ResizableTh({ width, onResizeStart, className, children, ...props }: React.ComponentProps<typeof TableHead> & {
  width: number;
  onResizeStart: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <TableHead style={{ width, minWidth: width, maxWidth: width }} className={cn("relative pr-3", className)} {...props}>
      {children}
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
