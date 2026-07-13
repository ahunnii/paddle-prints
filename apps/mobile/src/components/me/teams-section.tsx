/**
 * The "Paddle Teams" card on the Me tab: create a team, see its members, add/remove people from the
 * member directory, and (creator-only) delete it. Mirrors the card styling of the other me.tsx
 * sections (rounded-2xl bg-white shadow-sm) and crew-section.tsx's Avatar row layout.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { Avatar } from "../ui/avatar";
import { authClient } from "../../lib/auth-client";
import { api, type RouterOutputs } from "../../lib/trpc";
import { getRandomUUID } from "../../lib/uuid";

type Team = RouterOutputs["teams"]["mine"][number];

export function TeamsSection() {
  const { data: session } = authClient.useSession();
  const utils = api.useUtils();
  const teamsQuery = api.teams.mine.useQuery();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");

  const createTeam = api.teams.create.useMutation({
    onSuccess: () => {
      setNewTeamName("");
      void utils.teams.mine.invalidate();
    },
  });

  function handleCreate() {
    const name = newTeamName.trim();
    if (!name || createTeam.isPending) return;
    createTeam.mutate({ id: getRandomUUID(), name });
  }

  return (
    <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
        Paddle Teams
      </Text>

      {teamsQuery.isPending ? (
        <ActivityIndicator color="#1f7796" />
      ) : teamsQuery.isError ? (
        <Text className="text-sm text-river-500">
          Couldn&apos;t load your teams.
        </Text>
      ) : teamsQuery.data.length === 0 ? (
        <Text className="text-sm text-river-500">
          You&apos;re not on a team yet. Create one below.
        </Text>
      ) : (
        <View className="gap-2">
          {teamsQuery.data.map((team) => (
            <TeamRow
              key={team.id}
              team={team}
              myId={session?.user.id}
              expanded={expandedId === team.id}
              onToggle={() =>
                setExpandedId((cur) => (cur === team.id ? null : team.id))
              }
            />
          ))}
        </View>
      )}

      <View className="flex-row gap-2 pt-1">
        <TextInput
          value={newTeamName}
          onChangeText={setNewTeamName}
          maxLength={60}
          placeholder="New team name"
          placeholderTextColor="#88cde2"
          className="min-h-11 flex-1 rounded-xl border border-river-200 bg-river-50 px-3 text-sm text-river-900"
          onSubmitEditing={handleCreate}
          returnKeyType="done"
        />
        <Pressable
          onPress={handleCreate}
          disabled={!newTeamName.trim() || createTeam.isPending}
          className="min-h-11 items-center justify-center rounded-xl bg-sunset-500 px-4 disabled:opacity-40"
        >
          {createTeam.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="font-semibold text-white">Create</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function TeamRow({
  team,
  myId,
  expanded,
  onToggle,
}: {
  team: Team;
  myId: string | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const utils = api.useUtils();
  const isCreator = team.createdBy === myId;

  const [addingMember, setAddingMember] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const directory = api.users.directory.useQuery(undefined, {
    enabled: addingMember,
  });

  const addMember = api.teams.addMember.useMutation({
    onSuccess: () => void utils.teams.mine.invalidate(),
  });
  const removeMember = api.teams.removeMember.useMutation({
    onSuccess: () => void utils.teams.mine.invalidate(),
  });
  const deleteTeam = api.teams.delete.useMutation({
    onSuccess: () => void utils.teams.mine.invalidate(),
  });

  const memberIds = new Set(team.members.map((m) => m.id));
  const addable = (directory.data ?? []).filter((m) => !memberIds.has(m.id));

  function handleDeletePress() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteTeam.mutate({ id: team.id });
    setConfirmDelete(false);
  }

  return (
    <View className="rounded-xl bg-river-50 p-3">
      <Pressable onPress={onToggle} className="flex-row items-center gap-3">
        <View className="flex-row gap-1">
          {team.members.slice(0, 4).map((m) => (
            <Avatar key={m.id} name={m.name} image={m.image} size="sm" />
          ))}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-semibold text-river-900" numberOfLines={1}>
            {team.name}
          </Text>
          <Text className="text-xs text-river-500">
            {team.members.length} member{team.members.length === 1 ? "" : "s"}
          </Text>
        </View>
        <Text className="text-xs text-river-400">{expanded ? "▲" : "▼"}</Text>
      </Pressable>

      {expanded ? (
        <View className="mt-3 gap-2">
          {team.members.map((m) => (
            <View
              key={m.id}
              className="flex-row items-center gap-3 rounded-lg bg-white p-2.5"
            >
              <Avatar name={m.name} image={m.image} size="sm" />
              <Text
                className="flex-1 text-sm font-medium text-river-900"
                numberOfLines={1}
              >
                {m.name}
              </Text>
              <Pressable
                onPress={() =>
                  removeMember.mutate({ teamId: team.id, userId: m.id })
                }
                hitSlop={8}
              >
                <Text className="text-sm font-bold text-river-400">×</Text>
              </Pressable>
            </View>
          ))}

          {addingMember ? (
            <View className="gap-1.5 rounded-lg bg-white p-2.5">
              {directory.isPending ? (
                <ActivityIndicator color="#1f7796" />
              ) : addable.length === 0 ? (
                <Text className="text-xs text-river-400">
                  Everyone&apos;s already on this team.
                </Text>
              ) : (
                addable.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      addMember.mutate({ teamId: team.id, userId: m.id });
                      setAddingMember(false);
                    }}
                    className="flex-row items-center gap-3 rounded-lg p-1.5"
                  >
                    <Avatar name={m.name} image={m.image} size="sm" />
                    <Text
                      className="flex-1 text-sm text-river-700"
                      numberOfLines={1}
                    >
                      {m.name}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          ) : (
            <Pressable onPress={() => setAddingMember(true)} className="self-start">
              <Text className="text-sm font-semibold text-sunset-600">
                + Add member
              </Text>
            </Pressable>
          )}

          {isCreator ? (
            <Pressable onPress={handleDeletePress} className="self-start pt-1">
              <Text className="text-sm font-semibold text-red-600">
                {confirmDelete ? "Tap again to delete team" : "Delete team"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
