/**
 * A small rounded-full pill showing a route's difficulty. Mirrors the color mapping used on web
 * (apps/web -- easy/moderate/challenging/hard) with a translucent background + strong text so it
 * reads clearly over both white cards and the map's route-detail header. Renders nothing for a null
 * difficulty (most routes don't have one set) rather than a placeholder pill.
 */
import { Text, View } from "react-native";

export type RouteDifficulty = "easy" | "moderate" | "challenging" | "hard" | null;

const DIFFICULTY_META: Record<
  Exclude<RouteDifficulty, null>,
  { label: string; bgClassName: string; textClassName: string }
> = {
  easy: {
    label: "Easy",
    bgClassName: "bg-emerald-100/80",
    textClassName: "text-emerald-700",
  },
  moderate: {
    label: "Moderate",
    bgClassName: "bg-blue-100/80",
    textClassName: "text-blue-700",
  },
  challenging: {
    label: "Challenging",
    bgClassName: "bg-amber-100/80",
    textClassName: "text-amber-700",
  },
  hard: {
    label: "Hard",
    bgClassName: "bg-red-100/80",
    textClassName: "text-red-700",
  },
};

export function DifficultyBadge({ difficulty }: { difficulty: RouteDifficulty }) {
  if (!difficulty) return null;

  const meta = DIFFICULTY_META[difficulty];

  return (
    <View className={`self-start rounded-full px-2.5 py-1 ${meta.bgClassName}`}>
      <Text className={`text-xs font-bold ${meta.textClassName}`}>{meta.label}</Text>
    </View>
  );
}
