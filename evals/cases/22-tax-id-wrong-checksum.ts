import type { EvalCase } from "../../src/evals/types.js";
import { buildOrganizer } from "../builders.js";

export const evalCase: EvalCase = {
  id: "22",
  slug: "tax-id-wrong-checksum",
  title: "Tax id with a wrong control letter (organizer)",
  subject: "organizer",
  expected: { decisions: ["request_info"], autonomy: "auto_resolved" },
  build: (clock) => ({
    organizer: buildOrganizer(clock, {
      seed: "tax-id-wrong-checksum",
      name: "Brezo y Piedra Cultura",
      status: "pending",
      description: "Asociación que programa música folk en pueblos de León.",
      legalName: "Asociación Cultural Brezo y Piedra",
      taxId: { kind: "CIF", checksumValid: false },
      city: "León",
      postalCode: "24004",
      createdDaysAgo: 2,
      accountAgeDays: 30,
      events: { published: 0, cancelled: 0, ended: 0 },
    }),
  }),
};
