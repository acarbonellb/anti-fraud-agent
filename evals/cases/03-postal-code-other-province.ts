import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "postal-code-other-province";

export const evalCase: EvalCase = {
  id: "03",
  slug: SEED,
  title: "Madrid postal code with the province Sevilla",
  subject: "event",
  decidedBy: "code",
  expected: { decisions: ["request_info"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Tablao Compás Producciones",
      "Sevilla",
      "41003",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Noche flamenca con Rocío del Aljibe",
      description:
        "Cante, toque y baile con Rocío del Aljibe y su cuadro flamenco. Dos pases por noche.",
      genre: "flamenco",
      artists: [{ name: "Rocío del Aljibe" }],
      venue: {
        name: "Teatro Lope de Vega",
        address: "Avenida Honduras s/n",
        city: "Sevilla",
        province: "Sevilla",
        postalCode: "28013",
        latitude: 37.3786,
        longitude: -5.9908,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 2000, capacity: 220, taken: 30 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
