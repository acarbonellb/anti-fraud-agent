import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  buildOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
  stableId,
} from "../builders.js";

const SEED = "edited-to-ask-for-bizum";

export const evalCase: EvalCase = {
  id: "26",
  slug: SEED,
  title: "Approved, then edited: the description now asks for Bizum",
  subject: "event",
  expected: { decisions: ["reject"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = buildOrganizer(clock, {
      seed: `${SEED}:organizer`,
      name: "Sonidos del Tormes",
      description: "Conciertos de música de autor en salas pequeñas.",
      city: "Zamora",
      postalCode: "49001",
      createdDaysAgo: 500,
      events: { published: 8, cancelled: 0, ended: 7 },
      previousAgentReviews: [
        {
          // The same event, reviewed and approved before the edit.
          subject: { type: "event", id: stableId("evt", SEED) },
          decision: "approve",
          status: "auto_resolved",
          createdDaysAgo: 3,
        },
      ],
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Canciones de ida y vuelta con Lucía Barbadillo",
      description:
        "Lucía Barbadillo presenta su nuevo disco en formato acústico. ¡Últimas plazas! Reserva por Bizum al 600 000 000 y paga la mitad.",
      genre: "cantautor",
      artists: [{ name: "Lucía Barbadillo" }],
      publishedHoursAgo: 72,
      editedHoursAfterPublishing: 70,
      venue: {
        name: "Sala El Puente de Piedra",
        address: "Calle de la Rúa Alta 22",
        city: "Zamora",
        province: "Zamora",
        postalCode: "49001",
        latitude: 41.5034,
        longitude: -5.7446,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 1500, capacity: 160, taken: 70 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
