import type { EvalCase } from "../../src/evals/types.js";
import { buildOrganizer } from "../builders.js";

export const evalCase: EvalCase = {
  id: "21",
  slug: "owner-with-rejected-organization",
  title: "Owner with a rejected organization who creates another (organizer)",
  subject: "organizer",
  expected: { decisions: ["reject"], autonomy: "escalated" },
  build: (clock) => ({
    organizer: buildOrganizer(clock, {
      seed: "owner-with-rejected-organization",
      name: "Fiestas del Levante Feliz",
      status: "pending",
      description: "Organizamos fiestas y conciertos en la costa.",
      city: "Alicante",
      postalCode: "03001",
      createdDaysAgo: 1,
      accountAgeDays: 75,
      otherOrganizers: [{ status: "rejected", createdDaysAgo: 60 }],
      events: { published: 0, cancelled: 0, ended: 0 },
    }),
  }),
};
