/**
 * Pure flow-direction narration: turns a route's `flowLegs` (from `routes.byId` / `rivers.route` --
 * see packages/api/src/routers/routes.ts and rivers.ts) into human-readable lines like
 * "↓ 4.2 mi downstream". Mirrors apps/mobile/src/components/routes/flow-narration.ts -- keep the two
 * in sync.
 */

const METERS_PER_MILE = 1609.344;

export type FlowDirection = "downstream" | "upstream" | "unknown";

export interface FlowLeg {
  startM: number;
  endM: number;
  direction: FlowDirection;
}

const ARROW: Record<FlowDirection, string> = {
  downstream: "↓",
  upstream: "↑",
  unknown: "·",
};

const FLIP: Record<FlowDirection, FlowDirection> = {
  downstream: "upstream",
  upstream: "downstream",
  unknown: "unknown",
};

function legLine(leg: FlowLeg): string {
  const miles = (leg.endM - leg.startM) / METERS_PER_MILE;
  const label = leg.direction === "unknown" ? "unknown flow" : leg.direction;
  return `${ARROW[leg.direction]} ${miles.toFixed(1)} mi ${label}`;
}

/**
 * Ordered, human-readable lines for a route's flow legs.
 *
 * One-way routes get just the forward lines. Out-and-back routes get the forward lines, a
 * "then back:" separator, then the return lines -- the same legs in reverse traversal order with
 * direction flipped (downstream <-> upstream; "unknown" stays "unknown"), since on the way back the
 * paddler is travelling the opposite way over the same water.
 */
export function narrateFlowLegs(
  flowLegs: FlowLeg[],
  shape: "one_way" | "out_and_back",
): string[] {
  const forward = flowLegs.map(legLine);
  if (shape !== "out_and_back") return forward;

  const back = [...flowLegs]
    .reverse()
    .map((leg) => legLine({ ...leg, direction: FLIP[leg.direction] }));

  return [...forward, "then back:", ...back];
}
