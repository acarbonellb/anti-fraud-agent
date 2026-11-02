import type { EvalCase } from "../../src/evals/types.js";
import { buildOrganizer } from "../builders.js";

export const evalCase: EvalCase = {
  id: "20",
  slug: "homoglyph-promoter-name",
  title:
    "Name almost identical to a known promoter's, with a Cyrillic letter (organizer)",
  subject: "organizer",
  requires: ["external"],
  expected: { decisions: ["reject"], autonomy: "escalated" },
  build: (clock) => ({
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
