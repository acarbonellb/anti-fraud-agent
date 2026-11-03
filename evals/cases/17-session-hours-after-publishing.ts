import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  madridTime,
} from "../builders.js";

const SEED = "session-hours-after-publishing";

export const evalCase: EvalCase = {
  id: "17",
  slug: SEED,
  title:
    "Published at night for a session the next morning, with a large capacity",
  subject: "event",
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
      title: "Concierto al amanecer en Escenario Santander",
      description: "Concierto al amanecer con Orquesta Brisa del Cantábrico.",
      genre: "clasica",
      artists: [{ name: "Orquesta Brisa del Cantábrico" }],
      // 23:00 the night before, Madrid time, for 09:00 the next morning.
      publishedHoursAgo: madridTime(clock, -1, 23),
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
          startsInHours: madridTime(clock, 0, 9),
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
