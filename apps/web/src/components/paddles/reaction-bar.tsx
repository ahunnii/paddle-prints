"use client";

/**
 * The fixed row of emoji reaction chips shown on a paddle. Every emoji in `REACTION_EMOJIS` is
 * always rendered (the simpler alternative to a collapsed "top reactions + add" affordance) --
 * count only shows once someone's used it, and the chip is highlighted when the signed-in user is
 * one of the reactors. Tapping a chip optimistically flips the local count/mine state, fires
 * `social.reactionToggle`, and reconciles with the server's fresh summary on success -- or rolls
 * back to the pre-tap snapshot on failure.
 *
 * `variant` picks a color scheme that reads on this component's two homes: "dark" for the glassy
 * river-900 feed cards, "light" for the white paddle-detail card.
 */
import { useEffect, useRef, useState } from "react";

import { REACTION_EMOJIS, type ReactionEmoji } from "@paddle-prints/api/constants";
import { api } from "~/trpc/react";

interface ReactionBarProps {
  paddleId: string;
  reactions: Record<string, number>;
  myReactions: string[];
  size?: "sm" | "md";
  variant?: "dark" | "light";
}

const SIZE_CLASSES = {
  sm: "px-2 py-0.5 text-xs gap-0.5",
  md: "px-2.5 py-1 text-sm gap-1",
} as const;

const VARIANT_CLASSES = {
  dark: {
    base: "border-river-700 bg-river-800/60 text-river-200 hover:bg-river-800",
    active: "border-sunset-400 bg-sunset-500/25 text-sunset-200",
  },
  light: {
    base: "border-river-200 bg-river-50 text-river-700 hover:bg-river-100",
    active: "border-sunset-500 bg-sunset-500/15 text-sunset-600",
  },
} as const;

export function ReactionBar({
  paddleId,
  reactions,
  myReactions,
  size = "md",
  variant = "light",
}: ReactionBarProps) {
  const [counts, setCounts] = useState<Record<string, number>>(reactions);
  const [mine, setMine] = useState<Set<string>>(() => new Set(myReactions));

  // Reseed local state when we're pointed at a different paddle (e.g. a list re-keying its rows).
  // Intentionally NOT reseeded on every `reactions`/`myReactions` prop change -- that would clobber
  // an in-flight optimistic flip whenever the parent re-renders.
  const seededFor = useRef(paddleId);
  useEffect(() => {
    if (seededFor.current !== paddleId) {
      seededFor.current = paddleId;
      setCounts(reactions);
      setMine(new Set(myReactions));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paddleId]);

  const snapshotRef = useRef<{
    counts: Record<string, number>;
    mine: Set<string>;
  } | null>(null);

  const toggle = api.social.reactionToggle.useMutation({
    onSuccess: (data) => {
      setCounts(data.counts);
      setMine(new Set(data.mine));
    },
  });

  function handleToggle(emoji: ReactionEmoji, e: React.MouseEvent) {
    // These chips live inside card-wide "stretched link" wrappers (feed) -- don't let a tap bubble
    // into the paddle-detail navigation.
    e.preventDefault();
    e.stopPropagation();

    snapshotRef.current = { counts, mine };
    const isMine = mine.has(emoji);
    setMine((prev) => {
      const next = new Set(prev);
      if (isMine) next.delete(emoji);
      else next.add(emoji);
      return next;
    });
    setCounts((prev) => ({
      ...prev,
      [emoji]: Math.max(0, (prev[emoji] ?? 0) + (isMine ? -1 : 1)),
    }));

    toggle.mutate(
      { paddleId, emoji },
      {
        onError: () => {
          const snapshot = snapshotRef.current;
          if (snapshot) {
            setCounts(snapshot.counts);
            setMine(snapshot.mine);
          }
        },
      },
    );
  }

  const sizeClass = SIZE_CLASSES[size];
  const variantClasses = VARIANT_CLASSES[variant];

  return (
    <div className="flex flex-wrap items-center gap-1">
      {REACTION_EMOJIS.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const isMine = mine.has(emoji);
        return (
          <button
            key={emoji}
            type="button"
            onClick={(e) => handleToggle(emoji, e)}
            className={`inline-flex items-center rounded-full border font-semibold tabular-nums transition-colors ${sizeClass} ${
              isMine ? variantClasses.active : variantClasses.base
            }`}
            aria-pressed={isMine}
            aria-label={`React ${emoji}${count > 0 ? ` (${count})` : ""}`}
          >
            <span>{emoji}</span>
            {count > 0 ? <span>{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
