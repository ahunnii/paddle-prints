"use client";

/**
 * The member directory on /me: everyone in the crew, who's currently out on the water, and how many
 * paddles they've logged. Mirrors the card styling of the other /me sections (rounded-3xl, bg-white/10).
 */
import { Avatar } from "~/components/ui/avatar";
import { api } from "~/trpc/react";

export function CrewSection() {
  const { data, isPending, error } = api.users.directory.useQuery();

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white/10 p-5">
      <h2 className="text-river-100 text-xs font-bold uppercase tracking-widest">
        Crew
      </h2>

      {isPending ? (
        <p className="text-river-300 text-sm">Loading…</p>
      ) : error ? (
        <p className="text-river-300 text-sm">Couldn&apos;t load the crew.</p>
      ) : !data || data.length === 0 ? (
        <p className="text-river-300 text-sm">No one here yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-3 rounded-2xl bg-river-900/50 p-3"
            >
              <Avatar name={member.name} image={member.image} size="md" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold text-white">
                  {member.name}
                </span>
                <span className="text-river-300 text-xs">
                  Joined{" "}
                  {new Date(member.joinedAt).toLocaleDateString([], {
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  · {member.paddleCount} paddle
                  {member.paddleCount === 1 ? "" : "s"}
                </span>
              </div>
              {member.onWaterNow ? (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-400/20 px-2 py-1 text-xs font-bold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  On the water
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
