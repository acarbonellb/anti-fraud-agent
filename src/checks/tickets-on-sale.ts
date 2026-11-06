/**
 * How many tickets an event puts on sale, read from its review context. An
 * event property, not a venue one: the venue checks and the autonomy policy
 * both read it from here.
 */
import type { EventReviewContext } from "../satella-client/schemas.js";

/**
 * The most tickets on sale in any one scheduled session: the number the
 * capacity check and the exposure cap both read (CODING_STANDARDS «The same
 * calculation that decides, reports»). Guest lists aren't on sale.
 */
export function maxTicketsOnSale(context: EventReviewContext): number {
  let max = 0;
  for (const session of context.sessions) {
    if (session.status !== "scheduled") continue;
    const tickets = session.ticketTypes
      .filter((ticketType) => ticketType.kind === "standard")
      .reduce((total, ticketType) => total + ticketType.capacity, 0);
    max = Math.max(max, tickets);
  }
  return max;
}
