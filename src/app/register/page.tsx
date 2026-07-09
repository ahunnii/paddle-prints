"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "~/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    // better-auth's sign-up/email endpoint accepts arbitrary extra body fields (see
    // signUpEmailBodySchema in better-auth's source), but the generated client type only
    // reflects the known fields. Building the payload in a variable (rather than passing an
    // object literal) sidesteps TS's excess-property check while still sending `inviteCode`
    // to the server, where our `hooks.before` middleware reads it off `ctx.body`.
    const payload = { name, email, password, inviteCode };

    void authClient.signUp.email(
      payload,
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
    <main className="from-river-800 to-river-950 flex min-h-screen items-center justify-center bg-gradient-to-b px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="text-4xl">🛶</span>
          <h1 className="text-river-950 text-2xl font-extrabold tracking-tight">
            Join the crew
          </h1>
          <p className="text-river-600 text-sm">
            You&apos;ll need an invite code to paddle in.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="name"
              className="text-river-700 text-sm font-medium"
            >
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-river-200 focus:border-sunset-400 focus:ring-sunset-200 rounded-xl border px-4 py-2 outline-none focus:ring-2"
            />
          </div>

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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-river-200 focus:border-sunset-400 focus:ring-sunset-200 rounded-xl border px-4 py-2 outline-none focus:ring-2"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="inviteCode"
              className="text-river-700 text-sm font-medium"
            >
              Invite code
            </label>
            <input
              id="inviteCode"
              type="text"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
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
            className="bg-sunset-500 hover:bg-sunset-600 mt-2 rounded-full px-6 py-2.5 font-semibold text-white transition-colors disabled:opacity-60"
          >
            {isPending ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="text-river-600 mt-6 text-center text-sm">
          Already paddling with us?{" "}
          <Link
            href="/login"
            className="text-sunset-600 font-semibold hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
