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
  title: "Bar of about 140 people selling 2,000 tickets",
  subject: "event",
  decidedBy: "code",
  expected: { decisions: ["reject"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Garbanzo Negro Eventos",
      "Granada",
      "18001",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Fiesta de fin de temporada",
      description:
        "La fiesta de cierre de temporada en el bar de siempre del centro. DJ residente toda la noche.",
      genre: "electronica",
      artists: [{ name: "DJ Morcuera" }],
      venue: {
        name: "Masquevinos",
        address: "Calle Tundidores 10",
        city: "Granada",
        province: "Granada",
        postalCode: "18001",
        latitude: 37.1752,
        longitude: -3.5988,
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
