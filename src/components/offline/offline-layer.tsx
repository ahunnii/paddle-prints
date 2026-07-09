"use client";

/**
 * The client-side offline runtime, mounted once around the whole app:
 *  - SerwistProvider registers the service worker (prod only) and exposes its lifecycle;
 *  - OfflineBootstrap drains the sync queue on load / reconnect / tab-focus and requests persistent
 *    storage once;
 *  - UpdateToast surfaces a "new version" prompt, suppressed while a paddle is recording.
 */
import { useEffect, useState } from "react";
import { SerwistProvider, useSerwist } from "@serwist/next/react";

import { syncQueue } from "~/lib/offline/sync";
import { useRecorder } from "~/lib/recorder/use-recorder";

const IS_PROD = process.env.NODE_ENV === "production";

function OfflineBootstrap() {
  useEffect(() => {
    // Drain anything queued from a previous session as soon as we load.
    void syncQueue();

    // Ask the browser to keep our IndexedDB from being evicted (esp. important on iOS).
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage
        .persist()
        .then((granted) => console.log("[offline] persistent storage:", granted))
        .catch(() => undefined);
    }

    const onOnline = () => void syncQueue();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncQueue();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}

function UpdateToast() {
  const { serwist } = useSerwist();
  const [waiting, setWaiting] = useState(false);
  const status = useRecorder((s) => s.machine.status);
  const isRecording = status !== "idle" && status !== "finished";

  useEffect(() => {
    if (!serwist) return;
    const onWaiting = () => setWaiting(true);
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [serwist]);

  // Never interrupt a live recording with an update prompt.
  if (!waiting || isRecording) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-3 rounded-2xl bg-river-900 px-4 py-3 text-sm text-white shadow-2xl">
        <span className="font-semibold">New version ready</span>
        <button
          type="button"
          onClick={() => {
            if (!serwist) return;
            serwist.addEventListener("controlling", () =>
              window.location.reload(),
            );
            serwist.messageSkipWaiting();
          }}
          className="rounded-lg bg-sunset-500 px-3 py-1.5 font-bold text-white active:bg-sunset-600"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export function OfflineLayer({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/sw.js"
      register={IS_PROD}
      disable={!IS_PROD}
      reloadOnOnline={false}
    >
      <OfflineBootstrap />
      {children}
      <UpdateToast />
    </SerwistProvider>
  );
}
