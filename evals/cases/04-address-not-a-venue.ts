import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "address-not-a-venue";

export const evalCase: EvalCase = {
  id: "04",
  slug: SEED,
  title: "Address is a block of flats and the coordinates fall in the sea",
  subject: "event",
  expected: {
    decisions: ["reject", "request_info"],
    autonomy: "escalated",
  },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Ona Clara Events",
      "Valencia",
      "46024",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Sunset Sessions junto al mar",
      description:
        "Sesión de música house al atardecer en Espacio Marea, con vistas al puerto.",
      genre: "electronica",
      artists: [{ name: "Nadia Corell" }],
      venue: {
        name: "Espacio Marea",
        address: "Avenida del Puerto Chico 221, 4.º C",
        city: "Valencia",
        province: "Valencia",
        postalCode: "46024",
        latitude: 39.41,
        longitude: -0.2,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 5,
          ticketTypes: [
            { name: "General", priceCents: 2500, capacity: 600, taken: 12 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
