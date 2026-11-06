// Checks what an event puts on sale, read from its review context: the most
// tickets in one session and the money across all sessions. Pure functions
// over the fixture's context; fakes nothing.
import { describe, expect, it } from "vitest";

import type { EventReviewContext } from "../satella-client/schemas.js";
import { fixtures } from "../satella-client/fixtures.js";
import { maxTicketsOnSale, moneyOnSaleCents } from "./tickets-on-sale.js";

type Session = EventReviewContext["sessions"][number];
type TicketType = Session["ticketTypes"][number];

const base = fixtures.eventContext;
const [baseSession] = base.sessions;
const [baseTicket] = baseSession?.ticketTypes ?? [];
if (baseSession === undefined || baseTicket === undefined)
  throw new Error("fixture without a session or a ticket type");

const ticket = (overrides: Partial<TicketType>): TicketType => ({
  ...baseTicket,
  kind: "standard",
  ...overrides,
});
const session = (
  ticketTypes: TicketType[],
  status: Session["status"] = "scheduled",
): Session => ({ ...baseSession, status, ticketTypes });
const withSessions = (sessions: Session[]): EventReviewContext => ({
  ...base,
  sessions,
});

describe("moneyOnSaleCents", () => {
  it("adds capacity × price over every scheduled session", () => {
    // 300 × 9,50 € + 50 × 20 € = 3.850 €, twice.
    const tickets = [
      ticket({ capacity: 300, priceCents: 950 }),
      ticket({ capacity: 50, priceCents: 2000 }),
    ];
    const context = withSessions([session(tickets), session(tickets)]);

    expect(moneyOnSaleCents(context)).toBe(770_000);
    expect(maxTicketsOnSale(context)).toBe(350);
  });

  it("leaves out cancelled sessions and guest lists", () => {
    const context = withSessions([
      session([
        ticket({ capacity: 100, priceCents: 1000 }),
        ticket({ kind: "guest_list", capacity: 50, priceCents: 1000 }),
      ]),
      session([ticket({ capacity: 999, priceCents: 1000 })], "cancelled"),
    ]);

    expect(moneyOnSaleCents(context)).toBe(100_000);
  });

  it("is zero for a free event", () => {
    const context = withSessions([
      session([ticket({ capacity: 50_000, priceCents: 0 })]),
    ]);

    expect(moneyOnSaleCents(context)).toBe(0);
  });
});
