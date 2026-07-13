"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  DIFFICULTY_OPTIONS,
  DifficultyBadge,
  type Difficulty,
} from "~/components/routes/difficulty-badge";
import { api } from "~/trpc/react";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface DifficultyEditorProps {
  routeId: string;
  difficulty: string | null;
}

/**
 * Editable difficulty badge, rendered only for the route's creator (the page checks
 * `session.user.id === route.createdBy` before mounting this). Tapping the badge (or the "Set
 * difficulty" prompt when unset) opens an inline four-pill picker; tapping the already-active pill
 * clears it back to unset. Saves optimistically via `routes.update`, then `router.refresh()` so the
 * server-rendered page picks up the persisted value.
 */
export function DifficultyEditor({ routeId, difficulty }: DifficultyEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string | null>(difficulty);
  const [saving, setSaving] = useState(false);

  const update = api.routes.update.useMutation();

  async function choose(option: Difficulty) {
    const previous = value;
    const next = option === value ? null : option;
    setValue(next);
    setSaving(true);
    setEditing(false);
    try {
      // `next` can be `null` (tapping the active pill clears it) -- an explicit `null` is required
      // here rather than `undefined`, since a partial-update mutation treats an omitted field as
      // "leave unchanged," not "clear." Assumes `routes.update`'s `difficulty` accepts `null`; if the
      // backend contract turns out to be enum-only (no null), clearing here won't typecheck and the
      // clear affordance should be dropped from this editor.
      await update.mutateAsync({ id: routeId, difficulty: next });
      router.refresh();
    } catch {
      setValue(previous);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={saving}
        className="inline-flex items-center gap-1 disabled:opacity-60"
      >
        {value ? (
          <DifficultyBadge difficulty={value} />
        ) : (
          <span className="text-river-400 text-xs font-semibold italic">
            Set difficulty
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DIFFICULTY_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => void choose(option)}
          className={`min-h-8 rounded-full px-3 text-xs font-semibold transition-colors ${
            value === option
              ? "bg-river-600 text-white"
              : "bg-river-50 text-river-700"
          }`}
        >
          {capitalize(option)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-river-400 text-xs font-semibold"
      >
        Cancel
      </button>
    </div>
  );
}
