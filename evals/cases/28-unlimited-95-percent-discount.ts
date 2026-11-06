import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "unlimited-95-percent-discount";

// A clean event but for one active 95 % code with no usage limit: anyone who
// has it can buy the whole event at a twentieth of its price. Only that
// heuristic warning should reach the admin.
export const evalCase: EvalCase = {
  id: "28",
  slug: SEED,
  title: "Active 95 % discount code with no usage limit",
  subject: "event",
  decidedBy: "code",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Páramo Sonoro",
      "Burgos",
      "09003",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Las Golondrinas de Papel en concierto",
      description:
        "Las Golondrinas de Papel vuelven a Burgos con canciones nuevas y las de siempre.",
      genre: "pop",
      artists: [{ name: "Las Golondrinas de Papel" }],
      // Real, and its lookups are the ones recorded for case 14: the venue
      // is not this case's point.
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
            { name: "General", priceCents: 2200, capacity: 300, taken: 31 },
          ],
        },
      ],
      discounts: [
        {
          scope: "event",
          percent: 10,
          maxUses: 40,
          timesUsed: 6,
          active: true,
        },
        {
          scope: "event",
          percent: 95,
          maxUses: null,
          timesUsed: 4,
          active: true,
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
