/**
 * Persisted user preferences for the mobile app. Mirrors apps/web/src/lib/settings/use-settings.ts,
 * but drops `markerStyle` -- mobile has no board-marker toggle -- and keeps only `sharePresence`
 * (default TRUE, matching web).
 *
 * Backed by zustand + `persist`. The presence heartbeat loop in the recorder reads `sharePresence`
 * imperatively via `useSettings.getState()` from outside any component tree (same pattern as web), so
 * a plain store rather than React context is the right shape.
 *
 * Persistence uses `expo-sqlite/kv-store`'s SYNCHRONOUS, SQLite-backed methods
 * (`getItemSync`/`setItemSync`/`removeItemSync`) -- the same module the recorder checkpoint uses
 * (see ../recorder/checkpoint.ts) -- wrapped as a zustand `StateStorage` adapter.
 */
import Storage from "expo-sqlite/kv-store";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

/** Sync kv-store adapter for zustand's persist middleware. removeItemSync returns a boolean; the
 * StateStorage `removeItem: () => void` contract ignores it, so no wrapping is needed. */
const kvStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => Storage.setItemSync(name, value),
  removeItem: (name) => Storage.removeItemSync(name),
};

interface SettingsStore {
  sharePresence: boolean;
  setSharePresence: (share: boolean) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      sharePresence: true,
      setSharePresence: (sharePresence) => set({ sharePresence }),
    }),
    {
      name: "paddle-prints-settings",
      storage: createJSONStorage(() => kvStorage),
    },
  ),
);
