import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "artist-booked-elsewhere";

export const evalCase: EvalCase = {
  id: "06",
  slug: SEED,
  title: "The artist has the same date announced in another city",
  subject: "event",
  requires: ["external"],
  expected: { decisions: ["reject"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Granate Directo",
      "Granada",
      "18009",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Los Bárbaros del Sur: gira Tierra Quemada",
      description:
        "Los Bárbaros del Sur presentan su gira Tierra Quemada. Teloneros por confirmar.",
      genre: "rock",
      artists: [{ name: "Los Bárbaros del Sur" }],
      venue: {
        name: "Sala Albaicín Sónico",
        address: "Camino de la Fuente Nueva 30",
        city: "Granada",
        province: "Granada",
        postalCode: "18009",
        latitude: 37.1795,
        longitude: -3.5986,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 2400, capacity: 700, taken: 60 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
