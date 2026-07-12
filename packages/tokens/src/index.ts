/**
 * Design tokens shared between the web app (Tailwind v4 CSS-first theme in
 * apps/web/src/styles/globals.css) and the mobile app (NativeWind tailwind.config).
 * globals.css remains the visual source of truth; keep the two in sync manually
 * until NativeWind supports Tailwind v4 and both can consume one definition.
 */

/** River blues — brand primary, evokes the water. */
export const river = {
  50: "#eff9fc",
  100: "#daf0f7",
  200: "#b9e2ef",
  300: "#88cde2",
  400: "#4fb0cd",
  500: "#2b93b3",
  600: "#1f7796",
  700: "#1e6079",
  800: "#205065",
  900: "#1e4356",
  950: "#112a38",
} as const;

/** Sunset oranges — brand accent, evokes golden-hour paddles. */
export const sunset = {
  50: "#fff8ed",
  100: "#ffefd4",
  200: "#ffdaa8",
  300: "#ffbf70",
  400: "#ff9c37",
  500: "#f97316",
  600: "#ea580c",
  700: "#c2410c",
  800: "#9a3412",
  900: "#7c2d12",
  950: "#431407",
} as const;

export const colors = { river, sunset } as const;

/** Font family names (loaded via next/font on web, expo-font on mobile). */
export const fonts = {
  sans: "Geist",
  display: "Nunito",
} as const;
