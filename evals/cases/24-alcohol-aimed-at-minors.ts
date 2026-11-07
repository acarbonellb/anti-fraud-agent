import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "alcohol-aimed-at-minors";

export const evalCase: EvalCase = {
  id: "24",
  slug: SEED,
  title: "«Botellón +14»",
  subject: "event",
  decidedBy: "code",
  expected: { decisions: ["reject"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Juerga Joven Producciones",
      "Jaén",
      "23001",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Botellón +14 de fin de curso",
      description:
        "La fiesta de fin de curso para +14: música, cervezas y barra libre hasta las 2.",
      genre: "fiesta",
      artists: [{ name: "DJ Olivo" }],
      venue: {
        name: "Teatro Darymelia",
        address: "Calle Colón 6",
        city: "Jaén",
        province: "Jaén",
        postalCode: "23004",
        latitude: 37.7665,
        longitude: -3.7914,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 6,
          ticketTypes: [
            { name: "General", priceCents: 1000, capacity: 800, taken: 120 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
