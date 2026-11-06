import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  buildOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "previous-fraud-reports";

export const evalCase: EvalCase = {
  id: "23",
  slug: SEED,
  title: "Organizer with previous fraud reports publishes a new event",
  // The brief reviews the new event; the event review reads the organizer's
  // context and runs its history check (ADR 0012's heuristic
  // `organizer_history`), so the reports reach the agent in code (#82).
  subject: "event",
  expected: { decisions: ["request_info"], autonomy: "escalated" },
  build(clock) {
    const organizer = buildOrganizer(clock, {
      seed: `${SEED}:organizer`,
      name: "Ritmo Total Eventos",
      description: "Fiestas temáticas y conciertos tributo.",
      city: "Palma",
      postalCode: "07003",
      createdDaysAgo: 300,
      events: { published: 5, cancelled: 2, ended: 3 },
      contentReports: [
        { category: "fraud", status: "actioned", count: 3 },
        { category: "other", status: "dismissed", count: 1 },
      ],
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Tributo a los grandes del rock de los 80",
      description:
        "Tres bandas tributo repasan los éxitos del rock de los ochenta.",
      genre: "rock",
      artists: [{ name: "Neón Eterno" }, { name: "Los Casetes" }],
      venue: {
        name: "Es Gremi",
        address: "Carrer del Gremi de Porgadors 16",
        city: "Palma",
        province: "Illes Balears",
        postalCode: "07009",
        latitude: 39.5967,
        longitude: 2.6702,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 2000, capacity: 500, taken: 45 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
