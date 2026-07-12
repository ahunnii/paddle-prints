/// <reference lib="webworker" />
/// <reference types="@serwist/next/typings" />

/**
 * The Paddle Prints service worker (Serwist). Precaches the Next.js app shell so the app boots with
 * no network, and adds runtime caching for the map assets that back the offline map. Map *tiles* are
 * NOT cached here -- they go through the pmtiles protocol layer into IndexedDB (see tile-cache.ts),
 * which gives per-trip accounting and dodges Safari's unreliable service-worker Range handling.
 *
 * `skipWaiting` is intentionally false: a new worker waits until the user taps the update toast, and
 * the client suppresses that toast entirely while a paddle is recording (see update-toast.tsx).
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const mapCaching: RuntimeCaching[] = [
  {
    matcher: /\/map\/glyphs\/.*/i,
    handler: new CacheFirst({ cacheName: "map-glyphs" }),
  },
  {
    matcher: /\/map\/sprite\/.*/i,
    handler: new CacheFirst({ cacheName: "map-sprite" }),
  },
  {
    matcher: /\/map\/style[^/]*\.json$/i,
    handler: new StaleWhileRevalidate({ cacheName: "map-style" }),
  },
  {
    // tRPC and all API traffic is never cached -- always straight to the network.
    matcher: ({ url }) => url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
];

const manifest = self.__SW_MANIFEST ?? [];

// The fallbacks option serves entries via matchPrecache(), but @serwist/next's injected
// manifest only contains static build assets — the /offline HTML document must be added to
// the precache explicitly or offline navigations 404. The revision is a deterministic hash
// of the manifest: stable across SW restarts, changed on every build (so the cached shell
// never references stale hashed chunks).
const offlineRevision = (() => {
  const s = JSON.stringify(manifest);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
})();

const serwist = new Serwist({
  precacheEntries: [...manifest, { url: "/offline", revision: offlineRevision }],
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...mapCaching, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
