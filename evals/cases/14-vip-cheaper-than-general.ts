import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "vip-cheaper-than-general";

export const evalCase: EvalCase = {
  id: "14",
  slug: SEED,
  title: "«VIP» costs less than «General»",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Meseta Beat",
      "Burgos",
      "09003",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Noche indie con Las Ardillas Rojas",
      description:
        "Las Ardillas Rojas presentan su segundo disco. La entrada VIP incluye acceso a la prueba de sonido.",
      genre: "indie",
      artists: [{ name: "Las Ardillas Rojas" }],
      venue: {
        name: "Teatro Principal",
        address: "Paseo del Espolón s/n",
        city: "Burgos",
        province: "Burgos",
        postalCode: "09003",
        latitude: 42.3406,
        longitude: -3.7002,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 2500, capacity: 350, taken: 40 },
            { name: "VIP", priceCents: 1800, capacity: 50, taken: 9 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
