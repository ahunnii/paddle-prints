#!/usr/bin/env node
// =============================================================================
// Paddle Prints -- offline layer unit tests (scripts/test-offline.mjs)
// =============================================================================
// Pure-logic tests for the Phase 6 offline layer, run under plain Node via tsx
// with fake-indexeddb standing in for the browser's IndexedDB. Covers:
//   1. tile enumeration for a known corridor (count + all-intersect sanity)
//   2. tile refcount delete (two overlapping trips share tiles)
//   3. sync queue state machine (success / network-retain / validation-deadletter / latch)
//   4. misc-tile LRU eviction (and that refcounted tiles are never evicted)
//   5. read-through cache behaviour (hit / offline-miss / online-miss write-through)
//
//   pnpm test:offline
// =============================================================================
import "fake-indexeddb/auto";

import {
  enumerateTiles,
  corridorPolygon,
  OFFLINE_MIN_ZOOM,
  OFFLINE_MAX_ZOOM,
} from "../src/lib/offline/tile-enum.ts";
import { db, __resetDbForTests } from "../src/lib/offline/db.ts";
import {
  downloadTile,
  releaseTrip,
  readTile,
  evictMiscToBudget,
  miscBytes,
} from "../src/lib/offline/tile-cache.ts";
import { queuePaddle, syncQueue, pendingCounts } from "../src/lib/offline/sync.ts";

// ---------------------------------------------------------------------------
// tiny test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n── ${title}`);
}

async function resetDb() {
  try {
    await db().delete();
  } catch {
    /* nothing to delete yet */
  }
  __resetDbForTests();
}

// ---------------------------------------------------------------------------
// geo helper: slippy-map tile bbox, to independently verify intersection
// ---------------------------------------------------------------------------
function tileBBox(z, x, y) {
  const n = 2 ** z;
  const lon1 = (x / n) * 360 - 180;
  const lon2 = ((x + 1) / n) * 360 - 180;
  const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const lat2 =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return [lon1, Math.min(lat1, lat2), lon2, Math.max(lat1, lat2)];
}

