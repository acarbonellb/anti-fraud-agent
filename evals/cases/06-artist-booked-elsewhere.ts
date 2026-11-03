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
        name: "Sala Planta Baja",
        address: "Calle Horno de Abad 11",
        city: "Granada",
        province: "Granada",
        postalCode: "18002",
        latitude: 37.1763,
        longitude: -3.6042,
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
