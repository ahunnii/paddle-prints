"use client";

/**
 * "Paddle Teams" on /me: the crews you belong to. Each team shows its member avatars + count;
 * selecting one expands to a roster with remove (×) affordances, an "Add member" picker over the
 * member directory, and -- creator-only -- a two-tap "Delete team" confirm (no browser confirm()).
 * A "New team" affordance creates a team with a client-generated id (idempotent on retry).
 * Mirrors the card styling of the other /me sections (rounded-3xl bg-white/10, uppercase tracking
 * headings) -- see me-client.tsx / crew-section.tsx.
 */
import { useState } from "react";

import { Avatar } from "~/components/ui/avatar";
import { authClient } from "~/lib/auth-client";
import { api, type RouterOutputs } from "~/trpc/react";

type Team = RouterOutputs["teams"]["mine"][number];

export function TeamsSection() {
  const { data: session } = authClient.useSession();
  const meId = session?.user?.id;

  const utils = api.useUtils();
  const { data: teams, isPending, error } = api.teams.mine.useQuery();

  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  const createTeam = api.teams.create.useMutation({
    onSuccess: () => void utils.teams.mine.invalidate(),
  });

  async function handleCreate() {
    const name = newTeamName.trim();
    if (name.length === 0) return;
    await createTeam.mutateAsync({ id: crypto.randomUUID(), name });
    setNewTeamName("");
    setShowNewTeam(false);
  }

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white/10 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-river-100 text-xs font-bold uppercase tracking-widest">
          Paddle Teams
        </h2>
        <button
          type="button"
          onClick={() => setShowNewTeam((v) => !v)}
          className="text-sunset-300 text-xs font-bold"
        >
          {showNewTeam ? "Cancel" : "+ New team"}
        </button>
      </div>

      {showNewTeam ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreate();
              }
            }}
            maxLength={60}
            placeholder="Team name…"
            autoFocus
            className="text-river-50 placeholder:text-river-500 focus:border-river-500 min-w-0 flex-1 rounded-xl border border-river-800 bg-river-900 px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={createTeam.isPending || newTeamName.trim().length === 0}
            className="bg-sunset-500 active:bg-sunset-600 shrink-0 rounded-xl px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            {createTeam.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      ) : null}

      {isPending ? (
        <p className="text-river-300 text-sm">Loading…</p>
      ) : error ? (
        <p className="text-river-300 text-sm">Couldn&apos;t load your teams.</p>
      ) : !teams || teams.length === 0 ? (
        <p className="text-river-300 text-sm">
          No teams yet. Start one to share paddles with a fixed crew.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {teams.map((team) => (
            <TeamRow
              key={team.id}
              team={team}
              meId={meId}
              open={openTeamId === team.id}
              onToggle={() =>
                setOpenTeamId((cur) => (cur === team.id ? null : team.id))
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamRow({
  team,
  meId,
  open,
  onToggle,
}: {
  team: Team;
  meId: string | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const utils = api.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreator = meId != null && team.createdBy === meId;

  const invalidateTeams = () =>
    Promise.all([
      utils.teams.mine.invalidate(),
      utils.teams.list.invalidate(),
    ]);

  const addMember = api.teams.addMember.useMutation({
    onSuccess: () => void invalidateTeams(),
  });
  const removeMember = api.teams.removeMember.useMutation({
    onSuccess: () => void invalidateTeams(),
  });
  const deleteTeam = api.teams.delete.useMutation({
    onSuccess: () => void invalidateTeams(),
  });

  const { data: directory } = api.users.directory.useQuery(undefined, {
    enabled: showAdd,
  });
  const memberIds = new Set(team.members.map((m) => m.id));
  const addable = (directory ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <li className="rounded-2xl bg-river-900/50 p-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 text-left"
      >
        <div className="flex -space-x-2">
          {team.members.slice(0, 5).map((m) => (
            <Avatar key={m.id} name={m.name} image={m.image} size="sm" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold text-white">
            {team.name}
          </span>
          <span className="text-river-300 text-xs">
            {team.members.length} member
            {team.members.length === 1 ? "" : "s"}
          </span>
        </div>
        <span className="text-river-400 shrink-0 text-xs">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3">
          <ul className="flex flex-col gap-1.5">
            {team.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-xl bg-river-950/40 px-2 py-1.5"
              >
                <Avatar name={m.name} image={m.image} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                  {m.name}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    removeMember.mutate({ teamId: team.id, userId: m.id })
                  }
                  disabled={removeMember.isPending}
                  className="active:text-red-300 shrink-0 px-1 text-sm font-bold text-red-300/80 disabled:opacity-40"
                  aria-label={`Remove ${m.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          {showAdd ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-river-400 text-xs uppercase tracking-widest">
                Add member
              </span>
              {addable.length === 0 ? (
                <p className="text-river-400 text-xs italic">
                  Everyone in the crew is already a member.
                </p>
              ) : (
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {addable.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() =>
                          addMember.mutate({ teamId: team.id, userId: u.id })
                        }
                        disabled={addMember.isPending}
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-medium text-white active:bg-white/10 disabled:opacity-40"
                      >
                        <Avatar name={u.name} image={u.image} size="sm" />
                        {u.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="text-river-300 self-start text-xs font-semibold"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="self-start rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white active:bg-white/20"
            >
              + Add member
            </button>
          )}

          {isCreator ? (
            <div className="flex justify-end">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-300">Really delete?</span>
                  <button
                    type="button"
                    onClick={() => deleteTeam.mutate({ id: team.id })}
                    disabled={deleteTeam.isPending}
                    className="active:bg-red-500/30 rounded-lg bg-red-500/20 px-2.5 py-1 text-xs font-bold text-red-200 disabled:opacity-40"
                  >
                    {deleteTeam.isPending ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-river-300 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="active:text-red-300 text-xs font-semibold text-red-300/80"
                >
                  Delete team
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
