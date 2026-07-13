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
    <div className="flex flex-col items-start gap-1">
      <div
        className="group relative shrink-0 cursor-pointer"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        title="Change photo"
        aria-label="Change photo"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <Avatar name={name} image={preview ?? image} size="lg" />
        {/* Hover overlay */}
        <div className="absolute inset-0 hidden group-hover:flex items-center justify-center rounded-full bg-black/50">
          <span className="text-2xl">📷</span>
        </div>
        {uploading ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <span className="text-xs font-semibold text-white">…</span>
          </div>
        ) : null}
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
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
