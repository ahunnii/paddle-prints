"use client";

/**
 * The "Paddle in Review" page (/review): a year-filterable recap of everything the signed-in
 * paddler has logged -- an overview map of every track, headline stat tiles, a few standout
 * records, and a shareable recap card. All data comes from a single `paddles.review` query keyed
 * on the selected year (or all-time when none is picked).
 */
import Link from "next/link";

import { ReviewMap } from "~/components/review/review-map";
import { ShareCard } from "~/components/review/share-card";
import { api } from "~/trpc/react";
import { useState } from "react";

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.2369363;

function miles(m: number, dp = 1) {
  return (m / METERS_PER_MILE).toFixed(dp);
}

/** Total seconds -> "h:mm", unpadded hours (can run past 99 for an all-time total). */
function formatClockHM(totalS: number) {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatRecordDate(iso: string | Date) {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "YYYY-MM" -> "May 2026". */
function formatMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" });
}

export function ReviewClient() {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const reviewQuery = api.paddles.review.useQuery(
    selectedYear == null ? {} : { year: selectedYear },
  );
  const data = reviewQuery.data;
  const years = [...(data?.years ?? [])].sort((a, b) => b - a);
  const tracks = data?.tracks ?? [];

  const yearLabel = selectedYear == null ? "All time" : String(selectedYear);

  return (
    <main className="from-river-800 to-river-950 min-h-dvh bg-gradient-to-b px-4 pb-28 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <Link href="/" className="text-river-200 hover:text-white text-sm font-semibold">
            ← Back
          </Link>
          <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight text-white">
            🏆 Paddle in Review
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          <YearPill active={selectedYear === null} onClick={() => setSelectedYear(null)}>
            All time
          </YearPill>
          {years.map((y) => (
            <YearPill key={y} active={selectedYear === y} onClick={() => setSelectedYear(y)}>
              {y}
            </YearPill>
          ))}
        </div>

        {reviewQuery.isPending ? (
          <div className="flex flex-col items-center gap-2 rounded-3xl bg-white/10 p-10 text-center">
            <p className="text-river-200 text-sm">Loading your paddles…</p>
          </div>
        ) : reviewQuery.isError ? (
          <div className="flex flex-col items-center gap-2 rounded-3xl bg-white/10 p-10 text-center">
            <p className="text-river-200 text-sm">Couldn&apos;t load your review. Try again.</p>
          </div>
        ) : (
          <>
            <div className="relative h-80 overflow-hidden rounded-3xl">
              <ReviewMap tracks={tracks} className="h-full w-full" />
              {tracks.length === 0 ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-river-950/50">
                  <p className="text-river-100 rounded-full bg-black/30 px-4 py-2 text-sm font-medium">
                    No paddles yet
                  </p>
                </div>
              ) : null}
            </div>

            {data ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Total miles" value={miles(data.totals.distanceM)} />
                  <StatTile label="Paddles" value={String(data.totals.paddles)} />
                  <StatTile label="Total time" value={formatClockHM(data.totals.elapsedS)} />
                  <StatTile label="Avg mi/paddle" value={miles(data.totals.avgDistanceM)} />
                  <StatTile label="Avg duration" value={formatClockHM(data.totals.avgElapsedS)} />
                  <StatTile
                    label="Streak"
                    value={`${data.currentStreakWeeks} wk streak`}
                  />
                </div>

                {data.longest || data.fastest || data.mostActiveMonth ? (
                  <div className="flex flex-col divide-y divide-white/10 rounded-2xl bg-white/10">
                    {data.longest ? (
                      <RecordRow
                        icon="📏"
                        label="Longest paddle"
                        value={`${miles(data.longest.distanceM, 2)} mi`}
                        detail={`${data.longest.routeName ?? "Quick start paddle"} · ${formatRecordDate(data.longest.startedAt)}`}
                      />
                    ) : null}
                    {data.fastest ? (
                      <RecordRow
                        icon="⚡"
                        label="Fastest"
                        value={`${(data.fastest.avgSpeedMps * MPS_TO_MPH).toFixed(1)} mph`}
                        detail={`${data.fastest.routeName ?? "Quick start paddle"} · ${formatRecordDate(data.fastest.startedAt)}`}
                      />
                    ) : null}
                    {data.mostActiveMonth ? (
                      <RecordRow
                        icon="📅"
                        label="Most active month"
                        value={formatMonth(data.mostActiveMonth.month)}
                        detail={`${data.mostActiveMonth.count} paddles`}
                      />
                    ) : null}
                  </div>
                ) : null}

                <div className="flex justify-center pt-2">
                  <ShareCard
                    stats={{
                      yearLabel,
                      totalMiles: miles(data.totals.distanceM),
                      paddleCount: data.totals.paddles,
                      totalTime: formatClockHM(data.totals.elapsedS),
                      avgMiles: miles(data.totals.avgDistanceM),
                      streakLabel: `${data.currentStreakWeeks} wk streak`,
                    }}
                  />
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

function YearPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "bg-sunset-500 text-white"
          : "border-river-300 text-river-200 hover:bg-river-800 border"
      }`}
    >
      {children}
    </button>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-white/10 p-4">
      <p className="text-river-200 text-[0.65rem] font-bold uppercase tracking-widest">
        {label}
      </p>
      <p className="text-2xl font-extrabold tabular-nums leading-none text-white">{value}</p>
    </div>
  );
}

function RecordRow({
  icon,
  label,
  value,
  detail,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="text-2xl">{icon}</span>
      <div className="flex flex-1 flex-col">
        <p className="text-river-200 text-xs font-semibold uppercase tracking-widest">{label}</p>
        <p className="font-bold text-white">
          {value} <span className="text-river-300 font-medium">· {detail}</span>
        </p>
      </div>
    </div>
  );
}
