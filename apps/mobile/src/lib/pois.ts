/**
 * Minimal POI display metadata for the recorder's next-POI-ahead banner (record.tsx). Mirrors
 * apps/web/src/lib/pois.ts's `poiMeta`/`truncateNote`, trimmed to what the stats-first mobile
 * recorder needs -- no map markers in this phase (maps land in Phase 3), so no ring color here.
 */

export interface PoiCategoryMeta {
  category: string;
  emoji: string;
  label: string;
}

const POI_CATEGORIES: PoiCategoryMeta[] = [
  { category: "hazard", emoji: "⚠️", label: "Hazard" },
  { category: "wildlife", emoji: "🐢", label: "Wildlife" },
  { category: "dock", emoji: "⚓", label: "Dock" },
  { category: "portage", emoji: "🚶", label: "Portage" },
  { category: "campsite", emoji: "⛺", label: "Campsite" },
  { category: "scenic", emoji: "🌅", label: "Scenic" },
  { category: "other", emoji: "📍", label: "Other" },
];

const POI_CATEGORY_MAP: Record<string, PoiCategoryMeta> = Object.fromEntries(
  POI_CATEGORIES.map((c) => [c.category, c]),
);

/** Look up display metadata for a category, falling back to "other" for anything unrecognized. */
export function poiMeta(category: string): PoiCategoryMeta {
  return POI_CATEGORY_MAP[category] ?? POI_CATEGORY_MAP.other!;
}

/** Truncate a note for space-constrained UI (e.g. the next-POI banner). */
export function truncateNote(note: string, maxLen = 32): string {
  return note.length > maxLen ? `${note.slice(0, maxLen - 1)}…` : note;
}
