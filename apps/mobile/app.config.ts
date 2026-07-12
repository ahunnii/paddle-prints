import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Paddle Prints",
  slug: "paddle-prints",
  scheme: "paddleprints",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "com.alvarezwebworks.paddleprints",
    supportsTablet: false,
  },
  android: {
    package: "com.alvarezwebworks.paddleprints",
    adaptiveIcon: {
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundColor: "#eff9fc",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#208AEF",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
      },
    ],
    [
      "expo-build-properties",
      // Dev only: allows plain-http requests to the LAN dev server. Must be gated off before any release build.
      { android: { usesCleartextTraffic: true } },
    ],
    "expo-task-manager",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Paddle Prints uses your location to record your paddle track and show progress along the route.",
        locationAlwaysAndWhenInUsePermission:
          "Paddle Prints uses your location to keep recording your paddle while the app is in the background.",
        isIosBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  experiments: { typedRoutes: true },
};

export default config;
