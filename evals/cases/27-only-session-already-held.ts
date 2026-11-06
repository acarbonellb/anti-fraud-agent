import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
} from "../builders.js";

const SEED = "only-session-already-held";

// Past the brief §5 dataset: the first staging pass (#71, slice 1) reviewed
// events whose sessions were already over. Nothing here is fraud: the event
// is stale in the feed, so the admin has to look, and the agent asks.
export const evalCase: EvalCase = {
  id: "27",
  slug: SEED,
  title: "Published weeks ago for a session already held, still selling",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Mareas del Norte Producciones",
      "Santander",
      "39002",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Noche de boleros con el Trío Salitre",
      description:
        "El Trío Salitre repasa los boleros de siempre en una noche íntima en Santander.",
      genre: "bolero",
      artists: [{ name: "Trío Salitre" }],
      // Published 40 days ago for a session 37 days later: three days ago.
      publishedHoursAgo: 40 * 24,
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
          startsInHours: 37 * 24,
          durationHours: 2,
          ticketTypes: [
            { name: "General", priceCents: 1800, capacity: 600, taken: 212 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
