"use client";

import { useState } from "react";

import {
  DIFFICULTY_OPTIONS,
  DifficultyBadge,
  type Difficulty,
} from "~/components/routes/difficulty-badge";
import { toast } from "~/components/ui/toaster";
import { api } from "~/trpc/react";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface PaddleDifficultyEditorProps {
  paddleId: string;
  difficulty: string | null;
}

/**
 * Editable difficulty badge for an already-synced paddle, rendered only for the paddle's owner (the
 * summary card checks `data.isOwner && !data.pending` before mounting this). Tapping the badge (or
 * the "Set difficulty" prompt when unset) opens an inline four-pill picker; tapping the already-active
 * pill clears it back to unset. Saves optimistically via `paddles.updatePaddleDifficulty`, reverting
 * local state on failure. Modeled on `routes/difficulty-editor.tsx`.
 */
export function PaddleDifficultyEditor({
  paddleId,
  difficulty,
}: PaddleDifficultyEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string | null>(difficulty);
  const [saving, setSaving] = useState(false);

  const update = api.paddles.updatePaddleDifficulty.useMutation();

  async function choose(option: Difficulty) {
    const previous = value;
    const next = option === value ? null : option;
    setValue(next);
    setSaving(true);
    setEditing(false);
    try {
      await update.mutateAsync({ id: paddleId, difficulty: next });
    } catch {
      setValue(previous);
      toast("Couldn't save difficulty. Try again.", "error");
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
