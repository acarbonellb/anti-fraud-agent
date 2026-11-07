import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
} from "../builders.js";

const SEED = "session-hours-after-publishing";

export const evalCase: EvalCase = {
  id: "17",
  slug: SEED,
  title:
    "Published hours before a session later the same night, with a large capacity",
  subject: "event",
  decidedBy: "code",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Alborada Conciertos",
      "Santander",
      "39004",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Concierto al amanecer",
      description: "Concierto al amanecer con Orquesta Brisa del Cantábrico.",
      genre: "clasica",
      artists: [{ name: "Orquesta Brisa del Cantábrico" }],
      // Published 3 h before the review for a session 8 h after publishing:
      // imminent, and still ahead of the review at any clock.
      publishedHoursAgo: 3,
      venue: {
        name: "Escenario Santander",
        address: "Avenida de la Constitución 39",
        city: "Santander",
        province: "Cantabria",
        postalCode: "39012",
        latitude: 43.4733,
        longitude: -3.8066,
      },
      sessions: [
        {
          startsInHours: 8,
          durationHours: 2,
          ticketTypes: [
            { name: "General", priceCents: 1500, capacity: 3000, taken: 0 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
