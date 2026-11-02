import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "service-fee-45-percent";

export const evalCase: EvalCase = {
  id: "15",
  slug: SEED,
  title: "Service fee of 45 %",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Tramontana Escena",
      "Girona",
      "17001",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Cabaret de invierno en el Teatre de les Voltes",
      description:
        "Números de cabaret, música en directo y humor en una noche de invierno.",
      genre: "cabaret",
      serviceFee: { type: "percent", value: 45 },
      venue: {
        name: "Teatre de les Voltes",
        address: "Carrer de les Muralles Baixes 7",
        city: "Girona",
        province: "Girona",
        postalCode: "17001",
        latitude: 41.9853,
        longitude: 2.8241,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 2,
          ticketTypes: [
            { name: "General", priceCents: 2000, capacity: 260, taken: 22 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
