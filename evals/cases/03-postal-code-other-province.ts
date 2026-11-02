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
        name: "Teatro Alcaraván",
        address: "Calle de la Alfalfa Nueva 8",
        city: "Sevilla",
        province: "Sevilla",
        postalCode: "28013",
        latitude: 37.3925,
        longitude: -5.9931,
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
