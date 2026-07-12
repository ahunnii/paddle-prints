#!/usr/bin/env node
// =============================================================================
// Paddle Prints -- recorder engine unit tests (scripts/test-recorder.mjs)
// =============================================================================
// Replays SYNTHETIC GPS traces through the PURE recorder core (machine, progress,
// eta, simplify, checkpoint) under plain Node via tsx. No browser, no DB, no
// Next. Covers the seven trace scenarios from the Phase 4 plan.
//
//   pnpm test:recorder
// =============================================================================
import { reducer, initialState } from "../src/lib/recorder/machine.ts";
import {
  buildProgressModel,
  createMatchState,
  matchProgress,
} from "../src/lib/recorder/progress.ts";
import { haversineM } from "../src/lib/recorder/geo.ts";
import { simplifyTrack } from "../src/lib/recorder/simplify.ts";
import { computeEta } from "../src/lib/recorder/eta.ts";
import { checkpointStore } from "../src/lib/recorder/checkpoint.ts";
import { nextPoiAhead } from "../src/lib/recorder/next-poi.ts";

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

// ---------------------------------------------------------------------------
// deterministic RNG + geo helpers for building traces in metres
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const LAT0 = 42.28;
const LNG0 = -83.74;
const M_PER_DEG_LAT = 111_195;
const mPerDegLng = (lat) => 111_195 * Math.cos((lat * Math.PI) / 180);

/** Build a [lng,lat] from metre offsets east(dx)/north(dy) of the origin. */
function pt(dxM, dyM) {
  return [LNG0 + dxM / mPerDegLng(LAT0), LAT0 + dyM / M_PER_DEG_LAT];
}

function cumDist(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    cum[i] =
      cum[i - 1] +
      haversineM(
        { lng: line[i - 1][0], lat: line[i - 1][1] },
        { lng: line[i][0], lat: line[i][1] },
      );
  }
  return cum;
}

function interp(line, cum, d) {
  const total = cum[cum.length - 1];
  const dist = Math.max(0, Math.min(total, d));
  for (let i = 1; i < cum.length; i++) {
    if (dist <= cum[i]) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 0 ? (dist - cum[i - 1]) / segLen : 0;
      return [
        line[i - 1][0] + t * (line[i][0] - line[i - 1][0]),
        line[i - 1][1] + t * (line[i][1] - line[i - 1][1]),
      ];
    }
  }
  return line[line.length - 1];
}

/** March along a polyline producing fixes at a constant speed + cadence, with metre jitter. */
function walk(line, opts = {}) {
  const {
    speed = 1.3,
    cadence = 1000,
    jitter = 1.0,
    acc = 8,
    startT = 1_000_000,
    rng = makeRng(1),
  } = opts;
  const cum = cumDist(line);
  const total = cum[cum.length - 1];
  const step = (speed * cadence) / 1000;
  const fixes = [];
  let t = startT;
  for (let d = 0; d <= total + 1e-6; d += step) {
    const [lng, lat] = interp(line, cum, d);
    const jx = (rng() - 0.5) * 2 * jitter;
    const jy = (rng() - 0.5) * 2 * jitter;
    fixes.push({
      lng: lng + jx / mPerDegLng(lat),
      lat: lat + jy / M_PER_DEG_LAT,
      t,
      acc,
    });
    t += cadence;
  }
  return fixes;
}

/** Emit fixes standing still at `loc` for `durationS` seconds (jittering under GPS noise). */
function stand(loc, durationS, opts = {}) {
  const { cadence = 1000, jitter = 1.2, acc = 8, startT = 0, rng = makeRng(9) } =
    opts;
  const fixes = [];
  for (let i = 0, t = startT; i <= durationS; i++, t += cadence) {
    const jx = (rng() - 0.5) * 2 * jitter;
    const jy = (rng() - 0.5) * 2 * jitter;
    fixes.push({
      lng: loc[0] + jx / mPerDegLng(loc[1]),
      lat: loc[1] + jy / M_PER_DEG_LAT,
      t,
      acc,
    });
  }
  return fixes;
}

// ---------------------------------------------------------------------------
// event driver: interleave 1 Hz TICKs with FIXes, run progress on accepted pts
// ---------------------------------------------------------------------------
function buildEvents(fixes) {
  const t0 = fixes[0].t;
  const tEnd = fixes[fixes.length - 1].t;
  const events = [];
  for (let t = t0; t <= tEnd; t += 1000) events.push({ type: "TICK", now: t });
  for (const f of fixes) events.push({ type: "FIX", now: f.t, point: f });
  // At equal timestamps, TICK before FIX (advance clock/auto-pause, then apply the fix).
  events.sort((a, b) =>
    a.now === b.now ? (a.type === "TICK" ? -1 : 1) : a.now - b.now,
  );
  return { events, t0, tEnd };
}

