import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  buildOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
  similarEvent,
} from "../builders.js";

const SEED = "clone-of-other-organizer";
const TITLE = "Gran Gala de Zarzuela: La Verbena Eterna";
const VENUE = "Teatro Ribalta";

export const evalCase: EvalCase = {
  id: "07",
  slug: SEED,
  title: "Clone: same title, date and venue as another organizer's event",
  subject: "event",
  expected: { decisions: ["reject"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = buildOrganizer(clock, {
      seed: `${SEED}:organizer`,
      name: "Escenarios Charros",
      description: "Espectáculos de teatro y lírica.",
      city: "Salamanca",
      postalCode: "37002",
      createdDaysAgo: 20,
      events: { published: 1, cancelled: 0, ended: 0 },
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: TITLE,
      description:
        "Los grandes títulos de la zarzuela en una gala con orquesta, coro y solistas.",
      genre: "lirica",
      venue: {
        name: VENUE,
        address: "Plaza del Corrillo Alto 4",
        city: "Salamanca",
        province: "Salamanca",
        postalCode: "37002",
        latitude: 40.9651,
        longitude: -5.6637,
        sameNameOtherOrganizers: 1,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "Platea", priceCents: 3500, capacity: 400, taken: 8 },
          ],
        },
      ],
    });
    const startsAt = event.sessions[0]?.startsAt ?? "";
    return eventFixtures(event, organizer, {
      similar: [
        similarEvent(`${SEED}:original`, {
          title: TITLE,
          startsAt,
          venueName: VENUE,
          titleSimilarity: 1,
          sharesVenueName: true,
        }),
      ],
    });
  },
};
