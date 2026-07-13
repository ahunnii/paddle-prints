import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@paddle-prints/auth";
import { ReviewClient } from "~/components/review/review-client";

export default async function ReviewPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return <ReviewClient />;
}
