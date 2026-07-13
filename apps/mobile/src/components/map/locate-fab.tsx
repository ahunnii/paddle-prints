/**
 * A small circular "center on me" button that floats over a map. On press it requests foreground
 * location permission (reusing the recorder's permission helper, since it already encodes the
 * services-disabled / denied distinction), reads a one-shot fix, and eases the given Camera ref to
 * it. Permission problems surface as a brief inline hint under the button instead of a crash or a
 * silent no-op -- there's no dedicated location-permission copy elsewhere in the app, so this keeps
 * its own short-lived message rather than reaching for a shared toast system that doesn't exist yet.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import type { CameraRef } from "@maplibre/maplibre-react-native";

import { ensureRecorderPermissions } from "../../lib/recorder/permissions";

const LOCATE_ZOOM = 13;
const LOCATE_ANIMATION_MS = 500;

function hintFor(reason: "denied" | "needsBackground" | "servicesDisabled" | "error"): string {
  switch (reason) {
    case "servicesDisabled":
      return "Turn on location services to center the map on you.";
    case "denied":
      return "Location access is off -- enable it in Settings to use this.";
    case "needsBackground":
      return "Location access is off -- enable it in Settings to use this.";
    case "error":
      return "Couldn't get your location. Try again.";
  }
}

export function LocateFab({
  cameraRef,
  className = "absolute bottom-6 left-4",
}: {
  cameraRef: React.RefObject<CameraRef | null>;
  /** Positioning classes; defaults to bottom-left so it doesn't collide with a bottom-right "+" FAB. */
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 3500);
    return () => clearTimeout(t);
  }, [hint]);

  async function handlePress() {
    if (loading) return;
    setHint(null);
    setLoading(true);
    try {
      const permission = await ensureRecorderPermissions();
      if (!permission.ok) {
        setHint(hintFor(permission.reason));
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      cameraRef.current?.easeTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: LOCATE_ZOOM,
        duration: LOCATE_ANIMATION_MS,
      });
    } catch {
      setHint(hintFor("error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className={className} pointerEvents="box-none">
      <Pressable
        onPress={() => void handlePress()}
        accessibilityLabel="Center map on my location"
        className="h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-lg"
        style={{ elevation: 4 }}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#1f7796" />
        ) : (
          <Ionicons name="locate" size={20} color="#1f7796" />
        )}
      </Pressable>
      {hint ? (
        <View
          pointerEvents="none"
          className="mt-2 max-w-[220px] rounded-xl bg-river-900/90 px-3 py-2"
        >
          <Text className="text-xs font-medium text-white">{hint}</Text>
        </View>
      ) : null}
    </View>
  );
}