function polygonBBox(geom) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const rings =
    geom.type === "MultiPolygon" ? geom.coordinates.flat() : geom.coordinates;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function bboxIntersect(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function buf(n = 32) {
  return new ArrayBuffer(n);
}

async function main() {
  // -------------------------------------------------------------------------
  // 1. tile enumeration
  // -------------------------------------------------------------------------
  section("1. tile enumeration for a known Huron-ish corridor");
  {
    // ~6 km line near the Huron River, Ann Arbor.
    const coords = [
      [-83.75, 42.28],
      [-83.72, 42.29],
      [-83.68, 42.31],
    ];
    const tiles = enumerateTiles(coords);
    const zooms = new Set(tiles.map((t) => t.z));

    check("produced a non-trivial tile set", tiles.length > 10, `count=${tiles.length}`);
    check(
      `all zooms ${OFFLINE_MIN_ZOOM}..${OFFLINE_MAX_ZOOM} present`,
      [10, 11, 12, 13, 14].every((z) => zooms.has(z)),
      `zooms=${[...zooms].sort((a, b) => a - b).join(",")}`,
    );
    check(
      "no zoom outside 10..14",
      [...zooms].every((z) => z >= 10 && z <= 14),
      `zooms=${[...zooms].join(",")}`,
    );
    check("keys are unique", new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size === tiles.length);

    const corridorBox = polygonBBox(corridorPolygon(coords));
    const allIntersect = tiles.every((t) =>
      bboxIntersect(tileBBox(t.z, t.x, t.y), corridorBox),
    );
    check("every tile bbox intersects the corridor bbox", allIntersect);

    // Higher zooms have (many) more tiles than lower zooms for the same corridor.
    const countAt = (z) => tiles.filter((t) => t.z === z).length;
    check(
      "tile count grows with zoom (z14 > z10)",
      countAt(14) > countAt(10),
      `z10=${countAt(10)} z14=${countAt(14)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. refcount delete
  // -------------------------------------------------------------------------
  section("2. tile refcount delete across two overlapping trips");
  {
    await resetDb();
    const fm = async () => buf(64);

    const tripA = ["14/100/100", "14/100/101", "14/101/101"];
    const tripB = ["14/100/101", "14/101/101", "14/102/102"]; // overlaps last two
    for (const k of tripA) await downloadTile(k, fm, "A");
    for (const k of tripB) await downloadTile(k, fm, "B");

    const shared = await db().tiles.get("14/100/101");
    check(
      "shared tile is refcounted by both trips",
      shared.routeIds.length === 2 &&
        shared.routeIds.includes("A") &&
        shared.routeIds.includes("B"),
      JSON.stringify(shared.routeIds),
    );

    await releaseTrip("A");
    const soleA = await db().tiles.get("14/100/100");
    const stillShared = await db().tiles.get("14/100/101");
    const stillShared2 = await db().tiles.get("14/101/101");
    const soleB = await db().tiles.get("14/102/102");
    check("deleting A removes A-only tile", soleA === undefined);
    check(
      "deleting A keeps shared tile (now B-only)",
      !!stillShared && stillShared.routeIds.length === 1 && stillShared.routeIds[0] === "B",
      JSON.stringify(stillShared?.routeIds),
    );
    check("second shared tile also kept for B", !!stillShared2);
    check("B-only tile untouched by A delete", !!soleB);

    await releaseTrip("B");
    const remaining = await db().tiles.count();
    check("deleting B removes everything", remaining === 0, `remaining=${remaining}`);
  }

  // -------------------------------------------------------------------------
  // 3. sync queue state machine
  // -------------------------------------------------------------------------
  section("3. sync queue state machine");
  {
    await resetDb();
    // success removes both rows
    await queuePaddle({ id: "11111111-1111-1111-1111-111111111111", distanceM: 1 });
    await queuePaddle({ id: "22222222-2222-2222-2222-222222222222", distanceM: 2 });
    const sends = [];
    const okDeps = {
      sendPaddle: async (input) => sends.push(input.id),
      sendPoi: async () => {},
    };
    const r1 = await syncQueue(okDeps);
    const after = await pendingCounts();
    check("success sends both", r1.sent === 2, JSON.stringify(r1));
    check("success removes both rows", after.paddles === 0, `paddles=${after.paddles}`);
    check("each row sent exactly once", sends.length === 2 && new Set(sends).size === 2);
  }

  {
    await resetDb();
    // network failure retains the row for retry
    await queuePaddle({ id: "33333333-3333-3333-3333-333333333333", distanceM: 3 });
    const netDeps = {
      sendPaddle: async () => {
        throw new Error("Failed to fetch"); // no httpStatus -> transient
      },
      sendPoi: async () => {},
    };
    const r = await syncQueue(netDeps);
    const after = await pendingCounts();
    check("network fail retains", r.retained === 1 && r.sent === 0, JSON.stringify(r));
    check("row still queued after network fail", after.paddles === 1);
    check("row not dead-lettered", after.deadLettered === 0);
  }

  {
    await resetDb();
    // 4xx validation failure dead-letters the row (and is skipped thereafter)
    await queuePaddle({ id: "44444444-4444-4444-4444-444444444444", distanceM: 4 });
    let calls = 0;
    const badDeps = {
      sendPaddle: async () => {
        calls++;
        const err = new Error("Bad input");
        err.data = { httpStatus: 400 };
        throw err;
      },
      sendPoi: async () => {},
    };
    const r1 = await syncQueue(badDeps);
    const after1 = await pendingCounts();
    check("validation fail dead-letters", r1.deadLettered === 1, JSON.stringify(r1));
    check("dead-lettered row surfaces in counts", after1.deadLettered === 1);
    const r2 = await syncQueue(badDeps);
    check("dead-lettered row is not retried", calls === 1, `calls=${calls}`);
    check("second drain does nothing", r2.sent === 0 && r2.deadLettered === 0);
  }

  {
    await resetDb();
    // concurrent-call latch: two overlapping drains share one run; each row sent once
    await queuePaddle({ id: "55555555-5555-5555-5555-555555555555", distanceM: 5 });
    await queuePaddle({ id: "66666666-6666-6666-6666-666666666666", distanceM: 6 });
    let invocations = 0;
    const slowDeps = {
      sendPaddle: async () => {
        invocations++;
        await new Promise((res) => setTimeout(res, 20));
      },
      sendPoi: async () => {},
    };
    const p1 = syncQueue(slowDeps);
    const p2 = syncQueue(slowDeps); // fired before p1 resolves
    check("overlapping calls share one in-flight drain", p1 === p2);
    await Promise.all([p1, p2]);
    check("latch prevents double-send", invocations === 2, `invocations=${invocations}`);
    const after = await pendingCounts();
    check("both rows sent exactly once", after.paddles === 0);
  }

  // -------------------------------------------------------------------------
  // 4. misc-tile LRU eviction
  // -------------------------------------------------------------------------
  section("4. misc-tile LRU eviction (refcounted tiles never evicted)");
  {
    await resetDb();
    const now = Date.now();
    // three misc tiles (oldest first) + one refcounted "downloaded" tile that must survive.
    await db().tiles.put({ key: "m1", bytes: buf(100), size: 100, routeIds: [], lastAccess: now + 1 });
    await db().tiles.put({ key: "m2", bytes: buf(100), size: 100, routeIds: [], lastAccess: now + 2 });
    await db().tiles.put({ key: "m3", bytes: buf(100), size: 100, routeIds: [], lastAccess: now + 3 });
    await db().tiles.put({ key: "d1", bytes: buf(1000), size: 1000, routeIds: ["A"], lastAccess: now });

    check("misc bytes counts only un-refcounted tiles", (await miscBytes()) === 300);

    await evictMiscToBudget(150); // must drop m1 then m2, keep m3
    const m1 = await db().tiles.get("m1");
    const m2 = await db().tiles.get("m2");
    const m3 = await db().tiles.get("m3");
    const d1 = await db().tiles.get("d1");
    check("evicts least-recently-used misc first", m1 === undefined && m2 === undefined);
    check("keeps most-recently-used misc within budget", !!m3);
    check("never evicts refcounted (downloaded) tiles", !!d1);
    check("misc now within budget", (await miscBytes()) <= 150);
  }

  // -------------------------------------------------------------------------
  // 5. read-through cache behaviour
  // -------------------------------------------------------------------------
  section("5. read-through cache behaviour");
  {
    await resetDb();
    let fetches = 0;
    const fm = async () => {
      fetches++;
      return buf(48);
    };

    // offline + uncached -> null, no fetch
    const offlineMiss = await readTile("14/5/5", fm, false);
    check("offline miss returns blank (null)", offlineMiss === null);
    check("offline miss does not fetch", fetches === 0);

    // online + uncached -> fetch + write-through as misc
    const onlineMiss = await readTile("14/5/5", fm, true);
    check("online miss returns bytes", onlineMiss instanceof Uint8Array && onlineMiss.byteLength === 48);
    check("online miss fetched once", fetches === 1);
    const stored = await db().tiles.get("14/5/5");
    check("online miss writes a misc tile", !!stored && stored.routeIds.length === 0);

    // subsequent read -> cache hit, no fetch
    const hit = await readTile("14/5/5", fm, false);
    check("cache hit returns bytes offline", hit instanceof Uint8Array && hit.byteLength === 48);
    check("cache hit does not fetch", fetches === 1);
  }

  // -------------------------------------------------------------------------
  console.log(`\n${failed === 0 ? "✅" : "❌"} offline: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
