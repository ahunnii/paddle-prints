"use client";

/**
 * "Pinned Paddles" on /me: bookmarks saved from the crew feed (social.pinsList), each with an unpin
 * affordance and a "Paddle this" link into /record that either follows the pinned trip's saved route
 * (?route=) or retraces the raw track if it wasn't tied to one (?paddle=). Mirrors the card styling
 * of the other /me sections -- see me-client.tsx / crew-section.tsx.
 */
import Link from "next/link";

import { Avatar } from "~/components/ui/avatar";
import { api } from "~/trpc/react";

const METERS_PER_MILE = 1609.344;

export function PinnedSection() {
  const utils = api.useUtils();
  const { data, isPending, error } = api.social.pinsList.useQuery();

  const pinToggle = api.social.pinToggle.useMutation({
    onSuccess: () => void utils.social.pinsList.invalidate(),
  });

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white/10 p-5">
      <h2 className="text-river-100 text-xs font-bold uppercase tracking-widest">
        Pinned Paddles
      </h2>

      {isPending ? (
        <p className="text-river-300 text-sm">Loading…</p>
      ) : error ? (
        <p className="text-river-300 text-sm">Couldn&apos;t load your pins.</p>
      ) : !data || data.length === 0 ? (
        <p className="text-river-300 text-sm">
          Pin paddles from the crew feed to try them yourself.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((pin) => {
            const p = pin.paddle;
            const distanceMi = (p.distanceM / METERS_PER_MILE).toFixed(2);
            const recordHref = p.routeId
              ? `/record?route=${p.routeId}`
              : `/record?paddle=${p.id}`;
            return (
              <li
                key={pin.paddleId}
                className="flex items-center gap-3 rounded-2xl bg-river-900/50 p-3"
              >
                <Avatar name={p.ownerName ?? "Someone"} image={p.ownerImage} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-white">
                    {p.ownerName ?? "Someone"} ·{" "}
                    {p.routeName ?? "Quick start paddle"}
                  </span>
                  <span className="text-river-300 text-xs">
                    {distanceMi} mi ·{" "}
                    {new Date(p.startedAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={recordHref}
                    className="bg-sunset-500 active:bg-sunset-600 rounded-full px-3 py-1.5 text-xs font-bold text-white"
                  >
                    Paddle this
                  </Link>
                  <button
                    type="button"
                    onClick={() => pinToggle.mutate({ paddleId: pin.paddleId })}
                    disabled={pinToggle.isPending}
                    className="active:bg-red-500/20 rounded-full bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                    aria-label="Unpin"
                  >
                    📌×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
