import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "free-with-50000-tickets";

export const evalCase: EvalCase = {
  id: "16",
  slug: SEED,
  title: "Free, with 50,000 tickets, at a venue of unknown capacity",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Pulso Industrial",
      "Toledo",
      "45007",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Rave gratuita de doce horas",
      description:
        "Doce horas de techno en la sala. Entrada gratuita con inscripción.",
      genre: "electronica",
      serviceFee: { type: "none", value: 0 },
      artists: [{ name: "Kolektiv Arena" }],
      venue: {
        name: "Sala Pícaro",
        address: "Calle de las Cadenas 6",
        city: "Toledo",
        province: "Toledo",
        postalCode: "45001",
        latitude: 39.8596,
        longitude: -4.0229,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 12,
          ticketTypes: [
            { name: "General", priceCents: 0, capacity: 50_000, taken: 310 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
