import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "link-to-other-ticketing";

export const evalCase: EvalCase = {
  id: "11",
  slug: SEED,
  title: "Link to another ticketing site through a URL shortener",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Norte Bravo Conciertos",
      "Oviedo",
      "33003",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Xana Rock: gira de invierno",
      description:
        "Xana Rock vuelve a Oviedo con su gira de invierno. Entradas anticipadas con descuento en bit.ly/xana-invierno-entradas hasta fin de mes.",
      genre: "rock",
      artists: [{ name: "Xana Rock" }],
      venue: {
        name: "Sala El Hórreo Eléctrico",
        address: "Calle del Rosal Alto 17",
        city: "Oviedo",
        province: "Asturias",
        postalCode: "33003",
        latitude: 43.3619,
        longitude: -5.8494,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 1600, capacity: 450, taken: 55 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
