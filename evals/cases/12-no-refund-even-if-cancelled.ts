import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "no-refund-even-if-cancelled";

export const evalCase: EvalCase = {
  id: "12",
  slug: SEED,
  title: "Terms: «no refund even if the event is cancelled»",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Comedia en Vena",
      "Barcelona",
      "08012",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Monólogos del jueves con Pau Rovelló",
      description:
        "Una hora de humor con Pau Rovelló y dos cómicos invitados. Mayores de 16 años.",
      genre: "humor",
      terms:
        "No se devolverá el dinero aunque se cancele el evento por cualquier motivo. La entrada es personal.",
      artists: [{ name: "Pau Rovelló" }],
      venue: {
        name: "Sala Apolo",
        address: "Carrer Nou de la Rambla 113",
        city: "Barcelona",
        province: "Barcelona",
        postalCode: "08001",
        latitude: 41.3744,
        longitude: 2.1696,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 2,
          ticketTypes: [
            { name: "General", priceCents: 1400, capacity: 120, taken: 18 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
