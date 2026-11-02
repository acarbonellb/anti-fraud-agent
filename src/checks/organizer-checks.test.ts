// Checks the deterministic organizer checks over contexts built from the
// fictitious fixture. Pure function; fakes nothing.
import { expect, it } from "vitest";

import { fixtures } from "../satella-client/fixtures.js";
import type { OrganizerReviewContext } from "../satella-client/schemas.js";
import { runOrganizerChecks } from "./organizer-checks.js";

function checks(
  change: (draft: OrganizerReviewContext) => void = () => undefined,
) {
  const draft = structuredClone(fixtures.organizerContext);
  change(draft);
  return runOrganizerChecks(draft);
}

it("passes the clean fixture organizer", () => {
  expect(checks().every((item) => item.finding.verdict === "pass")).toBe(true);
});

it("fails a tax id with a wrong checksum, as a rule", () => {
  const [identity] = checks((draft) => {
    draft.fiscal.taxId = { present: true, kind: "NIF", checksumValid: false };
  });

  expect(identity?.certainty).toBe("rule");
  expect(identity?.finding.verdict).toBe("fail");
  expect(identity?.finding.detail).toContain("dígito de control");
});

it("warns, as a heuristic, about a rejected organization and fraud reports", () => {
  const history = checks((draft) => {
    draft.owner.otherOrganizers = [
      { status: "rejected", createdAt: "2026-09-01T10:00:00.000Z" },
    ];
    draft.history.contentReports = [
      { category: "fraud", status: "actioned", count: 2 },
    ];
  }).filter((item) => item.finding.check === "organizer_history");

  expect(history.map((item) => [item.certainty, item.finding.verdict])).toEqual(
    [
      ["heuristic", "warn"],
      ["heuristic", "warn"],
    ],
  );
});
