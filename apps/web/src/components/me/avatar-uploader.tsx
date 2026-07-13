"use client";

/**
 * The profile-photo control on /me: current avatar plus a "Change photo" affordance over a hidden
 * file input. Posts straight to POST /api/avatars (multipart, field `file`), which also updates the
 * better-auth user record server-side -- so once it succeeds we refetch the session (picking up the
 * new `image`) and refresh the route tree so any other server-rendered avatars catch up too.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Avatar } from "~/components/ui/avatar";
import { authClient } from "~/lib/auth-client";

export function AvatarUploader({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  const router = useRouter();
  const { refetch } = authClient.useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/avatars", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }
      const data = (await res.json()) as { url: string };
      setPreview(data.url);
      await refetch();
      router.refresh();
    } catch {
      setError("Couldn't upload photo. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <Avatar name={name} image={preview ?? image} size="lg" />
        {uploading ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <span className="text-xs font-semibold text-white">…</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="text-sunset-300 text-sm font-semibold underline disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Change photo"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}
