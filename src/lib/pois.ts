/**
 * The single source of truth for how a POI category is presented: emoji, label, and ring color.
 * Used everywhere a POI shows up -- map markers, the route-detail list, and the nav banner -- so the
 * same category always looks the same across the app.
 */

export type PoiCategory =
  | "hazard"
  | "wildlife"
  | "dock"
  | "portage"
  | "campsite"
  | "scenic"
  | "other";

export interface PoiCategoryMeta {
  category: PoiCategory;
  emoji: string;
  label: string;
  /** Hex color used for the marker's ring / accent. */
  color: string;
}

export const POI_CATEGORIES: PoiCategoryMeta[] = [
  { category: "hazard", emoji: "⚠️", label: "Hazard", color: "#ef4444" },
  { category: "wildlife", emoji: "🐢", label: "Wildlife", color: "#16a34a" },
  { category: "dock", emoji: "⚓", label: "Dock", color: "#2b93b3" },
  { category: "portage", emoji: "🚶", label: "Portage", color: "#f59e0b" },
  { category: "campsite", emoji: "⛺", label: "Campsite", color: "#15803d" },
  { category: "scenic", emoji: "🌅", label: "Scenic", color: "#f97316" },
  { category: "other", emoji: "📍", label: "Other", color: "#6b7280" },
];

const POI_CATEGORY_MAP: Record<PoiCategory, PoiCategoryMeta> = Object.fromEntries(
  POI_CATEGORIES.map((c) => [c.category, c]),
) as Record<PoiCategory, PoiCategoryMeta>;

/** Look up display metadata for a category, falling back to "other" for anything unrecognized. */
export function poiMeta(category: string): PoiCategoryMeta {
  return POI_CATEGORY_MAP[category as PoiCategory] ?? POI_CATEGORY_MAP.other;
}

/** The headline shown for a POI: its note if it has one, else the category label. */
export function poiHeadline(poi: { category: string; note?: string | null }): string {
  return poi.note && poi.note.trim().length > 0 ? poi.note : poiMeta(poi.category).label;
}

/** Truncate a note for space-constrained UI (e.g. the nav banner). */
export function truncateNote(note: string, maxLen = 32): string {
  return note.length > maxLen ? `${note.slice(0, maxLen - 1)}…` : note;
}
