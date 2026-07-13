/**
 * Crew picker for the Record screen's finished/save step: pick teammates from the member directory
 * and/or add off-app guests by name, so a saved paddle can register who else came along
 * (`paddles.create`'s optional `crewUserIds` / `guestNames`). Mirrors the card styling used
 * throughout the app (rounded-2xl bg-white shadow-sm) and crew-section.tsx's Avatar row layout.
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
import { api } from "../../lib/trpc";

export interface CrewPickerProps {
  selectedUserIds: string[];
  onSelectedUserIdsChange: (ids: string[]) => void;
  guestNames: string[];
  onGuestNamesChange: (names: string[]) => void;
}

export function CrewPicker({
  selectedUserIds,
  onSelectedUserIdsChange,
  guestNames,
  onGuestNamesChange,
}: CrewPickerProps) {
  const { data: session } = authClient.useSession();
  const [expanded, setExpanded] = useState(false);
  const [guestDraft, setGuestDraft] = useState("");
  const directory = api.users.directory.useQuery(undefined, {
    enabled: expanded,
  });

  const crewCount = selectedUserIds.length + guestNames.length;

  function toggleUser(id: string) {
    if (selectedUserIds.includes(id)) {
      onSelectedUserIdsChange(selectedUserIds.filter((u) => u !== id));
    } else if (selectedUserIds.length < 20) {
      onSelectedUserIdsChange([...selectedUserIds, id]);
    }
  }

  function addGuest() {
    const name = guestDraft.trim();
    if (!name || guestNames.length >= 20) return;
    onGuestNamesChange([...guestNames, name]);
    setGuestDraft("");
  }

  function removeGuest(index: number) {
    onGuestNamesChange(guestNames.filter((_, i) => i !== index));
  }

  if (!expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        className="flex-row items-center justify-between rounded-2xl bg-white p-4 shadow-sm"
      >
        <Text className="font-semibold text-river-900">
          {crewCount > 0
            ? `${crewCount} crew member${crewCount === 1 ? "" : "s"}`
            : "+ Add crew"}
        </Text>
        <Text className="text-sm font-semibold text-sunset-600">
          {crewCount > 0 ? "Edit" : "Add"}
        </Text>
      </Pressable>
    );
  }

  const others = (directory.data ?? []).filter(
    (m) => m.id !== session?.user.id,
  );

  return (
    <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
          Who came along?
        </Text>
        <Pressable onPress={() => setExpanded(false)} hitSlop={8}>
          <Text className="text-xs font-semibold text-river-500">Done</Text>
        </Pressable>
      </View>

      {directory.isPending ? (
        <ActivityIndicator color="#1f7796" />
      ) : others.length === 0 ? (
        <Text className="text-sm text-river-500">
          No one else in the crew yet.
        </Text>
      ) : (
        <View className="gap-2">
          {others.map((member) => {
            const selected = selectedUserIds.includes(member.id);
            return (
              <Pressable
                key={member.id}
                onPress={() => toggleUser(member.id)}
                className={`flex-row items-center gap-3 rounded-xl p-3 ${
                  selected ? "bg-river-100" : "bg-river-50"
                }`}
              >
                <Avatar name={member.name} image={member.image} size="sm" />
                <Text
                  className="flex-1 font-medium text-river-900"
                  numberOfLines={1}
                >
                  {member.name}
                </Text>
                {selected ? (
                  <Text className="text-sm font-bold text-river-600">✓</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <View className="gap-2">
        <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
          Guests (not on the app)
        </Text>
        {guestNames.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {guestNames.map((name, i) => (
              <View
                key={`${name}-${i}`}
                className="flex-row items-center gap-1.5 rounded-full bg-river-100 px-3 py-1.5"
              >
                <Text className="text-sm text-river-800">{name}</Text>
                <Pressable onPress={() => removeGuest(i)} hitSlop={8}>
                  <Text className="text-sm font-bold text-river-500">×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View className="flex-row gap-2">
          <TextInput
            value={guestDraft}
            onChangeText={setGuestDraft}
            maxLength={80}
            placeholder="Guest name"
            placeholderTextColor="#88cde2"
            className="min-h-11 flex-1 rounded-xl border border-river-200 bg-white px-3 text-sm text-river-900"
            onSubmitEditing={addGuest}
            returnKeyType="done"
          />
          <Pressable
            onPress={addGuest}
            disabled={!guestDraft.trim()}
            className="min-h-11 items-center justify-center rounded-xl bg-river-100 px-4 disabled:opacity-40"
          >
            <Text className="font-semibold text-river-700">Add</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
