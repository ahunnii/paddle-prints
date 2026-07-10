import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  PaddleSummaryResilient,
  type SummaryData,
} from "~/components/paddles/paddle-summary-resilient";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function PaddleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { id } = await params;

  // Best-effort server read. If the paddle isn't on the server yet (still queued in the client's
  // IndexedDB after an offline finish), fall through with `server = null` and let the client render
  // it from the queue. Any other error is a real failure and should surface.
  let server: SummaryData | null = null;
  try {
    const paddle = await api.paddles.byId({ id });
    server = {
      id: paddle.id,
      userName: paddle.userName,
      routeId: paddle.routeId,
      routeName: paddle.routeName,
      startedAt: paddle.startedAt.toISOString(),
      elapsedS: paddle.elapsedS,
      movingS: paddle.movingS,
      distanceM: paddle.distanceM,
      avgSpeedMps: paddle.avgSpeedMps,
      trackCoords:
        paddle.trackGeom?.coordinates.map(
          (c) => [c[0], c[1]] as [number, number],
        ) ?? null,
      routeCoords:
        paddle.routeGeom?.coordinates.map(
          (c) => [c[0], c[1]] as [number, number],
        ) ?? null,
      note: paddle.note,
      isOwner: paddle.userId === session.user.id,
      pending: false,
    };
  } catch (err) {
    const notFound = err instanceof TRPCError && err.code === "NOT_FOUND";
    // A bad/non-uuid id also comes back as a validation error -> treat as "not on server".
    const badInput = err instanceof TRPCError && err.code === "BAD_REQUEST";
    if (!notFound && !badInput) throw err;
    server = null;
  }

  return <PaddleSummaryResilient id={id} server={server} />;
}
