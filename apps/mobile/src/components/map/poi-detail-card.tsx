/**
 * The bottom card shown when a POI pill is tapped: category emoji + label, optional note,
 * creator + date, and an optional Delete action. Extracted from the inline card in (app)/map.tsx
 * (~lines 386-422) so route-detail and paddle-detail can render the same tap-to-inspect card over
 * their own maps. Behavior/markup is unchanged from the original inline version -- only `onDelete`
 * is now optional, since the read-mostly detail screens don't offer deletion.
 */
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { formatDateTime } from "../../lib/format";
import { poiMeta } from "../../lib/pois";

export interface PoiDetailCardPoi {
  id: string;
  category: string;
  note: string | null;
  creatorName: string;
  createdAt: string | Date;
}

export interface PoiDetailCardProps<T extends PoiDetailCardPoi> {
  poi: T;
  onClose: () => void;
  /** Omit to render the card without a Delete action (e.g. read-only detail screens). */
  onDelete?: (poi: T) => void;
}

export function PoiDetailCard<T extends PoiDetailCardPoi>({
  poi,
  onClose,
  onDelete,
}: PoiDetailCardProps<T>) {
  const meta = poiMeta(poi.category);

  return (
    <View
      className="absolute inset-x-4 bottom-6 rounded-2xl bg-white p-4 shadow-lg"
      style={{ elevation: 6 }}
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="text-base font-bold text-river-950">
            {meta.emoji} {meta.label}
          </Text>
          {poi.note ? (
            <Text className="mt-1 text-sm text-river-700">{poi.note}</Text>
          ) : null}
          <Text className="mt-1 text-xs text-river-400">
            {poi.creatorName} · {formatDateTime(new Date(poi.createdAt))}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} className="p-1">
          <Ionicons name="close" size={20} color="#4fb0cd" />
        </Pressable>
      </View>
      {onDelete ? (
        <Pressable
          onPress={() => onDelete(poi)}
          className="mt-3 min-h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50"
        >
          <Text className="text-sm font-semibold text-red-600">Delete</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
