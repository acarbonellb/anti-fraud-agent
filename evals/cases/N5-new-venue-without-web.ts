import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "new-venue-without-web";

export const evalCase: EvalCase = {
  id: "N5",
  slug: SEED,
  title: "New venue with no web presence but a verifiable commercial address",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Guadiana Directo",
      "Mérida",
      "06800",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Inauguración de Espacio Tinta",
      description:
        "Abrimos Espacio Tinta, una nueva sala en el polígono, con una noche de bandas emergentes.",
      genre: "rock",
      artists: [{ name: "Los Lagartos Azules" }],
      venue: {
        name: "Espacio Tinta",
        address: "Polígono Industrial El Prado Nuevo, nave 12",
        city: "Mérida",
        province: "Badajoz",
        postalCode: "06800",
        latitude: 38.9161,
        longitude: -6.3437,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 1200, capacity: 300, taken: 20 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
