/**
 * Emoji reaction row for a paddle: every `REACTION_EMOJIS` entry as a pressable rounded-full chip,
 * with the count shown once it's > 0 and the chip highlighted when the signed-in user is one of the
 * reactors. Optimistic toggle -- local state seeds from the `reactions`/`myReactions` props once,
 * flips immediately on press, and reconciles from the mutation's fresh summary (or reverts on
 * error). Shared by the feed (`compact`, inside a card that's itself pressable -- see the note on
 * `Pressable` nesting below) and the paddle detail screen (full row).
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { REACTION_EMOJIS, type ReactionEmoji } from "@paddle-prints/api/constants";

import { api } from "../../lib/trpc";

export interface ReactionBarProps {
  paddleId: string;
  reactions: Record<string, number>;
  myReactions: string[];
  /** Smaller chips; only emoji with a count show by default, plus a "+" chip that reveals the rest.
   * Used on feed cards, which are themselves wrapped in a navigating `Pressable` -- RN's touch
   * responder system hands the gesture to the innermost `Pressable` under the finger, so tapping a
   * reaction chip fires only the chip's `onPress`, never the card's. No extra stopPropagation needed. */
  compact?: boolean;
}

export function ReactionBar({
  paddleId,
  reactions,
  myReactions,
  compact = false,
}: ReactionBarProps) {
  const [counts, setCounts] = useState(reactions);
  const [mine, setMine] = useState(() => new Set(myReactions));
  const [expanded, setExpanded] = useState(false);
  const toggle = api.social.reactionToggle.useMutation();

  function press(emoji: ReactionEmoji) {
    const prevCounts = counts;
    const prevMine = mine;
    const alreadyMine = mine.has(emoji);

    const nextCounts = {
      ...counts,
      [emoji]: Math.max(0, (counts[emoji] ?? 0) + (alreadyMine ? -1 : 1)),
    };
    const nextMine = new Set(mine);
    if (alreadyMine) nextMine.delete(emoji);
    else nextMine.add(emoji);
    setCounts(nextCounts);
    setMine(nextMine);

    toggle.mutate(
      { paddleId, emoji },
      {
        onSuccess: (result) => {
          setCounts(result.counts);
          setMine(new Set(result.mine));
        },
        onError: () => {
          // Revert to the pre-tap state -- the mutation's own error surfaces elsewhere (or not at
          // all here, this stays best-effort per the "keep it simple" brief).
          setCounts(prevCounts);
          setMine(prevMine);
        },
      },
    );
  }

  const collapsedToCounted = compact && !expanded;
  const visibleEmojis = collapsedToCounted
    ? REACTION_EMOJIS.filter((emoji) => (counts[emoji] ?? 0) > 0)
    : REACTION_EMOJIS;
  const hasMoreToExpand = visibleEmojis.length < REACTION_EMOJIS.length;

  const chipClass = compact
    ? "flex-row items-center gap-0.5 rounded-full px-2 py-1"
    : "flex-row items-center gap-1 rounded-full px-3 py-1.5";
  const emojiClass = compact ? "text-xs" : "text-base";
  const countClass = compact ? "text-[11px] font-bold" : "text-xs font-bold";

  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      {visibleEmojis.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const active = mine.has(emoji);
        return (
          <Pressable
            key={emoji}
            onPress={() => press(emoji)}
            className={`${chipClass} ${active ? "bg-river-600" : "bg-river-100"}`}
          >
            <Text className={emojiClass}>{emoji}</Text>
            {count > 0 ? (
              <Text
                className={`${countClass} ${active ? "text-white" : "text-river-700"}`}
              >
                {count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}

      {collapsedToCounted && hasMoreToExpand ? (
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityLabel="Show all reactions"
          className="items-center justify-center rounded-full bg-river-100 px-2 py-1"
        >
          <Text className="text-xs font-bold text-river-600">+</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
