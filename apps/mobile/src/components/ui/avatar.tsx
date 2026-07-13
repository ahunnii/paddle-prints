/**
 * A round user avatar: the server image when set, otherwise an initials circle tinted from a small
 * stable palette (hashed from the name, so the same person gets the same color everywhere -- feed,
 * crew list, paddle detail). Shared by (app)/me.tsx, the crew section, the feed, and paddle detail.
 */
import { Image, Text, View } from "react-native";

import { env } from "../../env";

export type AvatarSize = "sm" | "md" | "lg";

const SIZE_PX: Record<AvatarSize, number> = { sm: 24, md: 40, lg: 80 };

/** Tint palette cycled by a hash of the name -- mirrors apps/web/src/components/ui/avatar.tsx's
 * TINTS so the same person reads as (roughly) the same color on web and mobile. */
const PALETTE = [
  "bg-river-500",
  "bg-river-700",
  "bg-sunset-500",
  "bg-sunset-700",
  "bg-river-400",
  "bg-sunset-400",
] as const;

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Prefixes a relative avatar path (e.g. "/api/avatars/<id>?v=123", the shape `POST /api/avatars`
 * returns and `users.directory` / `paddles.feed` / `paddles.byId` echo back) with the same API origin
 * the tRPC client and better-auth client talk to, so `<Image>` can actually load it. An absolute URL
 * passes through unchanged -- defensive, the API only ever returns relative paths today.
 */
export function resolveAvatarUri(image: string): string {
  if (/^https?:\/\//.test(image)) return image;
  return `${env.EXPO_PUBLIC_API_URL}${image}`;
}

export interface AvatarProps {
  /** Display name, used for the initials fallback and its color hash. */
  name: string;
  /** Relative or absolute avatar URL. Falsy (including empty string) shows the initials fallback. */
  image?: string | null;
  size?: AvatarSize;
}

export function Avatar({ name, image, size = "md" }: AvatarProps) {
  const px = SIZE_PX[size];
  const dimStyle = { width: px, height: px, borderRadius: px / 2 };

  if (image) {
    return (
      <Image
        source={{ uri: resolveAvatarUri(image) }}
        style={dimStyle}
        className="bg-river-100"
      />
    );
  }

  const tint = PALETTE[hashName(name || "?") % PALETTE.length]!;
  const fontSize = Math.max(10, Math.round(px * 0.4));

  return (
    <View className={`items-center justify-center ${tint}`} style={dimStyle}>
      <Text className="font-bold text-white" style={{ fontSize }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}
