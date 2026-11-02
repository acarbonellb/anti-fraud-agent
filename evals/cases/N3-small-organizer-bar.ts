import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  buildOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "small-organizer-bar";

export const evalCase: EvalCase = {
  id: "N3",
  slug: SEED,
  title:
    "Small organizer with an Instagram active for years and 80 tickets in a bar",
  subject: "event",
  expected: { decisions: ["approve"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = buildOrganizer(clock, {
      seed: `${SEED}:organizer`,
      name: "Peña Gatuna",
      description:
        "Asociación de amigos de la música en directo. Conciertos pequeños en bares de Lugo desde hace años.",
      legalName: "Asociación Cultural Peña Gatuna",
      city: "Lugo",
      postalCode: "27001",
      createdDaysAgo: 1500,
      events: { published: 9, cancelled: 0, ended: 8 },
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Concierto de Os Vagalumes en La Tartana",
      description:
        "Os Vagalumes tocan sus canciones de siempre en La Tartana. Aforo reducido.",
      genre: "folk",
      artists: [{ name: "Os Vagalumes" }],
      venue: {
        name: "Bar La Tartana",
        address: "Rúa da Muralla Baixa 5",
        city: "Lugo",
        province: "Lugo",
        postalCode: "27001",
        latitude: 43.0097,
        longitude: -7.5567,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 2,
          ticketTypes: [
            { name: "General", priceCents: 800, capacity: 80, taken: 31 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer, {
      benchmark: {
        sampleSize: 18,
        p10Cents: 500,
        p50Cents: 900,
        p90Cents: 1500,
        maxCents: 2500,
      },
    });
  },
};