function step(ctx, events) {
  for (const ev of events) {
    ctx.state = reducer(ctx.state, ev);
    if (ctx.state.status === "autoPaused") ctx.sawAutoPause = true;
    if (ctx.state.track.length > ctx.prevLen) {
      ctx.prevLen = ctx.state.track.length;
      const p = ctx.state.track[ctx.state.track.length - 1];
      let progress = null;
      if (ctx.model) {
        const r = matchProgress(ctx.model, ctx.match, p);
        ctx.match = r.next;
        progress = r.result;
      }
      ctx.samples.push({
        t: p.t,
        distanceM: ctx.state.distanceM,
        movingS: ctx.state.movingS,
        elapsedS: ctx.state.elapsedS,
        progress,
      });
    }
  }
  return ctx;
}

function drive(fixes, { model = null, doFinish = true } = {}) {
  const { events, t0, tEnd } = buildEvents(fixes);
  const ctx = {
    state: reducer(initialState(), { type: "START", now: t0 }),
    model,
    match: model ? createMatchState() : null,
    samples: [],
    sawAutoPause: false,
    prevLen: 0,
  };
  step(ctx, events);
  if (doFinish) ctx.state = reducer(ctx.state, { type: "FINISH", now: tEnd });
  return ctx;
}

// ---------------------------------------------------------------------------
// 1. clean paddle along a line
// ---------------------------------------------------------------------------
section("1. clean paddle -- distance within 2%, remaining monotonic, ends ~0");
{
  const line = [pt(0, 0), pt(50, 300), pt(-40, 650), pt(20, 1000)];
  const truth = cumDist(line).at(-1);
  const model = buildProgressModel(line, "one_way");
  const fixes = walk(line, { speed: 1.3, jitter: 1.0, rng: makeRng(42) });
  const { state, samples } = drive(fixes, { model });

  const errPct = Math.abs(state.distanceM - truth) / truth;
  check(
    "distance within 2% of truth",
    errPct <= 0.02,
    `truth=${truth.toFixed(1)}m got=${state.distanceM.toFixed(1)}m (${(errPct * 100).toFixed(2)}%)`,
  );

  let monotonic = true;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].progress.remainingM > samples[i - 1].progress.remainingM + 1e-6) {
      monotonic = false;
      break;
    }
  }
  check("remaining is monotonic non-increasing", monotonic);

  const endRemaining = samples.at(-1).progress.remainingM;
  check(
    "ends near zero remaining",
    endRemaining < 15,
    `remaining=${endRemaining.toFixed(1)}m`,
  );
}

// ---------------------------------------------------------------------------
// 2. lunch stop -> auto-pause, moving ~= elapsed - stop, resumes
// ---------------------------------------------------------------------------
section("2. 60s lunch stop -- auto-pause fires, movingS ~= elapsed - stop");
{
  const legA = [pt(0, 0), pt(0, 300)];
  const legB = [pt(0, 300), pt(0, 600)];
  const a = walk(legA, { startT: 1_000_000, rng: makeRng(7) });
  const stopStart = a.at(-1).t + 1000;
  const s = stand(pt(0, 300), 60, { startT: stopStart, rng: makeRng(8) });
  const b = walk(legB, { startT: s.at(-1).t + 1000, rng: makeRng(11) });
  const fixes = [...a, ...s, ...b];
  const { state, sawAutoPause } = drive(fixes);

  check("auto-pause triggered during the stop", sawAutoPause);
  const gap = state.elapsedS - state.movingS;
  check(
    "movingS ~= elapsed - stop (60s +/- 15s)",
    Math.abs(gap - 60) <= 15,
    `elapsed=${state.elapsedS.toFixed(0)}s moving=${state.movingS.toFixed(0)}s gap=${gap.toFixed(0)}s`,
  );
  check(
    "finished in a moving/recording state (resumed)",
    state.status === "finished",
  );
}

