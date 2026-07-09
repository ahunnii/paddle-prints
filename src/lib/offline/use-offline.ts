"use client";

/**
 * Reactive views over the offline stores for the UI, via Dexie liveQuery -- components re-render as
 * tiles download, paddles queue, and syncs drain.
 */
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "./db";
import { getTripStorageSummary, type TripStorageSummary } from "./download-trip";

export interface PendingCounts {
  paddles: number;
  pois: number;
  deadLettered: number;
  total: number;
}

const ZERO: PendingCounts = { paddles: 0, pois: 0, deadLettered: 0, total: 0 };

/** Live count of paddles/POIs still queued for sync, plus how many have dead-lettered. */
export function usePendingCounts(): PendingCounts {
  return (
    useLiveQuery(async () => {
      const [paddles, pois] = await Promise.all([
        db().pendingPaddles.toArray(),
        db().pendingPois.toArray(),
      ]);
      const deadLettered =
        paddles.filter((p) => p.deadLetter).length +
        pois.filter((p) => p.deadLetter).length;
      return {
        paddles: paddles.length,
        pois: pois.length,
        deadLettered,
        total: paddles.length + pois.length,
      };
    }, []) ?? ZERO
  );
}

/** Live dead-letter rows (paddles + POIs) with their error messages, for the storage manager. */
export function useDeadLetters() {
  return useLiveQuery(async () => {
    const [paddles, pois] = await Promise.all([
      db().pendingPaddles.filter((p) => !!p.deadLetter).toArray(),
      db().pendingPois.filter((p) => !!p.deadLetter).toArray(),
    ]);
    return [
      ...paddles.map((p) => ({
        id: p.id,
        kind: "paddle" as const,
        error: p.deadLetter!,
      })),
      ...pois.map((p) => ({
        id: p.id,
        kind: "poi" as const,
        error: p.deadLetter!,
      })),
    ];
  }, []);
}

/** Live set of routeIds that are downloaded for offline use. */
export function useDownloadedRouteIds(): Set<string> {
  const ids = useLiveQuery(() => db().trips.toCollection().primaryKeys(), []);
  return new Set((ids as string[] | undefined) ?? []);
}

/** Live "is this route downloaded?" (undefined while the first query resolves). */
export function useIsDownloaded(routeId: string): boolean | undefined {
  return useLiveQuery(
    async () => !!(await db().trips.get(routeId)),
    [routeId],
  );
}

export interface StorageSummary {
  trips: TripStorageSummary[];
  totalBytes: number;
  estimateUsage?: number;
  estimateQuota?: number;
  persisted?: boolean;
}

/** Live per-trip sizes + a snapshot of navigator.storage.estimate()/persisted for the storage manager. */
export function useStorageSummary(): StorageSummary | undefined {
  const trips = useLiveQuery(() => getTripStorageSummary(), []);
  const [estimate, setEstimate] = useState<{
    usage?: number;
    quota?: number;
    persisted?: boolean;
  }>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: { usage?: number; quota?: number; persisted?: boolean } = {};
      if (typeof navigator !== "undefined" && navigator.storage) {
        try {
          const est = await navigator.storage.estimate();
          out.usage = est.usage;
          out.quota = est.quota;
        } catch {
          /* ignore */
        }
        try {
          out.persisted = await navigator.storage.persisted();
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setEstimate(out);
    })();
    return () => {
      cancelled = true;
    };
    // Re-read the estimate whenever trip storage changes.
  }, [trips]);

  if (!trips) return undefined;
  return {
    trips: trips.trips,
    totalBytes: trips.totalBytes,
    estimateUsage: estimate.usage,
    estimateQuota: estimate.quota,
    persisted: estimate.persisted,
  };
}
