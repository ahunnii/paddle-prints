"use client";

/**
 * The "Paddle in Review" share flow: renders the visible stats as a fixed-size, DOM-only card
 * (no map -- keeps `html-to-image` capture fast and reliable), rasterizes it with `toPng()`, and
 * hands the result to the native share sheet when available, falling back to a plain download.
 */
import { useRef, useState } from "react";
import { toPng } from "html-to-image";

const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;

export interface ReviewShareStats {
  /** "All time" or a specific year like "2026". */
  yearLabel: string;
  totalMiles: string;
  paddleCount: number;
  /** h:mm */
  totalTime: string;
  avgMiles: string;
  /** e.g. "3 wk streak" */
  streakLabel: string;
}

function fileNameFor(yearLabel: string) {
  const slug = yearLabel.trim().toLowerCase().replace(/\s+/g, "-");
  return `paddle-prints-review-${slug}.png`;
}

export function ShareCard({ stats }: { stats: ReviewShareStats }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleShare() {
    const node = cardRef.current;
    if (!node) return;

    setPreparing(true);
    setError(null);
    try {
      const dataUrl = await toPng(node, {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        pixelRatio: 2,
      });
      const fileName = fileNameFor(stats.yearLabel);
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Paddle Prints — Paddle in Review",
        });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      // The user dismissing the native share sheet throws AbortError -- not a real failure.
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Couldn't create the share image. Try again.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => void handleShare()}
        disabled={preparing}
        className="bg-sunset-500 hover:bg-sunset-600 active:bg-sunset-600 active:scale-[0.98] flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-3 text-center font-semibold text-white shadow-lg transition-colors disabled:opacity-60"
      >
        {preparing ? "Preparing…" : "📤 Share your year"}
      </button>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {/* Off-screen capture target. `html-to-image` needs the node actually laid out with real
          dimensions to rasterize it, so this sits far off-canvas rather than display:none/hidden. */}
      <div className="pointer-events-none fixed left-[-9999px] top-0" aria-hidden="true">
        <div
          ref={cardRef}
          style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
          className="from-river-800 to-river-950 flex flex-col justify-between bg-gradient-to-b p-8 text-white"
        >
          <div className="flex flex-col gap-1">
            <span className="text-2xl font-extrabold tracking-tight">🛶 Paddle Prints</span>
            <span className="text-river-200 text-sm font-semibold uppercase tracking-widest">
              Paddle in Review · {stats.yearLabel}
            </span>
          </div>

          <div className="flex flex-col gap-6">
            <div>
              <p className="text-river-300 text-xs font-bold uppercase tracking-widest">
                Total distance
              </p>
              <p className="text-6xl font-extrabold leading-none tabular-nums">
                {stats.totalMiles}
                <span className="ml-2 text-2xl font-bold text-white/60">mi</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-river-300 text-xs font-bold uppercase tracking-widest">
                  Paddles
                </p>
                <p className="text-3xl font-extrabold tabular-nums">{stats.paddleCount}</p>
              </div>
              <div>
                <p className="text-river-300 text-xs font-bold uppercase tracking-widest">
                  Total time
                </p>
                <p className="text-3xl font-extrabold tabular-nums">{stats.totalTime}</p>
              </div>
              <div>
                <p className="text-river-300 text-xs font-bold uppercase tracking-widest">
                  Avg mi/paddle
                </p>
                <p className="text-3xl font-extrabold tabular-nums">{stats.avgMiles}</p>
              </div>
              <div>
                <p className="text-river-300 text-xs font-bold uppercase tracking-widest">
                  Streak
                </p>
                <p className="text-3xl font-extrabold tabular-nums">{stats.streakLabel}</p>
              </div>
            </div>
          </div>

          <p className="text-river-400 text-xs">paddleprints.app</p>
        </div>
      </div>
    </div>
  );
}
