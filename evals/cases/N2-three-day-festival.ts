import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "three-day-festival";

export const evalCase: EvalCase = {
  id: "N2",
  slug: SEED,
  title: "Three-day festival with a coherent pass and day tickets",
  subject: "event",
  expected: { decisions: ["approve"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Ría Viva Festivales",
      "Pontevedra",
      "36001",
    );
    const day = { name: "Entrada de día", priceCents: 3500, capacity: 4000 };
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Festival Ría Viva",
      description:
        "Tres días de música junto a la ría: doce bandas, zona gastronómica y actividades para familias. El abono da acceso a los tres días.",
      genre: "festival",
      serviceFee: { type: "fixed", value: 200 },
      artists: [
        { name: "Os Faroleiros" },
        { name: "Marea de Fondo" },
        { name: "Lúa Chea" },
      ],
      venue: {
        name: "Alameda de Pontevedra",
        address: "Alameda do Arquitecto Sesmero s/n",
        city: "Pontevedra",
        province: "Pontevedra",
        postalCode: "36002",
        latitude: 42.4309,
        longitude: -8.6486,
      },
      sessions: [0, 1, 2].map((offset) => ({
        startsInHours: IN_THREE_WEEKS + offset * 24,
        durationHours: 9,
        ticketTypes:
          offset === 0
            ? [
                { ...day, taken: 600 },
                {
                  name: "Abono 3 días",
                  description: "Acceso los tres días del festival.",
                  priceCents: 8500,
                  capacity: 2000,
                  taken: 900,
                },
              ]
            : [{ ...day, taken: 500 }],
      })),
    });
    return eventFixtures(event, organizer, {
      benchmark: {
        sampleSize: 12,
        p10Cents: 2500,
        p50Cents: 4000,
        p90Cents: 9000,
        maxCents: 15_000,
      },
    });
  },
};
