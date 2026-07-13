"use client";

/**
 * "Who was with you?" on the record finish sheet: a compact multi-select over the member directory
 * (excluding yourself) plus free-text guest chips for anyone not in the app. Collapsed by default
 * behind a "+ Add crew" affordance so a solo paddle's finish sheet stays a one-tap flow -- the
 * directory is only fetched once expanded. Selection lives in the parent's React state (record-client
 * passes it straight into the same paddle-create input that carries the trip note) rather than the
 * recorder store, since it's decided once, right before saving, not accumulated live.
 */
import { useState } from "react";

import { Avatar } from "~/components/ui/avatar";
import { authClient } from "~/lib/auth-client";
import { api } from "~/trpc/react";

const MAX_CREW = 20;

export function CrewPicker({
  selectedUserIds,
  onChangeSelectedUserIds,
  guestNames,
  onChangeGuestNames,
}: {
  selectedUserIds: string[];
  onChangeSelectedUserIds: (ids: string[]) => void;
  guestNames: string[];
  onChangeGuestNames: (names: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [guestDraft, setGuestDraft] = useState("");

  const { data: session } = authClient.useSession();
  const meId = session?.user?.id;

  // Only fetched once expanded -- keeps a solo "Finish" tap from firing an extra query.
  const { data: directory } = api.users.directory.useQuery(undefined, {
    enabled: expanded,
  });

  const members = (directory ?? []).filter((m) => m.id !== meId);
  const selectedMembers = members.filter((m) => selectedUserIds.includes(m.id));
  const unselectedMembers = members.filter(
    (m) => !selectedUserIds.includes(m.id),
  );

  const totalSelected = selectedUserIds.length + guestNames.length;
  const atCap = totalSelected >= MAX_CREW;

  function toggleMember(id: string) {
    if (selectedUserIds.includes(id)) {
      onChangeSelectedUserIds(selectedUserIds.filter((x) => x !== id));
      return;
    }
    if (atCap) return;
    onChangeSelectedUserIds([...selectedUserIds, id]);
  }

  function addGuest() {
    const name = guestDraft.trim().slice(0, 80);
    setGuestDraft("");
    if (name.length === 0 || atCap || guestNames.includes(name)) return;
    onChangeGuestNames([...guestNames, name]);
  }

  function removeGuest(name: string) {
    onChangeGuestNames(guestNames.filter((g) => g !== name));
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="self-start rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white active:bg-white/25"
      >
        {totalSelected > 0 ? `＋ Crew (${totalSelected})` : "＋ Add crew"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-white/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-white/60">
          Who was with you?
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs font-semibold text-white/50"
        >
          Hide
        </button>
      </div>

      {selectedMembers.length > 0 || guestNames.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleMember(m.id)}
              className="flex items-center gap-1.5 rounded-full bg-sunset-500/90 py-1 pl-1 pr-2.5 text-xs font-bold text-white"
            >
              <Avatar name={m.name} image={m.image} size="sm" />
              {m.name}
              <span className="text-white/70">×</span>
            </button>
          ))}
          {guestNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => removeGuest(name)}
              className="flex items-center gap-1.5 rounded-full bg-river-600/90 px-3 py-1.5 text-xs font-bold text-white"
            >
              {name}
              <span className="text-white/70">×</span>
            </button>
          ))}
        </div>
      ) : null}

      {unselectedMembers.length > 0 ? (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {unselectedMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={atCap}
              onClick={() => toggleMember(m.id)}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-semibold text-white active:bg-white/10 disabled:opacity-40"
            >
              <Avatar name={m.name} image={m.image} size="sm" />
              {m.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={guestDraft}
          onChange={(e) => setGuestDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addGuest();
            }
          }}
          disabled={atCap}
          maxLength={80}
          placeholder="Add a guest by name…"
          className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-40"
        />
        <button
          type="button"
          onClick={addGuest}
          disabled={atCap || guestDraft.trim().length === 0}
          className="shrink-0 rounded-xl bg-white/15 px-3 py-2 text-sm font-bold text-white active:bg-white/25 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
