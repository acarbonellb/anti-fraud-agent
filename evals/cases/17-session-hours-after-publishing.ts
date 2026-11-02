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
      title: "Concierto al amanecer en el Muelle Grande",
      description:
        "Concierto al aire libre al amanecer con Orquesta Brisa del Cantábrico.",
      genre: "clasica",
      artists: [{ name: "Orquesta Brisa del Cantábrico" }],
      publishedHoursAgo: 1,
      venue: {
        name: "Explanada del Muelle Grande",
        address: "Paseo del Muelle Grande s/n",
        city: "Santander",
        province: "Cantabria",
        postalCode: "39004",
        latitude: 43.4607,
        longitude: -3.8011,
      },
      sessions: [
        {
          startsInHours: 10,
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
