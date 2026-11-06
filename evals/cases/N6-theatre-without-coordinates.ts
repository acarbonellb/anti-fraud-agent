import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  buildOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
  pageDate,
} from "../builders.js";

const SEED = "theatre-without-coordinates";

export const evalCase: EvalCase = {
  id: "N6",
  slug: SEED,
  title:
    "Real theatre stored without coordinates, established organizer, 250 tickets",
  subject: "event",
  expected: { decisions: ["approve"], autonomy: "auto_resolved" },
  build(clock) {
    // What the first staging pass met (#74): a real theatre whose venue has
    // no coordinates, so only its name, town and province can find it. The
    // theatre is real; the company and the play are invented (CLAUDE.md §5).
    const organizer = buildOrganizer(clock, {
      seed: `${SEED}:organizer`,
      name: "Tramoya Andante Producciones",
      description:
        "Compañía de teatro de texto. Giramos por teatros municipales desde 2016. Web: https://tramoya-andante.example.test.",
      city: "Alcalá de Henares",
      postalCode: "28801",
      createdDaysAgo: 1100,
      events: { published: 22, cancelled: 0, ended: 20 },
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "El reloj de arena",
      description:
        "Tramoya Andante estrena El reloj de arena, una comedia sobre tres hermanas que heredan una relojería. Duración: 90 minutos.",
      genre: "teatro",
      artists: [{ name: "Tramoya Andante" }],
      venue: {
        name: "Teatro Salón Cervantes",
        address: "Calle Cervantes 7",
        city: "Alcalá de Henares",
        province: "Madrid",
        postalCode: "28801",
        latitude: null,
        longitude: null,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          durationHours: 2,
          ticketTypes: [
            { name: "Patio", priceCents: 1600, capacity: 180, taken: 64 },
            { name: "Anfiteatro", priceCents: 1200, capacity: 70, taken: 22 },
          ],
        },
      ],
    });
    const day = pageDate(event.sessions[0]?.startsAt ?? clock.toISOString());
    return {
      ...eventFixtures(event, organizer),
      // Authored: the company and the play are invented (CLAUDE.md §5).
      web: [
        {
          url: "https://tramoya-andante.example.test/",
          title: "Tramoya Andante — compañía de teatro",
          snippet:
            "Compañía de teatro de texto desde 2016. Gira 2026: El reloj de arena. Archivo de montajes anteriores, dossier de prensa y contacto.",
        },
        {
          url: "https://tramoya-andante.example.test/gira",
          title: "El reloj de arena — gira",
          snippet: `Estreno de El reloj de arena: ${day}, Alcalá de Henares, Teatro Salón Cervantes. Entradas de patio y anfiteatro.`,
        },
      ],
    };
  },
};
