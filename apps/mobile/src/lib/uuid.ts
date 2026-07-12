/**
 * Native UUID helper. Wraps `expo-crypto`'s RFC4122 v4 generator so the rest of the app never imports
 * the crypto module directly. Paddle-id creation lives in the save flow (a later screens task); this
 * util just exists so that flow has a single, testable source of ids.
 */
import * as Crypto from "expo-crypto";

export function getRandomUUID(): string {
  return Crypto.randomUUID();
}
