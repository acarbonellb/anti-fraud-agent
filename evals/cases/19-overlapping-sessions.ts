import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "overlapping-sessions";

export const evalCase: EvalCase = {
  id: "19",
  slug: SEED,
  title: "Two overlapping sessions at the same venue",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Telón Rojo Teatro",
      "Pamplona",
      "31001",
    );
    const ticketTypes = [
      { name: "Patio de butacas", priceCents: 2200, capacity: 300, taken: 25 },
    ];
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "El jardín de las sombras",
      description:
        "Compañía Hilo Fino estrena su nueva obra de teatro. Dos funciones el mismo día.",
      genre: "teatro",
      venue: {
        name: "Teatro Burgo Viejo",
        address: "Calle de la Estafeta Nueva 15",
        city: "Pamplona",
        province: "Navarra",
        postalCode: "31001",
        latitude: 42.8169,
        longitude: -1.6432,
      },
      sessions: [
        { startsInHours: IN_THREE_WEEKS, durationHours: 2, ticketTypes },
        { startsInHours: IN_THREE_WEEKS + 1, durationHours: 2, ticketTypes },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
