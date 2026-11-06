// Checks the deterministic organizer checks over contexts built from the
// fictitious fixture, and their history part that event reviews reuse. Pure
// functions; fake nothing.
import { expect, it } from "vitest";

import { fixtures } from "../satella-client/fixtures.js";
import type { OrganizerReviewContext } from "../satella-client/schemas.js";
import {
  organizerHistoryChecks,
  runOrganizerChecks,
} from "./organizer-checks.js";

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

it.each([
  ["missing", { present: false, kind: "unknown", checksumValid: null }],
  ["unverifiable", { present: true, kind: "NIF", checksumValid: null }],
] as const)(
  "gives a %s tax id no confidence, since it reached no verdict",
  (_, taxId) => {
    const [identity] = checks((draft) => {
      draft.fiscal.taxId = { ...taxId };
    });

    expect(identity?.finding.verdict).toBe("unknown");
    expect(identity?.finding.confidence).toBe(0);
  },
);

it("keeps full confidence on a tax id it checked", () => {
  const [identity] = checks();

  expect(identity?.finding.verdict).toBe("pass");
  expect(identity?.finding.confidence).toBe(1);
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

it("checks only the history for an event's organizer: a warn on a rejected organization", () => {
  const draft = structuredClone(fixtures.organizerContext);
  draft.owner.otherOrganizers = [
    { status: "rejected", createdAt: "2026-09-01T10:00:00.000Z" },
  ];

  const history = organizerHistoryChecks(draft);

  expect(
    history.map((item) => [item.finding.check, item.finding.verdict]),
  ).toEqual([["organizer_history", "warn"]]);
  expect(history[0]?.finding.detail).toContain("rechazada");
});

it("passes the history of a clean organizer, so the admin sees it was checked", () => {
  expect(
    organizerHistoryChecks(fixtures.organizerContext).map((item) => [
      item.finding.check,
      item.finding.verdict,
    ]),
  ).toEqual([["organizer_history", "pass"]]);
});
