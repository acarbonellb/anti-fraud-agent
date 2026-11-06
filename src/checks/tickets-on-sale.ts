/**
 * What an event puts on sale, read from its review context: tickets and
 * money. Event properties, not venue ones: the venue checks and the autonomy
 * policy both read them from here.
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

/**
 * The money on sale: over every scheduled session, each standard ticket
 * type's capacity × price, in integer cents. The number the money cap reads
 * and its reason reports (#82). A free event puts none on sale.
 */
export function moneyOnSaleCents(context: EventReviewContext): number {
  let total = 0;
  for (const session of context.sessions) {
    if (session.status !== "scheduled") continue;
    for (const ticketType of session.ticketTypes) {
      if (ticketType.kind !== "standard") continue;
      total += ticketType.capacity * ticketType.priceCents;
    }
  }
  return total;
}
