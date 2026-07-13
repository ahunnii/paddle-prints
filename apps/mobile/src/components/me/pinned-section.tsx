/**
 * The "Pinned Paddles" card on the Me tab: paddles bookmarked from the crew feed, with a shortcut to
 * paddle them yourself. Mirrors the card styling of the other me.tsx sections and crew-section.tsx's
 * Avatar row layout; "Paddle this" deep-links into record.tsx exactly like
 * routes/[id].tsx's "Start paddle" button (`router.push('/record?route=' + id)`), falling back to
 * `?paddle=` when the pinned paddle wasn't tied to a saved route.
 */
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Avatar } from "../ui/avatar";
import { formatDateTime, formatDistanceMi } from "../../lib/format";
import { api, type RouterOutputs } from "../../lib/trpc";

type Pin = RouterOutputs["social"]["pinsList"][number];

export function PinnedSection() {
  const router = useRouter();
  const utils = api.useUtils();
  const pinsQuery = api.social.pinsList.useQuery();
  const pinToggle = api.social.pinToggle.useMutation({
    onSuccess: () => void utils.social.pinsList.invalidate(),
  });

  return (
    <View className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
        Pinned Paddles
      </Text>

      {pinsQuery.isPending ? (
        <ActivityIndicator color="#1f7796" />
      ) : pinsQuery.isError ? (
        <Text className="text-sm text-river-500">
          Couldn&apos;t load your pins.
        </Text>
      ) : pinsQuery.data.length === 0 ? (
        <Text className="text-sm text-river-500">
          Pin paddles from the crew feed to try them yourself.
        </Text>
      ) : (
        <View className="gap-2">
          {pinsQuery.data.map((pin) => (
            <PinRow
              key={pin.paddleId}
              pin={pin}
              onUnpin={() => pinToggle.mutate({ paddleId: pin.paddleId })}
              onPaddleThis={() =>
                router.push(
                  pin.paddle.routeId
                    ? `/record?route=${pin.paddle.routeId}`
                    : `/record?paddle=${pin.paddle.id}`,
                )
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

function PinRow({
  pin,
  onUnpin,
  onPaddleThis,
}: {
  pin: Pin;
  onUnpin: () => void;
  onPaddleThis: () => void;
}) {
  return (
    <View className="gap-2 rounded-xl bg-river-50 p-3">
      <View className="flex-row items-center gap-3">
        <Avatar name={pin.paddle.ownerName} image={pin.paddle.ownerImage} size="sm" />
        <View className="min-w-0 flex-1">
          <Text className="font-semibold text-river-900" numberOfLines={1}>
            {pin.paddle.ownerName} · {pin.paddle.routeName ?? "Quick start paddle"}
          </Text>
          <Text className="text-xs text-river-500">
            {formatDistanceMi(pin.paddle.distanceM)} ·{" "}
            {formatDateTime(new Date(pin.paddle.startedAt))}
          </Text>
        </View>
      </View>
      <View className="flex-row gap-2">
        <Pressable
          onPress={onPaddleThis}
          className="min-h-9 flex-1 items-center justify-center rounded-lg bg-sunset-500"
        >
          <Text className="text-sm font-bold text-white">Paddle this</Text>
        </Pressable>
        <Pressable
          onPress={onUnpin}
          className="min-h-9 items-center justify-center rounded-lg border border-river-300 px-3"
        >
          <Text className="text-sm font-semibold text-river-700">Unpin</Text>
        </Pressable>
      </View>
    </View>
  );
}
