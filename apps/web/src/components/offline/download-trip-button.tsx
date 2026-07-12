"use client";

/**
 * The "Download for offline" control on route detail. Drives downloadTrip with a live progress bar,
 * then flips to a "Downloaded ✓ (size) · Remove" state (reactively, via liveQuery on the trips store).
 */
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "~/lib/offline/db";
import {
  downloadTrip,
  deleteTrip,
  type DownloadProgress,
} from "~/lib/offline/download-trip";
import { formatBytes } from "~/lib/offline/format";

export function DownloadTripButton({ routeId }: { routeId: string }) {
  const trip = useLiveQuery(() => db().trips.get(routeId), [routeId]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isDownloaded = !!trip && progress === null && !busy;

  async function handleDownload() {
    setError(null);
    setBusy(true);
    setProgress({ done: 0, total: 0, bytes: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await downloadTrip(routeId, setProgress, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Download failed");
      }
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  async function handleRemove() {
    await deleteTrip(routeId);
  }

  if (busy && progress) {
    const pct =
      progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="flex flex-col gap-1.5 rounded-xl bg-river-50 p-3">
        <div className="flex items-center justify-between text-xs font-semibold text-river-700">
          <span>
            Downloading… {progress.done}
            {progress.total ? `/${progress.total}` : ""} tiles ·{" "}
            {formatBytes(progress.bytes)}
          </span>
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="text-river-500 underline"
          >
            Cancel
          </button>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-river-200">
          <div
            className="bg-sunset-500 h-full rounded-full transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (isDownloaded) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-river-50 px-3 py-2.5 text-sm font-semibold text-river-700">
        <span>
          Downloaded ✓ ({formatBytes(trip.bytes)})
        </span>
        <button
          type="button"
          onClick={() => void handleRemove()}
          className="text-red-600 underline"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleDownload()}
        className="border-river-300 text-river-700 hover:bg-river-50 min-h-11 rounded-xl border font-semibold transition-colors"
      >
        Download for offline
      </button>
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : null}
    </div>
  );
}
