"use client";

import { useEffect } from "react";

/**
 * Global safety net for a well-documented Radix UI bug: any overlay portaled
 * onto <body> (Dialog, Select, DropdownMenu, Popover...) locks
 * `document.body.style.pointerEvents = "none"` while open, via its own
 * DismissableLayer, and restores it when it unmounts. Nest two of them (e.g.
 * a <Select> inside a <Dialog> — used all over this app: status, ator, tipo
 * de registro...) and the inner layer can save/restore the WRONG "original"
 * value, leaving body stuck at "none" forever. Symptom exactly as reported:
 * a dialog opens but nothing inside it is clickable, and only a full close +
 * reopen (which happens to reset it) fixes it.
 * https://github.com/radix-ui/primitives/issues/2355
 * https://github.com/radix-ui/primitives/issues/3445
 *
 * `DialogContent`'s `onCloseAutoFocus` (components/ui/dialog.tsx) clears this
 * right when a dialog closes, which covers the common case. This watches the
 * whole document as a last-resort net for the same lock getting left behind
 * by any *other* portaled overlay (a `<Select>` in a page's filter bar, not
 * inside any dialog, is enough to trigger the exact same Radix bug on its
 * own) — whenever body is locked but nothing with `data-state="open"` is
 * actually mounted anymore, the lock is stale and gets cleared.
 */
export function PointerEventsGuard() {
  useEffect(() => {
    const clearIfStale = () => {
      if (document.body.style.pointerEvents !== "none") return;
      if (document.querySelector('[data-state="open"]')) return;
      document.body.style.pointerEvents = "";
    };
    // Radix applies these styles synchronously on mount/unmount effects, so a
    // microtask after any DOM mutation is enough to catch the lock right
    // after the layer that owned it should have released it.
    const observer = new MutationObserver(() => queueMicrotask(clearIfStale));
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"], subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
