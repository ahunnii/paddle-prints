import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MeClient } from "~/components/me/me-client";
import { auth } from "@paddle-prints/auth";
import { api } from "~/trpc/server";

export default async function MePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const paceStats = await api.paddles.myStats();

  return (
    <MeClient
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
      paceStats={paceStats}
    />
  );
}
