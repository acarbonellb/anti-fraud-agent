import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "room-sells-past-capacity";

export const evalCase: EvalCase = {
  id: "02",
  slug: SEED,
  title: "Room of 900 selling 1,100 tickets (a terrace?)",
  subject: "event",
  requires: ["external"],
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Itsasargi Kontzertuak",
      "Bilbao",
      "48005",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Hiru Haize en directo",
      description:
        "Presentación del nuevo disco de Hiru Haize. La sala abre también su terraza para la ocasión.",
      genre: "rock",
      artists: [{ name: "Hiru Haize" }],
      venue: {
        name: "Sala Gaztelu",
        address: "Calle del Muelle Viejo 3",
        city: "Bilbao",
        province: "Bizkaia",
        postalCode: "48005",
        latitude: 43.2572,
        longitude: -2.9236,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 2200, capacity: 1100, taken: 240 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
