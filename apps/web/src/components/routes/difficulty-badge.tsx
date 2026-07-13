export const DIFFICULTY_OPTIONS = ["easy", "moderate", "challenging", "hard"] as const;
export type Difficulty = (typeof DIFFICULTY_OPTIONS)[number];

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-emerald-500/15 text-emerald-600",
  moderate: "bg-blue-500/15 text-blue-600",
  challenging: "bg-amber-500/15 text-amber-600",
  hard: "bg-red-500/15 text-red-600",
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface DifficultyBadgeProps {
  difficulty: string | null;
  className?: string;
}

/** Small rounded-full difficulty pill. Renders nothing when `difficulty` is null. Colors are
 * translucent-bg + strong-text so they read on both white cards and dark/blurred backgrounds. */
export function DifficultyBadge({ difficulty, className }: DifficultyBadgeProps) {
  if (!difficulty) return null;
  const style = DIFFICULTY_STYLES[difficulty] ?? "bg-river-500/15 text-river-600";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${style} ${className ?? ""}`}
    >
      {capitalize(difficulty)}
    </span>
  );
}
