"use client";

/**
 * A dismissable card nudging Add to Home Screen. On iOS especially, installing the PWA is what earns
 * the app durable storage for downloaded maps + queued paddles, so it's worth a gentle prompt.
 * Hidden once installed (display-mode: standalone) or once dismissed (remembered in localStorage).
 */
import { useEffect, useState } from "react";

const KEY = "paddle-prints:install-nudge-dismissed";

export function InstallNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(KEY) === "1";
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!dismissed && !standalone) setShow(true);
    } catch {
      /* private mode / no localStorage -- just don't nudge */
    }
  }, []);

  if (!show) return null;

  return (
    <div className="border-river-600 flex items-start gap-3 rounded-2xl border border-dashed p-4">
      <span className="text-2xl">📲</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">Add to Home Screen</p>
        <p className="text-river-300 mt-0.5 text-xs">
          Install Paddle Prints so downloaded maps and your paddles stay
          available with no signal. Tap Share, then “Add to Home Screen”.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* ignore */
          }
          setShow(false);
        }}
        className="text-river-300 shrink-0 text-xs font-semibold underline"
      >
        Dismiss
      </button>
    </div>
  );
}
