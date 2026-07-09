/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // Disabled in dev (HMR + a precaching SW fight each other). The offline gauntlet runs a prod build.
  disable: process.env.NODE_ENV === "development",
  // Registration + update handling is done explicitly by SerwistProvider (offline-layer.tsx).
  register: false,
  // Never auto-reload on reconnect -- that would nuke an in-progress recording.
  reloadOnOnline: false,
});

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
};

export default withSerwist(config);
