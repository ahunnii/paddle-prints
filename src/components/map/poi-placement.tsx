"use client";

import { useEffect, useState } from "react";

import { POI_CATEGORIES, type PoiCategory } from "~/lib/pois";

interface PoiPlacementProps {
  open: boolean;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (category: PoiCategory, note: string) => void;
}

/**
 * The crosshair + bottom card "Add a spot" flow, shared by the community map and the nav map
 * (Phase 2). Map-agnostic and controlled: the parent owns the map instance and opens/closes this
 * via `open`, reading `map.getCenter()` itself inside `onSave` -- this component only tracks the
 * category/note the paddler picked. Renders nothing when closed. The white card keeps its own
 * light styling regardless of the underlying map's theme (better sunlight readability than a dark
 * sheet on the nav map).
 */
export function PoiPlacement({ open, saving, error, onCancel, onSave }: PoiPlacementProps) {
  const [category, setCategory] = useState<PoiCategory>("hazard");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) {
      setCategory("hazard");
      setNote("");
    }
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* fixed center crosshair -- the map pans underneath it */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="h-8 w-8 rounded-full border-2 border-sunset-500 bg-sunset-500/20" />
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sunset-500" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-3xl bg-white/95 p-4 shadow-2xl backdrop-blur">
          <p className="text-river-950 text-sm font-bold">Add a spot</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {POI_CATEGORIES.map((c) => (
              <button
                key={c.category}
                type="button"
                onClick={() => setCategory(c.category)}
                className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${
                  category === c.category
                    ? "bg-river-600 text-white"
                    : "bg-river-50 text-river-700"
                }`}
              >
                <span>{c.emoji}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            placeholder="Optional note"
            className="min-h-11 rounded-xl border border-river-200 px-3 text-sm"
          />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 flex-1 rounded-xl border border-river-200 text-sm font-semibold text-river-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(category, note)}
              disabled={saving}
              className="min-h-11 flex-1 rounded-xl bg-sunset-500 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
