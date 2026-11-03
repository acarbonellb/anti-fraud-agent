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
        "Asociación de amigos de la música en directo. Conciertos pequeños en bares de Lugo; los anunciamos en Instagram, @penagatuna, desde 2019.",
      legalName: "Asociación Cultural Peña Gatuna",
      city: "Lugo",
      postalCode: "27001",
      createdDaysAgo: 1500,
      events: { published: 9, cancelled: 0, ended: 8 },
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Concierto de Os Vagalumes en el Clavicembalo",
      description:
        "Os Vagalumes tocan sus canciones de siempre en el Clavicembalo. Aforo reducido.",
      genre: "folk",
      artists: [{ name: "Os Vagalumes" }],
      venue: {
        name: "Club Clavicembalo",
        address: "Rúa dos Paxariños 23",
        city: "Lugo",
        province: "Lugo",
        postalCode: "27002",
        latitude: 43.01,
        longitude: -7.5511,
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
