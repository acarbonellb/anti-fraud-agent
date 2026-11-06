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
  decidedBy: "code",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Itsasargi Kontzertuak",
      "Madrid",
      "28012",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Hiru Haize en directo",
      description:
        "Presentación del nuevo disco de Hiru Haize. El teatro abre también su terraza para la ocasión.",
      genre: "rock",
      artists: [{ name: "Hiru Haize" }],
      venue: {
        name: "Teatro Albéniz",
        address: "Calle de la Paz 11",
        city: "Madrid",
        province: "Madrid",
        postalCode: "28012",
        latitude: 40.4154,
        longitude: -3.704,
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
