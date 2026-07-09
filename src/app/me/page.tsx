import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MeClient } from "~/components/me/me-client";
import { auth } from "~/server/auth";

export default async function MePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <MeClient
      user={{
        name: session.user.name,
        email: session.user.email,
      }}
    />
  );
}