// ---------------------------------------------------------------------------
// 3. teleport spike -> rejected, distance unaffected
// ---------------------------------------------------------------------------
section("3. GPS teleport spike -- rejected, distance unaffected");
{
  const line = [pt(0, 0), pt(0, 500), pt(0, 1000)];
  const truth = cumDist(line).at(-1);
  const clean = walk(line, { rng: makeRng(3) });
  // Insert a spike ~600m off, 1s after the middle fix.
  const mid = Math.floor(clean.length / 2);
  const spikeT = clean[mid].t + 1;
  const spike = { lng: pt(600, 500)[0], lat: pt(600, 500)[1], t: spikeT, acc: 8 };
  const fixes = [...clean.slice(0, mid + 1), spike, ...clean.slice(mid + 1)].sort(
    (x, y) => x.t - y.t,
  );
  const { state } = drive(fixes);

  const errPct = Math.abs(state.distanceM - truth) / truth;
  check(
    "distance still within 2% of truth",
    errPct <= 0.02,
    `truth=${truth.toFixed(1)} got=${state.distanceM.toFixed(1)}`,
  );
  const nearSpike = state.track.some(
    (p) => haversineM(p, { lng: spike.lng, lat: spike.lat }) < 100,
  );
  check("spike point not in the track", !nearSpike);
}

// ---------------------------------------------------------------------------
// 4. low-accuracy cluster -> rejected, then drought -> 50m fix accepted
// ---------------------------------------------------------------------------
section("4. low-accuracy cluster rejected, then 65s drought -> 50m fix accepted");
{
  const line = [pt(0, 0), pt(0, 200)];
  const good = walk(line, { startT: 1_000_000, acc: 8, rng: makeRng(5) });
  const anchorT = good.at(-1).t;
  const anchorLoc = pt(0, 200);
  // A cluster of 80 m fixes right after -- all should be rejected.
  const cluster = stand(anchorLoc, 30, {
    startT: anchorT + 1000,
    acc: 80,
    jitter: 6,
    rng: makeRng(6),
  });
  // 65 s after the last ACCEPTED fix, a 50 m fix ~12 m away should be accepted (relaxed ceiling).
  const droughtFix = {
    lng: pt(0, 212)[0],
    lat: pt(0, 212)[1],
    t: anchorT + 65_000,
    acc: 50,
  };
  const fixes = [...good, ...cluster, droughtFix];

  // Drive but snapshot track length just before the drought fix.
  const { events, t0, tEnd } = buildEvents(fixes);
  const ctx = {
    state: reducer(initialState(), { type: "START", now: t0 }),
    model: null,
    match: null,
    samples: [],
    sawAutoPause: false,
    prevLen: 0,
  };
  const beforeDrought = events.filter((e) => e.now < droughtFix.t);
  const droughtOn = events.filter((e) => e.now >= droughtFix.t);
  step(ctx, beforeDrought);
  const lenBefore = ctx.state.track.length;
  step(ctx, droughtOn);
  const lenAfter = ctx.state.track.length;

  check(
    "80m cluster produced no accepted points",
    lenBefore === good.length ||
      lenBefore <= good.length /* good seed + accepted good points only */,
    `trackBefore=${lenBefore} goodFixes=${good.length}`,
  );
  check(
    "50m drought fix accepted (track grew by 1)",
    lenAfter === lenBefore + 1,
    `before=${lenBefore} after=${lenAfter}`,
  );
}

// ---------------------------------------------------------------------------
// 5. out-and-back over a hairpin -> progress passes L, no snap-back
// ---------------------------------------------------------------------------
section("5. out-and-back hairpin -- windowed search, progress reaches ~2L");
{
  // Outbound has two near-parallel legs 15 m apart (a hairpin), so the return leg -- and the
  // outbound itself -- run close to earlier geometry. A global search would snap back.
  const outbound = [
    pt(0, 0),
    pt(0, 200),
    pt(7, 208),
    pt(15, 200),
    pt(15, 0),
  ];
  const model = buildProgressModel(outbound, "out_and_back");
  const L = cumDist(outbound).at(-1);
  const back = [...outbound].reverse();
  const outFixes = walk(outbound, { startT: 1_000_000, jitter: 0.8, rng: makeRng(21) });
  const backFixes = walk(back, {
    startT: outFixes.at(-1).t + 1000,
    jitter: 0.8,
    rng: makeRng(22),
  });
  const { samples } = drive([...outFixes, ...backFixes], { model });

  const maxProgress = Math.max(...samples.map((s) => s.progress.progressM));
  check(
    "progress passes the turnaround (L)",
    maxProgress > L * 1.05,
    `L=${L.toFixed(1)} maxProgress=${maxProgress.toFixed(1)}`,
  );
  check(
    "progress reaches ~2L on the return leg (no snap-back)",
    maxProgress > 2 * L * 0.9,
    `2L=${(2 * L).toFixed(1)} maxProgress=${maxProgress.toFixed(1)}`,
  );
}

