import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
} from "../builders.js";

const SEED = "session-three-years-away";

export const evalCase: EvalCase = {
  id: "18",
  slug: SEED,
  title: "Session three years away with the whole capacity on sale",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Horizonte Lejano Eventos",
      "Logroño",
      "26001",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Gira del aniversario de Viento de Cierzo",
      description:
        "Viento de Cierzo celebra sus veinte años con un concierto especial. Compra ya tu entrada.",
      genre: "pop",
      artists: [{ name: "Viento de Cierzo" }],
      venue: {
        name: "Palacio de los Calados",
        address: "Avenida de la Vendimia 50",
        city: "Logroño",
        province: "La Rioja",
        postalCode: "26001",
        latitude: 42.4627,
        longitude: -2.445,
      },
      sessions: [
        {
          startsInHours: 3 * 365 * 24,
          ticketTypes: [
            { name: "General", priceCents: 3500, capacity: 2500, taken: 0 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
