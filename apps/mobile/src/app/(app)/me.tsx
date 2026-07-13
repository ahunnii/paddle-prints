import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";

import { colors } from "@paddle-prints/tokens";

import { Avatar } from "../../components/ui/avatar";
import { CrewSection } from "../../components/me/crew-section";
import { PinnedSection } from "../../components/me/pinned-section";
import { TeamsSection } from "../../components/me/teams-section";
import { env } from "../../env";
import { authClient } from "../../lib/auth-client";
import { formatSpeedMph } from "../../lib/format";
import {
  pendingPaddleStore,
  pendingPoiStore,
  syncQueue,
  type PaddleInput,
  type PendingRow,
  type PoiInput,
} from "../../lib/offline/sync";
import { useSettings } from "../../lib/settings/use-settings";
import { api, type RouterOutputs } from "../../lib/trpc";

type PaceStat = RouterOutputs["paddles"]["myStats"][number];

function tripTypeLabel(tripType: PaceStat["tripType"]) {
  return tripType === "river" ? "River" : "Flat water";
}

interface DeadLetter {
  kind: "paddle" | "poi";
  id: string;
  error: string;
}

/**
 * Reads the outbound queue for the Sync card: how many paddles/spots are still waiting, and any
 * dead-lettered rows (permanent 4xx failures) with their error. Polled on screen focus and refreshed
 * explicitly after "Sync now" / a discard -- native has no reactive query, and this screen is rarely
 * open, so focus polling is enough.
 */
