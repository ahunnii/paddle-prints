"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "~/trpc/react";

export function DeleteRouteButton({ routeId }: { routeId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const deleteRoute = api.routes.delete.useMutation({
    onSuccess: () => {
      router.push("/routes");
      router.refresh();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleDelete = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Delete this route? This can't be undone.",
      );
      if (!confirmed) return;
    }
    setError(null);
    deleteRoute.mutate({ id: routeId });
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleteRoute.isPending}
        className="min-h-11 rounded-xl border border-red-200 bg-red-50 font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {deleteRoute.isPending ? "Deleting..." : "Delete route"}
      </button>
    </div>
  );
}
