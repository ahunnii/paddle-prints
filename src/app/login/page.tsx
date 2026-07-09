"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "~/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    void authClient.signIn.email(
      { email, password },
      {
        onSuccess: () => {
          router.push("/");
          router.refresh();
        },
        onError: (ctx) => {
          setIsPending(false);
          setError(ctx.error.message ?? "Something went wrong. Try again.");
        },
      }
    );
  };

  return (
    <main className="from-river-800 to-river-950 flex min-h-dvh items-center justify-center bg-gradient-to-b px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">🛶</span>
          <h1 className="text-river-950 font-display text-2xl font-extrabold tracking-tight">
            Welcome back
          </h1>
          <p className="text-river-600 text-sm">
            Sign in to see your crew&apos;s routes.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="email"
              className="text-river-700 text-sm font-medium"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-river-200 focus:border-sunset-400 focus:ring-sunset-200 rounded-xl border px-4 py-2 outline-none focus:ring-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="password"
              className="text-river-700 text-sm font-medium"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-river-200 focus:border-sunset-400 focus:ring-sunset-200 rounded-xl border px-4 py-2 outline-none focus:ring-2"
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isPending}
            className="bg-sunset-500 hover:bg-sunset-600 active:bg-sunset-600 active:scale-[0.98] mt-2 rounded-full px-6 py-2.5 font-semibold text-white transition-colors disabled:opacity-60"
          >
            {isPending ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-river-600 mt-6 text-center text-sm">
          New to the crew?{" "}
          <Link
            href="/register"
            className="text-sunset-600 font-semibold hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
