import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  establishedOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "bizum-payment";

export const evalCase: EvalCase = {
  id: "10",
  slug: SEED,
  title: "«Pay by Bizum to 6XX… and skip the fees»",
  subject: "event",
  expected: { decisions: ["reject"], autonomy: "auto_resolved" },
  build(clock) {
    const organizer = establishedOrganizer(
      clock,
      SEED,
      "Ruta del Duende Música",
      "Cádiz",
      "11002",
    );
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Acústico en el Gran Teatro Falla",
      description:
        "Concierto acústico de Marina Escalante frente al mar. Paga por Bizum al 600 000 000 y te ahorras los gastos de gestión; pon tu nombre en el concepto y te apuntamos en la lista.",
      genre: "pop",
      artists: [{ name: "Marina Escalante" }],
      venue: {
        name: "Gran Teatro Falla",
        address: "Plaza de Falla s/n",
        city: "Cádiz",
        province: "Cádiz",
        postalCode: "11003",
        latitude: 36.5337,
        longitude: -6.3024,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 1800, capacity: 150, taken: 4 },
          ],
        },
      ],
    });
    return eventFixtures(event, organizer);
  },
};
