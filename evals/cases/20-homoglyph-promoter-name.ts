import type { EvalCase } from "../../src/evals/types.js";
import { buildOrganizer } from "../builders.js";

export const evalCase: EvalCase = {
  id: "20",
  slug: "homoglyph-promoter-name",
  title:
    "Name almost identical to a known promoter's, with a Cyrillic letter (organizer)",
  subject: "organizer",
  decidedBy: "code",
  expected: { decisions: ["reject"], autonomy: "escalated" },
  build: (clock) => ({
    // Authored: both promoters are invented. The real-looking one is spelt
    // with Latin letters only.
    web: [
      {
        url: "https://noctambulalive.test/",
        title: "Noctámbula Live — promotora de festivales electrónicos",
        snippet:
          "Noctámbula Live: promotora líder en festivales de música electrónica desde 2009. Nuestras entradas se venden solo en nuestra web y en ticketeras oficiales.",
      },
      {
        url: "https://noticias-ejemplo.test/noctambula-live-aviso-suplantacion",
        title: "Noctámbula Live avisa de perfiles que se hacen pasar por ella",
        snippet:
          "La promotora Noctámbula Live alerta de cuentas nuevas con un nombre casi idéntico que venden entradas falsas para sus festivales.",
      },
    ],
    organizer: buildOrganizer(clock, {
      seed: "homoglyph-promoter-name",
      // The first «о» is Cyrillic (U+043E).
      name: "Nоctámbula Live",
      status: "pending",
      description:
        "Promotora líder en festivales de música electrónica desde 2009.",
      city: "Madrid",
      postalCode: "28004",
      createdDaysAgo: 3,
      accountAgeDays: 3,
      events: { published: 0, cancelled: 0, ended: 0 },
    }),
  }),
};
