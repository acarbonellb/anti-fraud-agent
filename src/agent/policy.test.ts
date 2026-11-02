// Checks the graded-autonomy policy (brief §4.2 refined by ADR 0012). The
// table at the end replays the brief §5 dataset cases whose autonomy hinges
// on the certainty of deterministic findings. Pure function; fakes nothing.
import { describe, expect, it } from "vitest";

import { type SystemFinding, systemFinding } from "../checks/types.js";
import type { Finding } from "../satella-client/schemas.js";
import { decideAutonomy } from "./policy.js";

const THRESHOLD = 0.85;
const source = { url: "https://example.test/evidence", title: "Evidencia" };

const rule = (check: string, verdict: Finding["verdict"] = "fail") =>
  systemFinding("rule", check, verdict, "detalle");
const heuristic = (check: string, verdict: Finding["verdict"] = "warn") =>
  systemFinding("heuristic", check, verdict, "detalle");
const model = (
  check: string,
  verdict: Finding["verdict"],
  sources: Finding["sources"] = [],
): Finding => ({ check, verdict, detail: "detalle", confidence: 0.9, sources });

function decide(
  decision: "approve" | "reject" | "request_info",
  systemFindings: SystemFinding[],
  modelFindings: Finding[] = [],
  confidence = 0.95,
) {
  return decideAutonomy({
    decision,
    confidence,
    systemFindings,
    modelFindings,
    autoApproveThreshold: THRESHOLD,
  });
}

const cleanSystem = [
  rule("postal_code_province", "pass"),
  heuristic("service_fee", "pass"),
];

describe("approve", () => {
  it("resolves on its own when the deterministic checks are clean", () => {
    expect(decide("approve", cleanSystem).autonomy).toBe("auto_resolved");
  });

  it("tolerates one minor model warning", () => {
    expect(
      decide("approve", cleanSystem, [model("organizer_web_presence", "warn")])
        .autonomy,
    ).toBe("auto_resolved");
  });

  it.each([
    ["a deterministic rule failing", [rule("postal_code_province")], []],
    ["a deterministic heuristic warning", [heuristic("session_timing")], []],
    ["a model fail", cleanSystem, [model("venue_exists", "fail")]],
    [
      "a model warning on a fraud signal",
      cleanSystem,
      [model("venue_capacity", "warn")],
    ],
    [
      "two minor model warnings",
      cleanSystem,
      [
        model("organizer_web_presence", "warn"),
        model("text_originality", "warn"),
      ],
    ],
  ])("escalates with %s", (_, system, modelFindings) => {
    expect(decide("approve", system, modelFindings).autonomy).toBe("escalated");
  });

  it("escalates below the threshold, saying why", () => {
    expect(decide("approve", cleanSystem, [], 0.8)).toEqual({
      autonomy: "escalated",
      reasons: ["confidence 0.8 below 0.85"],
    });
  });

  it("gives no weight to the model's own passes", () => {
    const verdict = decide(
      "approve",
      [rule("organizer_identity")],
      [model("organizer_identity", "pass"), model("impersonation", "pass")],
    );

    expect(verdict.autonomy).toBe("escalated");
  });
});

describe("reject", () => {
  it("resolves on its own on a deterministic hard signal", () => {
    expect(decide("reject", [rule("off_platform_payment")])).toEqual({
      autonomy: "auto_resolved",
      reasons: ["hard signals: off_platform_payment"],
    });
  });

  it("resolves on its own on a sourced hard signal from the model", () => {
    expect(
      decide("reject", cleanSystem, [
        model("exact_duplicate_other_organizer", "fail", [source]),
      ]).autonomy,
    ).toBe("auto_resolved");
  });

  it.each([
    [
      "an unsourced hard signal from the model",
      [],
      [model("illegal_content", "fail")],
    ],
    [
      "a rule failure that isn't a hard signal",
      [rule("postal_code_province")],
      [],
    ],
    ["a heuristic only", [heuristic("organizer_history")], []],
  ])("escalates with %s", (_, system, modelFindings) => {
    expect(decide("reject", system, modelFindings).autonomy).toBe("escalated");
  });
});

describe("request_info", () => {
  it("resolves on its own when every negative is a rule finding", () => {
    expect(
      decide("request_info", [
        rule("postal_code_province"),
        heuristic("service_fee", "pass"),
      ]),
    ).toEqual({
      autonomy: "auto_resolved",
      reasons: ["mechanical request: postal_code_province"],
    });
  });

  it.each([
    [
      "a heuristic finding",
      [rule("price_sanity"), heuristic("service_fee")],
      [],
    ],
    [
      "a model finding",
      [rule("price_sanity")],
      [model("venue_capacity", "warn")],
    ],
    ["nothing rule-based to ask about", cleanSystem, []],
  ])("escalates with %s", (_, system, modelFindings) => {
    expect(decide("request_info", system, modelFindings).autonomy).toBe(
      "escalated",
    );
  });

  it("escalates below the threshold", () => {
    expect(
      decide("request_info", [rule("postal_code_province")], [], 0.6).autonomy,
    ).toBe("escalated");
  });
});

// Brief §5: expected decision and autonomy, with the deterministic finding
// each case produces. The model is assumed to propose the expected decision.
describe.each([
  [
    "3: postal code of Madrid, province Sevilla",
    "request_info",
    [rule("postal_code_province")],
    "auto_resolved",
  ],
  [
    "10: pay by Bizum",
    "reject",
    [rule("off_platform_payment")],
    "auto_resolved",
  ],
  [
    "12: no refund even if cancelled",
    "request_info",
    [rule("abusive_terms")],
    "auto_resolved",
  ],
  ["13: General at 950 € in a 300-seat room", "request_info", [], "escalated"],
  [
    "14: VIP cheaper than General",
    "request_info",
    [rule("price_sanity")],
    "auto_resolved",
  ],
  [
    "15: 45 % service fee",
    "request_info",
    [heuristic("service_fee")],
    "escalated",
  ],
  [
    "17: session hours after publishing",
    "request_info",
    [heuristic("session_timing")],
    "escalated",
  ],
  [
    "18: session three years away",
    "request_info",
    [heuristic("session_timing")],
    "escalated",
  ],
  [
    "19: overlapping sessions",
    "request_info",
    [rule("session_dates")],
    "auto_resolved",
  ],
  [
    "21: owner with a rejected organization",
    "reject",
    [heuristic("organizer_history")],
    "escalated",
  ],
  [
    "22: tax id with a wrong checksum",
    "request_info",
    [rule("organizer_identity")],
    "auto_resolved",
  ],
  [
    "23: previous fraud reports",
    "request_info",
    [heuristic("organizer_history")],
    "escalated",
  ],
  ["24: botellón +14", "reject", [rule("minors_alcohol")], "auto_resolved"],
  [
    "25: prompt injection",
    "request_info",
    [heuristic("prompt_injection")],
    "escalated",
  ],
] as const)("dataset case %s", (_, decision, system, expected) => {
  it(`is ${expected}`, () => {
    expect(decide(decision, [...system]).autonomy).toBe(expected);
  });
});
