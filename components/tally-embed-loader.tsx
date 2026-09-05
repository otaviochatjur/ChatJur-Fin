"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void };
  }
}

const TALLY_SCRIPT_SRC = "https://tally.so/widgets/embed.js";

/**
 * Loads the official Tally embed script exactly once for the whole app
 * (mounted near the root in app/layout.tsx). `dynamicHeight` needs this
 * script present; injecting/removing it every time a `ConnectForm` mounts
 * (e.g. switching dashboard tabs) would re-run Tally's setup unnecessarily
 * and can race with the iframe's own load. `ConnectForm` calls
 * `window.Tally.loadEmbeds()` itself on mount to pick up its iframe if the
 * script already finished loading by then.
 */
export function TallyEmbedLoader() {
  useEffect(() => {
    if (window.Tally) return;
    if (document.querySelector(`script[src="${TALLY_SCRIPT_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = TALLY_SCRIPT_SRC;
    script.async = true;
    document.body.appendChild(script);
  }, []);

  return null;
}
