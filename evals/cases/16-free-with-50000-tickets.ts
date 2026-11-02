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
  title: "Free, with 50,000 tickets, in a warehouse of unknown capacity",
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
      title: "Rave gratuita en la Nave 7",
      description:
        "Doce horas de techno en una nave del polígono. Entrada gratuita con inscripción.",
      genre: "electronica",
      serviceFee: { type: "none", value: 0 },
      artists: [{ name: "Kolektiv Arena" }],
      venue: {
        name: "Nave 7 del Polígono La Estación",
        address: "Calle del Ferrocarril Viejo, nave 7",
        city: "Toledo",
        province: "Toledo",
        postalCode: "45007",
        latitude: 39.8628,
        longitude: -4.0273,
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
