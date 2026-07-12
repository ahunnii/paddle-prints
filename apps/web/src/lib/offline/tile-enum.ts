/**
 * Web re-export of the platform-free tile enumeration in `@paddle-prints/offline-core/tile-enum`
 * (moved there so mobile can reuse it for corridor bounds). Kept as a shim so existing consumers
 * import from "./tile-enum" / "~/lib/offline/tile-enum" unchanged.
 */
export * from "@paddle-prints/offline-core/tile-enum";
