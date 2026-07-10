"use client";

/**
 * Persisted user preferences: map marker style and location-sharing opt-in. Backed by zustand +
 * `persist` (localStorage) rather than React context, because the presence heartbeat loop reads
 * `sharePresence` imperatively via `useSettings.getState()` from outside any component tree.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsStore {
  markerStyle: "board" | "dot";
  sharePresence: boolean;
  setMarkerStyle: (style: SettingsStore["markerStyle"]) => void;
  setSharePresence: (share: boolean) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      markerStyle: "board",
      sharePresence: true,
      setMarkerStyle: (markerStyle) => set({ markerStyle }),
      setSharePresence: (sharePresence) => set({ sharePresence }),
    }),
    { name: "paddle-prints-settings" },
  ),
);
