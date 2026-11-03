import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  buildOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "room-of-400-selling-350";

export const evalCase: EvalCase = {
  id: "N1",
  slug: SEED,
  title:
    "Room of 400, 350 tickets, organizer with a website and socials, median price",
  subject: "event",
  expected: { decisions: ["approve"], autonomy: "auto_resolved" },
  build(clock) {
    // The contract has no website field: an organizer shows it, if at all,
    // in its description. Verifying it is `webSearch`'s job (#7). The room is
    // real and OpenStreetMap publishes its capacity of 400.
    const organizer = buildOrganizer(clock, {
      seed: `${SEED}:organizer`,
      name: "Campo Grande Música",
      description:
        "Promotora de conciertos en el sur de Pontevedra desde 2015. Web: https://campogrande-musica.example.test · Instagram y Facebook: @campograndemusica.",
      city: "Ponteareas",
      postalCode: "36860",
      createdDaysAgo: 900,
      events: { published: 14, cancelled: 0, ended: 12 },
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "La Ruta Lenta presenta Kilómetro Cero",
      description:
        "La Ruta Lenta presenta en directo su nuevo disco, Kilómetro Cero, con banda completa.",
      genre: "indie",
      artists: [{ name: "La Ruta Lenta" }, { name: "Mar de Trigo" }],
      venue: {
        name: "Auditorio Reveriano Soutullo",
        address: "Rúa da Estrada s/n",
        city: "Ponteareas",
        province: "Pontevedra",
        postalCode: "36860",
        latitude: 42.1743,
        longitude: -8.5066,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 1800, capacity: 350, taken: 140 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