function useSyncStatus() {
  const [paddleRows, setPaddleRows] = useState<PendingRow<PaddleInput>[]>([]);
  const [poiRows, setPoiRows] = useState<PendingRow<PoiInput>[]>([]);

  const refresh = useCallback(() => {
    Promise.all([pendingPaddleStore.toArray(), pendingPoiStore.toArray()])
      .then(([paddles, pois]) => {
        setPaddleRows(paddles);
        setPoiRows(pois);
      })
      .catch(() => {
        // Best-effort local read.
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const waitingPaddles = paddleRows.filter((r) => r.deadLetter == null).length;
  const waitingPois = poiRows.filter((r) => r.deadLetter == null).length;
  const deadLetters: DeadLetter[] = [
    ...paddleRows
      .filter((r) => r.deadLetter != null)
      .map((r) => ({ kind: "paddle" as const, id: r.id, error: r.deadLetter! })),
    ...poiRows
      .filter((r) => r.deadLetter != null)
      .map((r) => ({ kind: "poi" as const, id: r.id, error: r.deadLetter! })),
  ];

  return {
    waitingPaddles,
    waitingPois,
    deadLetters,
    total: paddleRows.length + poiRows.length,
    refresh,
  };
}

export default function MeScreen() {
  const { data: session, refetch: refetchSession } = authClient.useSession();
  const queryClient = useQueryClient();
  const stats = api.paddles.myStats.useQuery();
  const sharePresence = useSettings((s) => s.sharePresence);
  const setSharePresence = useSettings((s) => s.setSharePresence);
  const [signingOut, setSigningOut] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const sync = useSyncStatus();

  // Optimistic override for the just-uploaded avatar: `authClient.useSession()`'s cache can take a
  // moment to reflect the new `image` even after `refetch()`, so this shows the new photo instantly
  // while the session catches up in the background.
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarImage = uploadedImage ?? session?.user.image ?? null;

  /**
   * Picks a square photo from the library and posts it to `POST /api/avatars` (multipart, field
   * `file`), cookie-authenticated the same way the tRPC client is (`authClient.getCookie()` -- the
   * @better-auth/expo client's stored session cookie; see lib/trpc.ts's httpBatchLink headers()).
   * Mirrors apps/web/src/components/me/avatar-uploader.tsx's flow (preview + session refetch) since
   * there's no web `router.refresh()` equivalent to also nudge here.
   */
  async function handleChangePhoto() {
    setAvatarError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAvatarError("Photo library access is needed to change your avatar.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      // RN's FormData accepts a { uri, name, type } file descriptor at runtime; the DOM lib types
      // only allow string | Blob, so this needs the cast every RN multipart upload uses.
      formData.append(
        "file",
        {
          uri: asset.uri,
          name: "avatar.jpg",
          type: "image/jpeg",
        } as unknown as Blob,
      );

      const res = await fetch(`${env.EXPO_PUBLIC_API_URL}/api/avatars`, {
        method: "POST",
        headers: { Cookie: authClient.getCookie() },
        body: formData,
      });
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }
      const data = (await res.json()) as { url: string };
      setUploadedImage(data.url);
      await refetchSession();
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : "Couldn't upload photo.",
      );
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      await syncQueue();
    } finally {
      setSyncing(false);
      sync.refresh();
    }
  }

  async function discardDeadLetter(item: DeadLetter) {
    if (item.kind === "paddle") await pendingPaddleStore.delete(item.id);
    else await pendingPoiStore.delete(item.id);
    sync.refresh();
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      queryClient.clear();
    } finally {
      // The (app) group's session gate redirects to /login once the session clears; this only
      // matters if sign-out fails and the button needs to become tappable again.
      setSigningOut(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-river-50"
      contentContainerClassName="gap-6 p-4"
    >
      <View className="flex-row items-center gap-4">
        <Avatar name={session?.user.name ?? ""} image={avatarImage} size="lg" />
        <View className="flex-1 gap-1">
          <Text className="text-2xl font-extrabold tracking-tight text-river-900">
            {session?.user.name}
          </Text>
          <Text className="text-sm text-river-600">{session?.user.email}</Text>
          <Pressable
            onPress={() => void handleChangePhoto()}
            disabled={avatarUploading}
            className="mt-1 self-start disabled:opacity-60"
          >
            <Text className="text-sm font-semibold text-sunset-600">
              {avatarUploading ? "Uploading…" : "Change photo"}
            </Text>
          </Pressable>
          {avatarError ? (
            <Text className="text-xs text-red-600">{avatarError}</Text>
          ) : null}
        </View>
      </View>

      <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
          Your pace
        </Text>
        {stats.isPending ? (
          <ActivityIndicator color="#1f7796" />
        ) : stats.data && stats.data.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {stats.data.map((s: PaceStat) => (
              <View
                key={s.tripType}
                className="min-w-[45%] flex-1 rounded-xl bg-river-50 p-3"
              >
                <Text className="text-xs font-medium text-river-600">
                  {tripTypeLabel(s.tripType)}
                </Text>
                <Text className="text-xl font-extrabold text-river-900">
                  {formatSpeedMph(s.avgSpeedMps)}
                </Text>
                <Text className="text-xs text-river-400">
                  {s.count} paddle{s.count === 1 ? "" : "s"}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className="text-sm text-river-500">
            Log a paddle and your average pace will show up here.
          </Text>
        )}
      </View>

      <CrewSection />

      <TeamsSection />

      <PinnedSection />

      {/* Sync card -- shown only when there's something queued or failed (cleaner than web's always-on
          section). Waiting counts, any dead-lettered rows with a per-row discard, and a Sync now. */}
      {sync.total > 0 ? (
        <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
              Sync
            </Text>
            <Pressable
              onPress={() => void handleSyncNow()}
              disabled={syncing}
              className="rounded-full bg-sunset-500 px-3 py-1 disabled:opacity-40"
            >
              <Text className="text-xs font-bold text-white">
                {syncing ? "Syncing…" : "Sync now"}
              </Text>
            </Pressable>
          </View>

          {sync.waitingPaddles + sync.waitingPois > 0 ? (
            <Text className="text-sm text-river-700">
              {sync.waitingPaddles} paddle{sync.waitingPaddles === 1 ? "" : "s"} ·{" "}
              {sync.waitingPois} spot{sync.waitingPois === 1 ? "" : "s"} waiting
            </Text>
          ) : (
            <Text className="text-sm text-river-500">Everything is synced.</Text>
          )}

          {sync.deadLetters.length > 0 ? (
            <View className="gap-2 rounded-xl bg-red-50 p-3">
              <Text className="text-xs font-bold text-red-700">
                {sync.deadLetters.length} item
                {sync.deadLetters.length === 1 ? "" : "s"} failed to sync
              </Text>
              {sync.deadLetters.map((d) => (
                <View
                  key={`${d.kind}-${d.id}`}
                  className="flex-row items-center justify-between gap-2"
                >
                  <Text className="flex-1 text-xs text-red-600" numberOfLines={2}>
                    {d.kind === "paddle" ? "Paddle" : "Spot"}: {d.error}
                  </Text>
                  <Pressable
                    onPress={() => void discardDeadLetter(d)}
                    hitSlop={8}
                    className="shrink-0"
                  >
                    <Text className="text-xs font-semibold text-red-700 underline">
                      Discard
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
          Settings
        </Text>
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="text-base font-semibold text-river-900">
              Share live location
            </Text>
            <Text className="text-sm text-river-600">
              Friends see you on the community map while you record
            </Text>
          </View>
          <Switch
            value={sharePresence}
            onValueChange={setSharePresence}
            trackColor={{ false: colors.river[200], true: colors.river[500] }}
            thumbColor={sharePresence ? colors.sunset[400] : "#ffffff"}
            ios_backgroundColor={colors.river[200]}
          />
        </View>
      </View>

      <Pressable
        onPress={() => void handleSignOut()}
        disabled={signingOut}
        className="items-center rounded-full bg-sunset-500 px-6 py-3 disabled:opacity-60"
      >
        {signingOut ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="font-semibold text-white">Sign out</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
