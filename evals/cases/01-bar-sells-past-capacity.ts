import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "bar-sells-past-capacity";

export const evalCase: EvalCase = {
  id: "01",
  slug: SEED,
  title: "Bar of about 150 people selling 2,000 tickets",
  subject: "event",
  requires: ["external"],
  expected: { decisions: ["reject"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Garbanzo Negro Eventos",
      "Zaragoza",
      "50003",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Fiesta de fin de temporada en El Trasiego",
      description:
        "La fiesta de cierre de temporada en el bar de siempre del Casco. DJ residente toda la noche.",
      genre: "electronica",
      artists: [{ name: "DJ Morcuera" }],
      venue: {
        name: "Bar El Trasiego",
        address: "Calle del Tonelero 14",
        city: "Zaragoza",
        province: "Zaragoza",
        postalCode: "50003",
        latitude: 41.6531,
        longitude: -0.8794,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 6,
          ticketTypes: [
            { name: "General", priceCents: 1200, capacity: 2000, taken: 35 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
