import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
  pageDate,
} from "../builders.js";

const SEED = "artist-booked-elsewhere";

export const evalCase: EvalCase = {
  id: "06",
  slug: SEED,
  title: "The artist has the same date announced in another city",
  subject: "event",
  expected: { decisions: ["reject"], autonomy: "escalated" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Granate Directo",
      "Granada",
      "18009",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Los Bárbaros del Sur: gira Tierra Quemada",
      description:
        "Los Bárbaros del Sur presentan su gira Tierra Quemada. Teloneros por confirmar.",
      genre: "rock",
      artists: [{ name: "Los Bárbaros del Sur" }],
      venue: {
        name: "Sala Planta Baja",
        address: "Calle Horno de Abad 11",
        city: "Granada",
        province: "Granada",
        postalCode: "18002",
        latitude: 37.1763,
        longitude: -3.6042,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 2400, capacity: 700, taken: 60 },
          ],
        },
      ],
    });
    const day = pageDate(event.sessions[0]?.startsAt ?? clock.toISOString());
    return {
      ...eventFixtures(event, organizer),
      // Authored: the band and its tour are invented (CLAUDE.md §5).
      web: [
        {
          url: "https://losbarbarosdelsur.test/gira-tierra-quemada",
          title: "Los Bárbaros del Sur — Gira Tierra Quemada: fechas",
          snippet: `Gira Tierra Quemada. ${day}: Bilbao, Festival Ola Norte (cabeza de cartel). Próximas fechas en Valencia y Zaragoza. Entradas solo en los enlaces de esta página.`,
        },
        {
          url: "https://festivalolanorte.test/cartel",
          title: "Festival Ola Norte — cartel por días",
          snippet: `${day}: Los Bárbaros del Sur cierran el escenario principal a las 23:30, presentando Tierra Quemada.`,
        },
      ],
    };
  },
};
