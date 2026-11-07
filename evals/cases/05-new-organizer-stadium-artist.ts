import type { EvalCase } from "../../src/evals/types.js";
import {
  buildEvent,
  buildOrganizer,
  eventFixtures,
  IN_THREE_WEEKS,
} from "../builders.js";

const SEED = "new-organizer-stadium-artist";

export const evalCase: EvalCase = {
  id: "05",
  slug: SEED,
  title:
    "New organizer, no website, a week-old Instagram, a «stadium» artist in a small room at 15 €",
  subject: "event",
  // Nothing the code checks is wrong with it: only the model can see that a
  // stadium artist in a small room from a week-old organizer is a lure.
  decidedBy: "model",
  expected: { decisions: ["reject"], autonomy: "escalated" },
  build(clock) {
    const organizer = buildOrganizer(clock, {
      seed: `${SEED}:organizer`,
      name: "Estrellas Cercanas Live",
      description: "Traemos a las grandes estrellas a tu ciudad.",
      legalName: null,
      taxId: { kind: "NIF" },
      city: "Murcia",
      postalCode: "30001",
      createdDaysAgo: 6,
      accountAgeDays: 7,
      events: { published: 1, cancelled: 0, ended: 0 },
    });
    const event = buildEvent(clock, organizer.organizer.id, {
      seed: SEED,
      title: "Valeria Montecristo en concierto íntimo",
      description:
        "La artista que llena estadios en toda Latinoamérica, por primera vez en una sala pequeña. Plazas muy limitadas.",
      genre: "pop",
      artists: [{ name: "Valeria Montecristo" }],
      venue: {
        name: "Garaje Beat Club",
        address: "Avenida Miguel de Cervantes 45",
        city: "Murcia",
        province: "Murcia",
        postalCode: "30009",
        latitude: 38.0012,
        longitude: -1.1446,
      },
      sessions: [
        {
          startsInHours: IN_THREE_WEEKS,
          ticketTypes: [
            { name: "General", priceCents: 1500, capacity: 250, taken: 0 },
          ],
        },
      ],
    });
    return {
      ...eventFixtures(event, organizer),
      // Authored: the artist and the organizer are invented (CLAUDE.md §5).
      web: [
        {
          url: "https://valeriamontecristo.test/gira",
          title: "Valeria Montecristo — Gira Estadios: todas las fechas",
          snippet:
            "Valeria Montecristo recorre los estadios de Latinoamérica y España con su Gira Estadios. Venta oficial solo a través de esta web. La gira no incluye salas pequeñas ni conciertos acústicos.",
        },
        {
          url: "https://noticias-ejemplo.test/musica/valeria-montecristo-agota-estadios",
          title: "Valeria Montecristo agota 60.000 entradas en dos horas",
          snippet:
            "La cantante Valeria Montecristo agotó las entradas de su gira de estadios. Su productora recuerda que no hay fechas en salas y alerta de reventa y eventos falsos con su nombre.",
        },
        {
          url: "https://redes-ejemplo.test/estrellascercanaslive",
          title: "Estrellas Cercanas Live (@estrellascercanaslive)",
          snippet:
            "Perfil creado hace una semana. 3 publicaciones, 41 seguidores. «Traemos a las grandes estrellas a tu ciudad».",
        },
      ],
    };
  },
};
