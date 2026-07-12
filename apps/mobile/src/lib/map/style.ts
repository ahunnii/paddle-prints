/**
 * Loads and mutates the vendored MapLibre style JSON for native rendering. The Next app
 * (env.EXPO_PUBLIC_API_URL) serves the raw style + sprite + glyph statics under `/map/*`; the
 * PMTiles archive (env.EXPO_PUBLIC_TILES_URL) is served separately. The shipped style.json carries
 * placeholder/root-relative URLs that we rewrite at runtime:
 *
 *   - `sources.openmaptiles.url` -> `pmtiles://${TILES_URL}` (MLRN v11 has native pmtiles:// support)
 *   - `sprite`  "/map/sprite/osm-liberty"          -> `${API_URL}/map/sprite/osm-liberty`
 *   - `glyphs`  "/map/glyphs/{fontstack}/{range}.pbf" -> `${API_URL}/map/glyphs/{fontstack}/{range}.pbf`
 *
 * The sprite/glyph rewrites use plain string concatenation (NOT `new URL()`) so the
 * `{fontstack}`/`{range}` template placeholders in the glyphs URL survive un-encoded -- same
 * approach as apps/web/src/components/map/base-map.tsx.
 *
 * The mutated style is memoized per variant so remounting a map (tab switches, detail screens)
 * doesn't refetch or re-mutate it.
 */
import type { StyleSpecification } from "@maplibre/maplibre-react-native";

import { env } from "../../env";

export type MapStyleVariant = "default" | "nav";

const STYLE_FILE: Record<MapStyleVariant, string> = {
  default: "style.json",
  nav: "style-nav.json",
};

const ATTRIBUTION = "© OpenStreetMap contributors © OpenMapTiles";

const cache: Partial<Record<MapStyleVariant, StyleSpecification>> = {};

export async function getMapStyle(
  variant: MapStyleVariant = "default",
): Promise<StyleSpecification> {
  const cached = cache[variant];
  if (cached) return cached;

  const apiUrl = env.EXPO_PUBLIC_API_URL;
  const tilesUrl = env.EXPO_PUBLIC_TILES_URL;

  const res = await fetch(`${apiUrl}/map/${STYLE_FILE[variant]}`);
  if (!res.ok) {
    throw new Error(`Failed to load map style (${res.status})`);
  }
  const style = (await res.json()) as StyleSpecification;

  const source = style.sources.openmaptiles;
  if (source && source.type === "vector" && "url" in source) {
    source.url = `pmtiles://${tilesUrl}`;
    // MapLibre native surfaces per-source attribution through the (i) attribution button.
    source.attribution = ATTRIBUTION;
  }

  if (typeof style.sprite === "string" && style.sprite.startsWith("/")) {
    style.sprite = apiUrl + style.sprite;
  }
  if (typeof style.glyphs === "string" && style.glyphs.startsWith("/")) {
    style.glyphs = apiUrl + style.glyphs;
  }

  cache[variant] = style;
  return style;
}
