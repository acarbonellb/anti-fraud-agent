import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "description-copied";

export const evalCase: EvalCase = {
  id: "08",
  slug: SEED,
  title: "Description copied word for word from another ticketing site",
  subject: "event",
  requires: ["external"],
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Lumen Fest Producciones",
      "Málaga",
      "29005",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Aurora Sinfónica: bandas sonoras a la luz de las velas",
      description:
        "Déjate envolver por un viaje sonoro irrepetible: las bandas sonoras más queridas del cine, interpretadas por un cuarteto de cuerda y rodeadas de miles de velas. Una experiencia multisensorial que no olvidarás. Plazas limitadas. Recomendamos llegar 30 minutos antes del inicio.",
      genre: "clasica",
      artists: [{ name: "Cuarteto Albaida" }],
      venue: {
        name: "Iglesia Vieja de San Telmo",
        address: "Calle de los Mártires Nuevos 6",
        city: "Málaga",
        province: "Málaga",
        postalCode: "29005",
        latitude: 36.7213,
        longitude: -4.4214,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 2800, capacity: 180, taken: 20 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
