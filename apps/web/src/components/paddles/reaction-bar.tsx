"use client";

/**
 * The Facebook-style reaction affordance shown on a paddle. Instead of a full row of six chips, it
 * renders a compact summary (the used emojis as an overlapping glyph cluster + the total count) and
 * a single "React" pill; tapping either opens a popover listing every emoji in `REACTION_EMOJIS` as
 * a tappable chip. Tapping a chip optimistically flips the local count/mine state, fires
 * `social.reactionToggle`, reconciles with the server's fresh summary on success -- or rolls back to
 * the pre-tap snapshot on failure -- then closes the popover.
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
    popover: "border-river-700 bg-river-800",
  },
  light: {
    base: "border-river-200 bg-river-50 text-river-700 hover:bg-river-100",
    active: "border-sunset-500 bg-sunset-500/15 text-sunset-600",
    popover: "border-river-200 bg-white",
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Close the popover on an outside mousedown or Escape. The listeners only exist while it's open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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

  function handleSelect(emoji: ReactionEmoji, e: React.MouseEvent) {
    handleToggle(emoji, e);
    setOpen(false);
  }

  // Stop taps on the summary/React controls from bubbling into the card's stretched <Link>.
  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  const sizeClass = SIZE_CLASSES[size];
  const variantClasses = VARIANT_CLASSES[variant];

  // Only the used emojis, in canonical order, plus their summed total.
  const usedEmojis = REACTION_EMOJIS.filter((emoji) => (counts[emoji] ?? 0) > 0);
  const total = usedEmojis.reduce((sum, emoji) => sum + (counts[emoji] ?? 0), 0);
  const iReacted = mine.size > 0;

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      {usedEmojis.length > 0 ? (
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setOpen((prev) => !prev);
          }}
          className={`inline-flex items-center rounded-full border font-semibold tabular-nums transition-colors ${sizeClass} ${
            iReacted ? variantClasses.active : variantClasses.base
          }`}
          aria-label={`Reactions (${total})`}
        >
          <span className="flex items-center">
            {usedEmojis.map((emoji, i) => (
              <span key={emoji} className={i > 0 ? "-ml-1" : undefined}>
                {emoji}
              </span>
            ))}
          </span>
          <span className="ml-1">{total}</span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={(e) => {
          stop(e);
          setOpen((prev) => !prev);
        }}
        className={`inline-flex items-center rounded-full border font-semibold transition-colors ${sizeClass} ${variantClasses.base}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="React"
      >
        <span>🛶</span>
        {size === "md" ? <span className="ml-1">React</span> : null}
      </button>

      {open ? (
        <div
          onClick={stop}
          className={`absolute bottom-full left-0 z-10 mb-1 flex items-center gap-1 rounded-full border p-1 shadow-lg ${variantClasses.popover}`}
        >
          {REACTION_EMOJIS.map((emoji) => {
            const count = counts[emoji] ?? 0;
            const isMine = mine.has(emoji);
            return (
              <button
                key={emoji}
                type="button"
                onClick={(e) => handleSelect(emoji, e)}
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
      ) : null}
    </div>
  );
}
