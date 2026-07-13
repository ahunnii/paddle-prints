/**
 * A round avatar: the user's photo when set, otherwise a colored circle with their initials. The
 * tint is derived deterministically from the name (a small hash into a fixed river/sunset palette)
 * so the same person always gets the same color without any server-side state.
 */
const TINTS = [
  "bg-river-500",
  "bg-river-700",
  "bg-sunset-500",
  "bg-sunset-700",
  "bg-river-400",
  "bg-sunset-400",
];

const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-10 w-10 text-sm",
  lg: "h-20 w-20 text-2xl",
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % TINTS.length;
  return TINTS[index]!;
}

export function Avatar({
  name,
  image,
  size = "md",
}: {
  name: string;
  image: string | null | undefined;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = SIZES[size];

  if (image) {
    // eslint-disable-next-line @next/next/no-img-element -- avatars can be arbitrary remote/uploaded
    // URLs; next/image's domain allowlisting isn't worth it here.
    return (
      <img
        src={image}
        alt={name}
        className={`${sizeClasses} shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} ${tintFor(name)} flex shrink-0 items-center justify-center rounded-full font-bold text-white`}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