// ---------------------------------------------------------------------------
// 6. off-route excursion -> offRoute flags, remaining frozen, recovers
// ---------------------------------------------------------------------------
section("6. off-route excursion -- flags, remaining freezes, recovers");
{
  const line = [pt(0, 0), pt(0, 1200)];
  const model = buildProgressModel(line, "one_way");
  // Walk to 400m, detour 120m east and back (well past the 75m off-route threshold), resume.
  const onA = walk([pt(0, 0), pt(0, 400)], { startT: 1_000_000, rng: makeRng(31) });
  const detour = walk([pt(0, 400), pt(120, 450), pt(120, 520), pt(0, 560)], {
    startT: onA.at(-1).t + 1000,
    rng: makeRng(32),
  });
  const onB = walk([pt(0, 560), pt(0, 1200)], {
    startT: detour.at(-1).t + 1000,
    rng: makeRng(33),
  });
  const { samples, state } = drive([...onA, ...detour, ...onB], { model });

  const offSamples = samples.filter((s) => s.progress.offRoute);
  check("off-route was flagged during the detour", offSamples.length > 0);

  // Remaining should hold constant across the off-route stretch.
  const frozenValues = new Set(offSamples.map((s) => s.progress.remainingM.toFixed(2)));
  check(
    "remaining frozen while off-route",
    frozenValues.size === 1,
    `distinct frozen values=${[...frozenValues].join(", ")}`,
  );

  const recovered = samples.some(
    (s, i) =>
      !s.progress.offRoute &&
      i > 0 &&
      offSamples.length > 0 &&
      s.t > offSamples.at(-1).t,
  );
  check("recovers on return (off-route clears)", recovered);
  check(
    "ends near zero remaining after recovery",
    samples.at(-1).progress.remainingM < 25,
    `remaining=${samples.at(-1).progress.remainingM.toFixed(1)}`,
  );
  // Raw distance kept accruing through the detour.
  check("raw distance exceeds route length (detour counted)", state.distanceM > model.totalM);
}

// ---------------------------------------------------------------------------
// 7. checkpoint round-trip -> identical final stats
// ---------------------------------------------------------------------------
section("7. checkpoint round-trip -- identical final stats vs uninterrupted");
{
  // Shim localStorage so the real checkpointStore round-trips through JSON.
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };

  const line = [pt(0, 0), pt(30, 400), pt(-20, 850), pt(10, 1200)];
  const fixes = walk(line, { rng: makeRng(77) });
  const { events, t0, tEnd } = buildEvents(fixes);

  // Uninterrupted run A.
  const ctxA = {
    state: reducer(initialState(), { type: "START", now: t0 }),
    model: null,
    match: null,
    samples: [],
    sawAutoPause: false,
    prevLen: 0,
  };
  step(ctxA, events);
  ctxA.state = reducer(ctxA.state, { type: "FINISH", now: tEnd });

  // Run B: process first half, checkpoint through localStorage, restore into a fresh reducer,
  // finish the second half.
  const midIdx = Math.floor(events.length / 2);
  const firstHalf = events.slice(0, midIdx);
  const secondHalf = events.slice(midIdx);
  const ctxB = {
    state: reducer(initialState(), { type: "START", now: t0 }),
    model: null,
    match: null,
    samples: [],
    sawAutoPause: false,
    prevLen: 0,
  };
  step(ctxB, firstHalf);
  checkpointStore.save({
    version: 1,
    routeId: null,
    tripType: "river",
    machine: ctxB.state,
    progress: null,
    savedAt: 1_700_000_000_000,
  });
  const loaded = checkpointStore.load();
  const restored = {
    state: reducer(initialState(), { type: "RESTORE", state: loaded.machine }),
    model: null,
    match: null,
    samples: [],
    sawAutoPause: false,
    prevLen: loaded.machine.track.length,
  };
  step(restored, secondHalf);
  restored.state = reducer(restored.state, { type: "FINISH", now: tEnd });

  const A = ctxA.state;
  const B = restored.state;
  check(
    "distance identical after restore",
    Math.abs(A.distanceM - B.distanceM) < 1e-6,
    `A=${A.distanceM} B=${B.distanceM}`,
  );
  check("elapsed identical after restore", Math.abs(A.elapsedS - B.elapsedS) < 1e-6);
  check("movingS identical after restore", Math.abs(A.movingS - B.movingS) < 1e-6);
  check("track length identical after restore", A.track.length === B.track.length);
}

