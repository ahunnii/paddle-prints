"use client";

/**
 * The route-detail "Your pace" card: an honest, tiered ETA (see `routes.etaForUser`) plus the
 * before-you-start hook -- "Start now -> done by <clock time>". The clock line is the only reason
 * this is a client component: it needs `Date.now()`, which a server component can only capture once
 * at render time.
 */
import { useEffect, useState } from "react";

const MPH_PER_MPS = 2.2369363;

export interface PastTime {
  startedAt: string;
  elapsedS: number;
  movingS: number;
  distanceM: number;
}

export interface EtaData {
  source: "exact" | "typeAvg" | "default";
  speedMps: number;
  estimates: { oneWayS: number; roundTripS: number };
  pastTimes?: PastTime[];
}

/** `h:mm`, e.g. "1:48" for an hour forty-eight, "0:23" for twenty-three minutes. */
function formatHM(totalS: number) {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function sourceLabel(source: EtaData["source"], routeType: "river" | "waypoint") {
  switch (source) {
    case "exact":
      return "Based on your paddles on this route";
    case "typeAvg":
      return `Based on your ${routeType === "river" ? "river" : "flat-water"} average`;
    case "default":
      return "Using the 3.0 mph default (paddle more!)";
  }
}

export function YourPaceCard({
  eta,
  shape,
  routeType,
}: {
  eta: EtaData;
  shape: "one_way" | "out_and_back";
  routeType: "river" | "waypoint";
}) {
  const durationS =
    shape === "out_and_back" ? eta.estimates.roundTripS : eta.estimates.oneWayS;

  // Re-derive "done by" once a minute so it stays live-ish without a jittery per-second re-render.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const doneBy =
    now != null
      ? new Date(now + durationS * 1000).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  return (
    <div className="bg-river-50 flex flex-col gap-2 rounded-2xl p-3">
      <div className="flex items-center justify-between">
        <p className="text-river-500 text-xs uppercase tracking-wide">
          Your pace
        </p>
        <span className="text-river-600 text-xs font-semibold tabular-nums">
          {(eta.speedMps * MPH_PER_MPS).toFixed(1)} mph
        </span>
      </div>

      <p className="text-river-950 font-display text-2xl font-extrabold tabular-nums">
        {formatHM(durationS)}
        {shape === "out_and_back" ? (
          <span className="text-river-500 ml-1 text-sm font-medium">
            round trip
          </span>
        ) : null}
      </p>

      <p className="text-river-600 text-xs">{sourceLabel(eta.source, routeType)}</p>

      {doneBy ? (
        <p className="text-sunset-600 text-sm font-bold">
          Start now → done by {doneBy}
        </p>
      ) : null}

      {eta.pastTimes && eta.pastTimes.length > 0 ? (
        <p className="text-river-500 text-xs">
          Your history here:{" "}
          {eta.pastTimes
            .map(
              (p) =>
                `${new Date(p.startedAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })} — ${formatHM(p.elapsedS)}`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
