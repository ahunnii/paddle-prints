/**
 * Loads and mutates the vendored MapLibre style JSON for native rendering. The Next app
 * (env.EXPO_PUBLIC_API_URL) serves the raw style + sprite + glyph statics under `/map/*`; the
 * PMTiles archive (env.EXPO_PUBLIC_TILES_URL) is served separately. The shipped style.json carries
 * placeholder/root-relative URLs that we rewrite at runtime, in one of two modes:
 *
 *   ONLINE (default):
 *   - `sources.openmaptiles.url` -> `pmtiles://${TILES_URL}` (MLRN v11 has native pmtiles:// support)
 *   - `sprite`  "/map/sprite/osm-liberty"          -> `${API_URL}/map/sprite/osm-liberty`
 *   - `glyphs`  "/map/glyphs/{fontstack}/{range}.pbf" -> `${API_URL}/map/glyphs/{fontstack}/{range}.pbf`
 *
 *   OFFLINE (a downloaded trip, via `opts.offlineTripPath`, OR a network-failure fallback):
 *   - `sources.openmaptiles.url` -> `pmtiles://file://<local .pmtiles>` (the per-trip archive)
 *   - `sprite`/`glyphs` -> `file://…/map/*` (the assets ../offline-assets persisted on download)
 *
 * RESILIENCE: on every successful ONLINE style fetch we persist the raw JSON to
 * `documentDirectory/map/<file>`; if a later fetch FAILS (no signal), we fall back to that persisted
 * copy and force the local glyph/sprite rewrites, so any map keeps working offline within whatever
 * tiles are available rather than throwing. The persisted copy is always the RAW server JSON, so the
 * rewrites are applied identically whether the JSON came from the network or from disk.
 *
 * The sprite/glyph rewrites use plain string concatenation (NOT `new URL()`) so the
 * `{fontstack}`/`{range}` template placeholders in the glyphs URL survive un-encoded -- same
 * approach as apps/web/src/components/map/base-map.tsx.
 *
 * The mutated style is memoized per (variant + offline-ness) so remounting a map (tab switches,
 * detail screens) doesn't refetch or re-mutate it. Network-failure fallbacks are intentionally NOT
 * memoized, so reconnecting recovers the online map on the next mount.
 */
import {
  LogManager,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";
import { Directory, File, Paths } from "expo-file-system";

import { env } from "../../env";
import { offlineMapAssetUrls } from "./offline-assets";

// The vendored Noto glyph set only covers the Latin-ish ranges the web app ships
// (0-1279); labels that ask for anything beyond that (symbols, CJK) 404 against the
// glyph server and MapLibre Native logs an error for each miss. Those characters
// simply don't render -- same silent behavior as the web map -- so suppress this one
// benign message class instead of letting dev LogBox treat it as a red-screen error.
LogManager.onLog(
  (event) =>
    event.message.includes("Failed to load glyph range") &&
    event.message.includes("HTTP status code 404"),
);

export type MapStyleVariant = "default" | "nav";

export interface GetMapStyleOptions {
  /**
   * Absolute `file://` URI of a downloaded per-trip `.pmtiles` archive. When set, the style renders
   * fully offline: tiles from this archive, glyphs/sprite from the persisted local assets.
   */
  offlineTripPath?: string;
}

const STYLE_FILE: Record<MapStyleVariant, string> = {
  default: "style.json",
  nav: "style-nav.json",
};

const ATTRIBUTION = "© OpenStreetMap contributors © OpenMapTiles";

/** Memo keyed by `${variant}|${offlineTripPath ?? "online"}`. */
const cache: Record<string, StyleSpecification> = {};

/** The `documentDirectory/map` directory that ../offline-assets mirrors the `/map/*` statics into. */
function mapDir(): Directory {
  return new Directory(Paths.document, "map");
}

/** Persist the raw style JSON for offline fallback. Best-effort: a write failure never breaks load. */
function persistRawStyle(styleFile: string, raw: string): void {
  try {
    const dir = mapDir();
    dir.create({ intermediates: true, idempotent: true });
    new File(dir, styleFile).write(raw);
  } catch {
    // No offline fallback for this file yet -- not fatal.
  }
}

/** The persisted raw style JSON, or null if none has been cached (or it can't be read). */
function readPersistedStyle(styleFile: string): string | null {
  try {
    const file = new File(mapDir(), styleFile);
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

export async function getMapStyle(
  variant: MapStyleVariant = "default",
  opts: GetMapStyleOptions = {},
): Promise<StyleSpecification> {
  const key = `${variant}|${opts.offlineTripPath ?? "online"}`;
  const cached = cache[key];
  if (cached) return cached;

  const apiUrl = env.EXPO_PUBLIC_API_URL;
  const tilesUrl = env.EXPO_PUBLIC_TILES_URL;
  const styleFile = STYLE_FILE[variant];

  let style: StyleSpecification;
  let usedFallback = false;

  try {
    const res = await fetch(`${apiUrl}/map/${styleFile}`);
    if (!res.ok) {
      throw new Error(`Failed to load map style (${res.status})`);
    }
    const raw = await res.text();
    persistRawStyle(styleFile, raw);
    style = JSON.parse(raw) as StyleSpecification;
  } catch (err) {
    const persisted = readPersistedStyle(styleFile);
    if (persisted == null) {
      throw err instanceof Error ? err : new Error("Couldn't load the map");
    }
    style = JSON.parse(persisted) as StyleSpecification;
    usedFallback = true;
  }

  // Local glyph/sprite whenever tiles are local (a trip download) OR we're offline (fallback).
  const useLocalAssets = !!opts.offlineTripPath || usedFallback;

  const source = style.sources.openmaptiles;
  if (source && source.type === "vector" && "url" in source) {
    if (opts.offlineTripPath) {
      const uri = opts.offlineTripPath.startsWith("file://")
        ? opts.offlineTripPath
        : `file://${opts.offlineTripPath}`;
      source.url = `pmtiles://${uri}`;
    } else {
      source.url = `pmtiles://${tilesUrl}`;
    }
    // MapLibre native surfaces per-source attribution through the (i) attribution button.
    source.attribution = ATTRIBUTION;
  }

  if (useLocalAssets) {
    const { glyphs, sprite } = offlineMapAssetUrls();
    style.glyphs = glyphs;
    style.sprite = sprite;
  } else {
    if (typeof style.sprite === "string" && style.sprite.startsWith("/")) {
      style.sprite = apiUrl + style.sprite;
    }
    if (typeof style.glyphs === "string" && style.glyphs.startsWith("/")) {
      style.glyphs = apiUrl + style.glyphs;
    }
  }

  // Cache successful loads (online, or an explicit offline trip); never cache a network-failure
  // fallback, so a reconnect restores the online map on the next mount.
  if (!usedFallback) cache[key] = style;
  return style;
}
