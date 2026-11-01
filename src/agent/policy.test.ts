// Checks the graded-autonomy policy (brief §4.2): when an approval or a
// rejection may resolve on its own and when it must go to a person. Pure
// function; fakes nothing.
import { describe, expect, it } from "vitest";

import type { Finding } from "../satella-client/schemas.js";
import { decideAutonomy } from "./policy.js";

const THRESHOLD = 0.85;
const source = { url: "https://example.test/evidence", title: "Evidencia" };

function finding(
  check: string,
  verdict: Finding["verdict"],
  sources: Finding["sources"] = [],
): Finding {
  return { check, verdict, detail: "detalle", confidence: 0.9, sources };
}

function decide(
  decision: "approve" | "reject" | "request_info",
  findings: Finding[],
  confidence = 0.95,
) {
  return decideAutonomy({
    decision,
    confidence,
    findings,
    autoApproveThreshold: THRESHOLD,
  });
}

describe("approve", () => {
  it("resolves on its own when every check passes and confidence is high", () => {
    expect(decide("approve", [finding("venue_exists", "pass")]).autonomy).toBe(
      "auto_resolved",
    );
  });

  it("tolerates a single minor warning", () => {
    const verdict = decide("approve", [
      finding("venue_exists", "pass"),
      finding("organizer_web_presence", "warn"),
    ]);

    expect(verdict.autonomy).toBe("auto_resolved");
  });

  it.each([
    ["a failed check", [finding("venue_exists", "fail")]],
    ["a warning on a fraud signal", [finding("price_sanity", "warn")]],
    [
      "two minor warnings",
      [
        finding("organizer_web_presence", "warn"),
        finding("text_originality", "warn"),
      ],
    ],
    ["a warning from an unknown check", [finding("brand_new_check", "warn")]],
  ])("escalates with %s", (_, findings) => {
    expect(decide("approve", findings).autonomy).toBe("escalated");
  });

  it("escalates below the confidence threshold, saying why", () => {
    const verdict = decide("approve", [finding("venue_exists", "pass")], 0.8);

    expect(verdict.autonomy).toBe("escalated");
    expect(verdict.reasons).toEqual(["confidence 0.8 below 0.85"]);
  });
});

describe("reject", () => {
  it("resolves on its own on a sourced hard signal", () => {
    const verdict = decide("reject", [
      finding("off_platform_payment", "fail", [source]),
    ]);

    expect(verdict).toEqual({
      autonomy: "auto_resolved",
      reasons: ["hard signals: off_platform_payment"],
    });
  });

  it.each([
    [
      "a hard signal without sources",
      [finding("off_platform_payment", "fail")],
    ],
    [
      "a sourced fail that isn't a hard signal",
      [finding("price_sanity", "fail", [source])],
    ],
    [
      "a hard-signal check that only warns",
      [finding("off_platform_payment", "warn", [source])],
    ],
  ])("escalates with %s", (_, findings) => {
    expect(decide("reject", findings).autonomy).toBe("escalated");
  });
});

it("always escalates a request for information", () => {
  expect(
    decide("request_info", [finding("venue_exists", "pass")]).autonomy,
  ).toBe("escalated");
});
