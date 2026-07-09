import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignOutButton } from "~/app/_components/sign-out-button";
import { auth } from "~/server/auth";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="from-river-800 to-river-950 flex min-h-screen flex-col items-center justify-center bg-gradient-to-b px-4 text-white">
      <div className="flex flex-col items-center gap-6 text-center">
        <span className="text-6xl">🛶</span>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Ahoy, {session.user.name}
        </h1>
        <p className="text-river-100 max-w-sm text-lg">
          Your crew&apos;s route feed is paddling this way soon &mdash; check
          back after Phase 2.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
