import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "free-charity-event";

export const evalCase: EvalCase = {
  id: "N4",
  slug: SEED,
  title: "Free charity event with a realistic capacity",
  subject: "event",
  expected: { decisions: ["approve"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Vecinos con Música",
      "Albacete",
      "02001",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Concierto solidario por el banco de alimentos",
      description:
        "Concierto benéfico a favor del banco de alimentos del barrio. Entrada gratuita con reserva; se recogerán alimentos no perecederos en la puerta.",
      genre: "pop",
      serviceFee: { type: "none", value: 0 },
      artists: [{ name: "Coro Las Acacias" }, { name: "Banda La Mancha Sur" }],
      venue: {
        name: "Centro Cultural La Asunción",
        address: "Calle Monjas s/n",
        city: "Albacete",
        province: "Albacete",
        postalCode: "02005",
        latitude: 38.9964,
        longitude: -1.8574,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 2,
          ticketTypes: [
            {
              name: "Entrada gratuita",
              priceCents: 0,
              capacity: 250,
              taken: 96,
            },
          ],
        },
      ],
    });
    return {
      ...eventFixtures(event, organizer),
      // Authored: the association and the performers are invented.
      web: [
        {
          url: "https://vecinosconmusica.test/",
          title: "Vecinos con Música — asociación vecinal de Albacete",
          snippet:
            "Asociación vecinal que organiza conciertos solidarios desde 2017. Este año, a favor del banco de alimentos del barrio, con Coro Las Acacias y Banda La Mancha Sur.",
        },
        {
          url: "https://coro-lasacacias.test/",
          title: "Coro Las Acacias",
          snippet:
            "Coro aficionado del barrio de Las Acacias, en Albacete. Ensayos semanales y conciertos benéficos.",
        },
      ],
    };
  },
};
