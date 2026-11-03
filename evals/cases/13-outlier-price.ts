import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "outlier-price";

export const evalCase: EvalCase = {
  id: "13",
  slug: SEED,
  title: "«General» at 950 € in a 300-person room",
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Patio Andalusí Producciones",
      "Córdoba",
      "14002",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Trío Azahar: jazz y copla",
      description:
        "El Trío Azahar mezcla jazz y copla en una noche en Sala Hangar, con aforo para 300 personas.",
      genre: "jazz",
      artists: [{ name: "Trío Azahar" }],
      venue: {
        name: "Sala Hangar",
        address: "Avenida de la Libertad 2",
        city: "Córdoba",
        province: "Córdoba",
        postalCode: "14006",
        latitude: 37.8924,
        longitude: -4.7827,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 95_000, capacity: 280, taken: 0 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
