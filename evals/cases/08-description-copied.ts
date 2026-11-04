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
  // The code searches the text since #37 (E012): the model never did (E004).
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
        name: "Teatro Cervantes",
        address: "Calle Ramos Marín s/n",
        city: "Málaga",
        province: "Málaga",
        postalCode: "29012",
        latitude: 36.7248,
        longitude: -4.4185,
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
    const copied = event.event.description ?? "";
    return {
      ...eventFixtures(event, organizer),
      // Authored: the original organizer and ticketing site are invented.
      web: [
        {
          url: "https://entradas-ejemplo.test/eventos/bandas-sonoras-velas",
          title:
            "Bandas sonoras a la luz de las velas — Velas y Cuerdas Producciones | EntradasEjemplo",
          snippet: copied,
        },
        {
          url: "https://velasycuerdas.test/",
          title:
            "Velas y Cuerdas Producciones: conciertos a la luz de las velas",
          snippet:
            "Desde 2019 organizamos conciertos de bandas sonoras con cuarteto de cuerda y miles de velas. Venta exclusiva en EntradasEjemplo.",
        },
      ],
    };
  },
};
