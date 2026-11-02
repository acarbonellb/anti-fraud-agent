import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
  stableId,
} from "../builders.js";

const SEED = "poster-of-other-ticketing";

export const evalCase: EvalCase = {
  id: "09",
  slug: SEED,
  title: "Poster with another ticketing site's logo and QR code",
  subject: "event",
  requires: ["external"],
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Cierzo Sonoro",
      "Huesca",
      "22002",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Festival de bandas locales del Alto Aragón",
      description:
        "Seis bandas de la provincia en una tarde de rock y pop. El cartel completo está en la imagen.",
      genre: "rock",
      artists: [{ name: "Peña Ventana" }, { name: "Las Tremolinas" }],
      imageUrls: [
        `https://images.example.test/posters/${stableId("img", SEED)}.jpg`,
      ],
      venue: {
        name: "Pabellón Las Mallatas",
        address: "Avenida de los Pirineos Altos 2",
        city: "Huesca",
        province: "Huesca",
        postalCode: "22002",
        latitude: 42.1401,
        longitude: -0.4089,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 7,
          ticketTypes: [
            { name: "General", priceCents: 1500, capacity: 900, taken: 70 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
