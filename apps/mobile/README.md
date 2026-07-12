# @paddle-prints/mobile

Paddle Prints mobile app — Expo (SDK 57), expo-router, NativeWind v4, dev-client workflow.

This app uses Continuous Native Generation (CNG): the `android/` and `ios/` directories are
never committed. They're generated on demand from `app.config.ts`.

## Get started

From the repo root:

```bash
pnpm install
pnpm --filter @paddle-prints/mobile prebuild   # generates android/ and ios/
pnpm dev:mobile                                 # expo start --dev-client
```

Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` (see `.env.example` for emulator/simulator/LAN
variants) before running the app — `src/env.ts` throws if it's missing.

## Scripts

- `pnpm --filter @paddle-prints/mobile dev` — start the Metro dev server (dev-client)
- `pnpm --filter @paddle-prints/mobile android` / `ios` — build and run a dev-client build
- `pnpm --filter @paddle-prints/mobile prebuild` — regenerate native projects from config
- `pnpm --filter @paddle-prints/mobile typecheck` — `tsc --noEmit`
