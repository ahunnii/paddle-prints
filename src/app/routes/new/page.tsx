import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { RouteBuilder } from "~/components/routes/route-builder";
import { auth } from "~/server/auth";

export default async function NewRoutePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return <RouteBuilder />;
}
