"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "~/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        setIsPending(true);
        void authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              router.push("/login");
              router.refresh();
            },
            onError: () => {
              setIsPending(false);
            },
          },
        });
      }}
      className="bg-sunset-500 hover:bg-sunset-600 rounded-full px-6 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60"
    >
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
