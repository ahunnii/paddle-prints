import type { Config } from "tailwindcss";

import { colors } from "@paddle-prints/tokens";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: { river: colors.river, sunset: colors.sunset },
    },
  },
} satisfies Config;
