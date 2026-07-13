/** The fixed palette of emoji reactions a paddle can receive. Order is display order. */
export const REACTION_EMOJIS = ["🛶", "❤️", "🔥", "👏", "😲", "💪"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