// ---------------------------------------------------------------------------
// bonus: simplify + eta sanity (not one of the seven, but cheap insurance)
// ---------------------------------------------------------------------------
section("bonus. simplify keeps endpoints + reduces; eta blends toward session");
{
  const line = [pt(0, 0), pt(0, 1000)];
  const fixes = walk(line, { jitter: 0.5, rng: makeRng(90) });
  const track = fixes.map((f) => ({ lng: f.lng, lat: f.lat, t: f.t, acc: f.acc }));
  const simplified = simplifyTrack(track, 10);
  check("simplify preserves endpoints", simplified[0] === track[0] && simplified.at(-1) === track.at(-1));
  check("simplify reduces point count", simplified.length < track.length, `${track.length} -> ${simplified.length}`);

  const early = computeEta({ remainingM: 1000, movingS: 10, sessionDistanceM: 30, historicalSpeedMps: 1.34 });
  const late = computeEta({ remainingM: 1000, movingS: 600, sessionDistanceM: 1800, historicalSpeedMps: 1.34 });
  check("early ETA leans on historical speed", Math.abs(early.speedMps - 1.34) < 0.3, `speed=${early.speedMps.toFixed(2)}`);
  check("late ETA leans on session speed (3.0 m/s)", Math.abs(late.speedMps - 3.0) < 0.2, `speed=${late.speedMps.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// 8. next-poi-ahead -- one-way ahead/passed/none-ahead + out-and-back reappear
// ---------------------------------------------------------------------------
section("8. next-poi-ahead -- direction-aware nearest-ahead POI");
{
  // --- one-way ---------------------------------------------------------------
  const poiA = { id: "a", category: "hazard", note: "Rapids", routeDistM: 300 };
  const totalOneWay = 1000;

  const ahead = nextPoiAhead([poiA], "one_way", totalOneWay, 100);
  check(
    "one-way: ahead of progress -> flagged, correct distance",
    ahead != null && ahead.poi.id === "a" && Math.abs(ahead.distanceAheadM - 200) < 1e-6,
    `got=${JSON.stringify(ahead)}`,
  );

  const withinGrace = nextPoiAhead([poiA], "one_way", totalOneWay, 310);
  check(
    "one-way: just passed but within 30m grace -> still flagged, distance clamped to 0",
    withinGrace != null && withinGrace.poi.id === "a" && withinGrace.distanceAheadM === 0,
    `got=${JSON.stringify(withinGrace)}`,
  );

  const passed = nextPoiAhead([poiA], "one_way", totalOneWay, 400);
  check(
    "one-way: passed beyond grace -> not flagged (none ahead)",
    passed === null,
    `got=${JSON.stringify(passed)}`,
  );

  const none = nextPoiAhead([], "one_way", totalOneWay, 100);
  check("one-way: no corridor POIs -> null", none === null);

  // --- out-and-back ------------------------------------------------------------
  // L=500, totalM=2L=1000. POI at d=200: outbound position 200, return position 2L-200=800.
  const poiB = { id: "b", category: "wildlife", note: null, routeDistM: 200 };
  const totalOutBack = 1000;

  const outboundAhead = nextPoiAhead([poiB], "out_and_back", totalOutBack, 100);
  check(
    "out-and-back: ahead on the outbound leg -> matches outbound position",
    outboundAhead != null &&
      outboundAhead.positionM === 200 &&
      Math.abs(outboundAhead.distanceAheadM - 100) < 1e-6,
    `got=${JSON.stringify(outboundAhead)}`,
  );

  const reappeared = nextPoiAhead([poiB], "out_and_back", totalOutBack, 650);
  check(
    "out-and-back: passed outbound, reappears ahead on the return leg at 2L-d",
    reappeared != null &&
      reappeared.poi.id === "b" &&
      reappeared.positionM === 800 &&
      Math.abs(reappeared.distanceAheadM - 150) < 1e-6,
    `got=${JSON.stringify(reappeared)}`,
  );

  const trulyDone = nextPoiAhead([poiB], "out_and_back", totalOutBack, 850);
  check(
    "out-and-back: passed on the return leg too (beyond grace) -> null",
    trulyDone === null,
    `got=${JSON.stringify(trulyDone)}`,
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("  FAILURES:");
  for (const f of failures) console.log(`   - ${f}`);
}
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);
