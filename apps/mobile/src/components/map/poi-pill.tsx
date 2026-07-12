/**
 * A round emoji marker for a POI, ringed in its category color. Extracted from the inline marker in
 * (app)/map.tsx so the community map and the nav map render POIs identically. Not a ViewAnnotation
 * itself -- callers wrap it in one (or in a Marker) at the POI's lngLat, since annotation anchoring
 * differs slightly between the community map (interactive, onPress) and the nav map (static glance).
 */
import { Pressable, Text, View } from "react-native";

export interface PoiPillProps {
  emoji: string;
  /** Hex color for the ring around the pill. */
  color: string;
  /** Pill diameter in px. Defaults to 36 (the community map's size). */
  size?: number;
  onPress?: () => void;
}

export function PoiPill({ emoji, color, size = 36, onPress }: PoiPillProps) {
  const content = (
    <View
      className="items-center justify-center rounded-full border-2 bg-white"
      style={{ width: size, height: size, borderColor: color }}
    >
      <Text style={{ fontSize: size * 0.44 }}>{emoji}</Text>
    </View>
  );

  if (!onPress) return content;

  return <Pressable onPress={onPress}>{content}</Pressable>;
}
