import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  buildOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "new-organizer-stadium-artist";

export const evalCase: EvalCase = {
  id: "05",
  slug: SEED,
  title:
    "New organizer, no website, a week-old Instagram, a «stadium» artist in a small room at 15 €",
  subject: "event",
  requires: ["external"],
  expected: { decisions: ["reject"], autonomy: "escalated" },
  build(clock) {
    const organizer = buildOrganizer(clock, {
      seed: `${SEED}:organizer`,
      name: "Estrellas Cercanas Live",
      description: "Traemos a las grandes estrellas a tu ciudad.",
      legalName: null,
      taxId: { kind: "NIF" },
      city: "Murcia",
      postalCode: "30001",
      createdDaysAgo: 6,
      accountAgeDays: 7,
      events: { published: 1, cancelled: 0, ended: 0 },
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Valeria Montecristo en concierto íntimo",
      description:
        "La artista que llena estadios en toda Latinoamérica, por primera vez en una sala pequeña. Plazas muy limitadas.",
      genre: "pop",
      artists: [{ name: "Valeria Montecristo" }],
      venue: {
        name: "Sala Pequeño Búho",
        address: "Calle de la Platería Vieja 21",
        city: "Murcia",
        province: "Murcia",
        postalCode: "30001",
        latitude: 37.9847,
        longitude: -1.1285,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 1500, capacity: 250, taken: 0 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
