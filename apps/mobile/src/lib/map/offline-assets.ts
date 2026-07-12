/**
 * Persists the non-tile half of the map (style JSON + glyph atlases + sprite sheet) to the device so
 * a downloaded trip renders with ZERO network. The PMTiles archive alone isn't enough: MapLibre also
 * needs the style document, the glyph PBFs for every label font/range, and the sprite images for any
 * icon layers. The web app serves all of these as public statics under `${API_URL}/map/*`; here we
 * mirror that tree verbatim into `documentDirectory/map/` so the local-file rewrites in ../map/style
 * resolve offline.
 *
 * Layout mirrored (exactly the paths MapLibre requests once the glyphs/sprite templates are rewritten
 * to `file://` — see `offlineMapAssetUrls`):
 *   map/style.json, map/style-nav.json
 *   map/glyphs/<fontstack>/<range>.pbf        (3 stacks x 5 ranges = 15 files)
 *   map/sprite/osm-liberty(.json|.png|@2x.json|@2x.png)
 *
 * The font stacks contain spaces ("Noto Sans Regular"); the SERVER request URL-encodes them (%20)
 * but the on-disk folder keeps the literal space, because MapLibre substitutes the raw `{fontstack}`
 * (with spaces) into the file:// glyphs URL when it requests a range.
 *
 * expo-file-system (SDK 57 new API) used here: `File.downloadFileAsync(url, destFile, { idempotent })`
 * streams a URL straight to a file; `new Directory(...).create({ intermediates, idempotent })` makes
 * the folder tree. Verified against node_modules/expo-file-system/build/{File,Directory}.d.ts.
 */
import { Directory, File, Paths } from "expo-file-system";
import Storage from "expo-sqlite/kv-store";

import { env } from "../../env";

/** The Latin-ish Noto stacks the vendored style references (matches apps/web/public/map/glyphs/*). */
const GLYPH_STACKS = [
  "Noto Sans Regular",
  "Noto Sans Medium",
  "Noto Sans Italic",
] as const;

/** The glyph ranges the web app ships (0-1279); anything beyond 404s and simply doesn't render. */
const GLYPH_RANGES = [
  "0-255",
  "256-511",
  "512-767",
  "768-1023",
  "1024-1279",
] as const;

const SPRITE_FILES = [
  "osm-liberty.json",
  "osm-liberty.png",
  "osm-liberty@2x.json",
  "osm-liberty@2x.png",
] as const;

const STYLE_FILES = ["style.json", "style-nav.json"] as const;

/**
 * kv-store marker so a second trip download (or a remount) doesn't re-fetch 21 files needlessly.
 * Bump `ASSET_VERSION` if the vendored style/glyphs/sprite ever change so clients refresh.
 */
const MARKER_KEY = "paddle-prints-offline-map-assets";
const ASSET_VERSION = 1;

/** The `documentDirectory/map` base as a `file://` URI, with any trailing slash normalized off. */
function mapDirUri(): string {
  return new Directory(Paths.document, "map").uri.replace(/\/$/, "");
}

/**
 * The local `file://` URLs that ../map/style rewrites the style's `glyphs`/`sprite` to when rendering
 * offline. The glyphs URL keeps the `{fontstack}`/`{range}` template placeholders so MapLibre fills
 * them in per request (same templating the online URL uses).
 */
export function offlineMapAssetUrls(): { glyphs: string; sprite: string } {
  const base = mapDirUri();
  return {
    glyphs: `${base}/glyphs/{fontstack}/{range}.pbf`,
    sprite: `${base}/sprite/osm-liberty`,
  };
}

/** True once a full asset set at the current version has been persisted. */
function assetsMarked(): boolean {
  return Storage.getItemSync(MARKER_KEY) === String(ASSET_VERSION);
}

/**
 * Ensure the style/glyph/sprite tree is present under `documentDirectory/map`. No-op once persisted
 * unless `refresh` is passed (e.g. a future "update offline maps" action). Downloads are idempotent,
 * so a partially-completed previous run is simply re-completed. Public `/map/*` statics need no auth.
 */
export async function ensureOfflineMapAssets(opts?: {
  refresh?: boolean;
}): Promise<void> {
  if (assetsMarked() && !opts?.refresh) return;

  const apiUrl = env.EXPO_PUBLIC_API_URL;
  const mapDir = new Directory(Paths.document, "map");
  mapDir.create({ intermediates: true, idempotent: true });
  const glyphsDir = new Directory(mapDir, "glyphs");
  glyphsDir.create({ intermediates: true, idempotent: true });
  const spriteDir = new Directory(mapDir, "sprite");
  spriteDir.create({ intermediates: true, idempotent: true });

  const jobs: Promise<unknown>[] = [];

  for (const styleFile of STYLE_FILES) {
    jobs.push(
      File.downloadFileAsync(
        `${apiUrl}/map/${styleFile}`,
        new File(mapDir, styleFile),
        { idempotent: true },
      ),
    );
  }

  for (const stack of GLYPH_STACKS) {
    const stackDir = new Directory(glyphsDir, stack);
    stackDir.create({ intermediates: true, idempotent: true });
    for (const range of GLYPH_RANGES) {
      jobs.push(
        File.downloadFileAsync(
          `${apiUrl}/map/glyphs/${encodeURIComponent(stack)}/${range}.pbf`,
          new File(stackDir, `${range}.pbf`),
          { idempotent: true },
        ),
      );
    }
  }

  for (const name of SPRITE_FILES) {
    jobs.push(
      File.downloadFileAsync(
        `${apiUrl}/map/sprite/${name}`,
        new File(spriteDir, name),
        { idempotent: true },
      ),
    );
  }

  await Promise.all(jobs);
  Storage.setItemSync(MARKER_KEY, String(ASSET_VERSION));
}
