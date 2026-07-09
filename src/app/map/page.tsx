import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CommunityMapClient } from "~/components/map/community-map-client";
import { FloatingHeader } from "~/components/layout/floating-header";
import { auth } from "~/server/auth";

export default async function MapPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="relative h-dvh w-dvw overscroll-none">
      <CommunityMapClient />
      <FloatingHeader backHref="/" title="Community map" />
    </main>
  );
}
