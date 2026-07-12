# Phase 6 Handoff — Distribution (EAS / TestFlight / APK / Push)

Handoff for a fresh agent session. Phases 1–5 of the Expo addition are **complete, verified, and committed** (`8d2b8c6..6a62aa4`, 20 commits). This doc covers only what Phase 6 needs; do not re-derive completed work.

## Context pointers (read, don't duplicate)

- **Master plan**: `~/.claude/plans/i-have-been-testing-cached-flurry.md` — Phase 1 detail + P2–P6 roadmap and the interview decisions that bind this work.
- **Project memory**: auto-memory file `paddle-prints-app.md` (loaded each session) — per-phase status lines and every hard-won gotcha.
- **Repo layout**: pnpm + Turborepo. `apps/web` (Next 15 PWA), `apps/mobile` (Expo SDK 57, RN 0.86), packages `db` / `auth` / `api` / `recorder-core` / `tokens` / `offline-core`. Deploy via root `Dockerfile` + `docker-compose.yml` on Coolify.

## Phase 6 scope (from the approved roadmap)

1. User creates **Apple Developer Program** ($99/yr) and **Expo** accounts — *hard blockers, user-side; confirm before starting*.
2. `eas.json` with three profiles: `development` (dev client), `preview` (internal-distribution Android APK), `production` (store builds).
3. **iOS**: EAS cloud builds → TestFlight internal group for ~15 friends. **Android**: sideload APK from the `preview` profile (no Play Store).
4. Build strategy per interview: **hybrid** — local dev builds day-to-day (already working), EAS cloud only for cutting releases.
5. After distribution works: **push notifications** — `expo-notifications` + server-side Expo Push API; needs a device-token table in `packages/db` (first schema migration of this whole effort) and a send path in `packages/api`.

## Release checklist items already known

- **`usesCleartextTraffic: true` must NOT ship.** `apps/mobile/app.config.ts` sets it for LAN dev. Gate on an `APP_VARIANT` env in the config (the file has a comment marking it) before any release build.
- **Release env**: `EXPO_PUBLIC_API_URL` → production web domain; `EXPO_PUBLIC_TILES_URL` → public tiles URL (`.../michigan.pmtiles`). Dev values live in `apps/mobile/.env` (tiles on **:8082** locally — 8080 is occupied by another project's container on this machine). Wire release values via `eas.json` `env` blocks.
- **App identity** (locked by interview): name "Paddle Prints", scheme `paddleprints`, bundle id / package `com.alvarezwebworks.paddleprints`. CNG workflow — `ios/`/`android/` are gitignored; never commit them.
- Server side needs **nothing** for distribution: prod deploy already serves auth (with expo plugin + `paddleprints://` trusted origin), tRPC, `/map/*` statics, and `/api/trips/[routeId]/tiles` extracts.

## Gotchas that will bite Phase 6 specifically

- **`npx expo run:ios` does not re-sync Info.plist when `ios/` exists.** After ANY `app.config.ts` plugin/config change: `npx expo prebuild -p ios --clean` first. Same will apply to `android/` when it's first generated.
- **npm quarantine**: `~/.npmrc` has `minimumReleaseAge=10080` (7-day hold on new packages). If `eas-cli` or new deps fail to resolve at latest, widen to `^` ranges and let the resolver pick (established pattern).
- **Android + pmtiles extract risk**: an open MapLibre Native issue reports `pmtiles extract`-produced archives rendering empty on recent Android cores. Ours are extract-produced (per-trip offline maps). **Test offline maps on the first Android build early** — if it reproduces, the fallback discussed is serving z/x/y for Android offline or pinning the Android native version via the MLRN plugin's `android.nativeVersion` prop.
- **No Android SDK on this Mac** — Android verification must go through EAS cloud builds (or the user installs Android Studio).
- `expo-doctor`: `typescript` is already in `expo.install.exclude` (intentional monorepo TS pinning); the react "duplicate" warning is the planned web/mobile version skew — both are known-benign.
- Local `pnpm --filter @paddle-prints/web build` fails at prerender on this machine (duplicate React copies from hoisted mobile deps). **Machine-local only** — Docker/CI builds are clean. Don't chase it.

## Verification tooling that already works (reuse, don't rediscover)

- **iOS simulator**: iPhone 17 (UDID `09F64B18-E4F4-40FD-AC80-B7E7A1323786`), iOS 26.5 runtime installed. Dev client installed via `npx expo run:ios --no-bundler --device <UDID>` with `LANG=en_US.UTF-8` (CocoaPods needs it).
- **UI automation**: `idb` (brew `idb-companion` + `fb-idb` in a **Python 3.12** venv — 3.14 breaks it; the venv lived in an ephemeral scratchpad, recreate with `python3.12 -m venv … && pip install fb-idb`). `idb ui tap/swipe/text/describe-point`. Known quirks: UISwitch ignores synthetic taps (drag the thumb instead); leading-dash text needs `-- "-on"`; typed text occasionally truncates — verify fields and append.
- **GPS simulation**: `xcrun simctl location <UDID> start --speed=4 --distance=8 <lat,lon>…` along real route waypoints (keep speed ≤4.4 m/s — the reducer's 4.5 m/s teleport gate rejects faster fixes). Deep-link the dev client via `idb open "paddleprints://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`.
- **Offline gauntlet**: stop the Next dev server + tiles container to simulate no-signal; the full procedure and expected results are in the Phase 5 session chapter.
- **Test account**: `sim-test@example.com` exists in the local dev DB (recreate via the signup endpoint with the invite code from root `.env` if deleted — credentials intentionally not recorded here).

## Deferred items (not Phase 6 blockers; don't accidentally "fix" them into scope)

- Route-detail screen offline fallback (pace card needs full `etaForUser` shape; snapshot hook intentionally reduces it).
- Trips downloaded before the route-snapshot fix lack snapshots (dev simulator only — remove/re-download).
- Web route-builder stays web-only by design.
- Real on-water phone test of the recorder is still outstanding (user-side).

## Suggested skills

- `/verify` — after wiring `eas.json`/config changes, drive the dev client end-to-end on the simulator rather than trusting typecheck.
- `/code-review` — before tagging the first release build, review the release-gating diff (`APP_VARIANT` cleartext gate, env wiring).
- `claude-code-guide` agent — for any Expo/EAS CLI questions where the docs matter more than memory.

## Working conventions (bind all sessions)

pnpm ONLY. Plain commits as the user's git identity, no attribution lines. Delegate by model tier (Haiku mechanical / Sonnet standard / Opus high-risk) with the orchestrator re-running all gates before each commit. Gates: root `pnpm typecheck`, `pnpm test:offline` (37), `pnpm test:recorder` (32), and live simulator verification for anything user-facing.
