// Checks the graded-autonomy policy (brief §4.2 refined by ADRs 0012 and
// 0015): the venue evidence an approval needs, the organizer reviews that
// escalate unless mechanical, and a table that replays the brief §5 dataset cases whose
// autonomy hinges on the certainty of system findings. Pure function; fakes
// nothing.
import { describe, expect, it } from "vitest";

import { type SystemFinding, systemFinding } from "../checks/types.js";
import type { Finding } from "../satella-client/schemas.js";
import {
  type AutonomySubject,
  decideAutonomy,
  escalated,
  EXPOSURE_CAP_TICKETS,
  MODEL_CONFIDENCE_FLOOR,
  OPEN_SPACE_EXPOSURE_CAP_TICKETS,
} from "./policy.js";

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

const EVENT: AutonomySubject = { type: "event", maxTicketsOnSale: 100 };
const ORGANIZER: AutonomySubject = { type: "organizer" };

function decide(
  decision: "approve" | "reject" | "request_info",
  systemFindings: SystemFinding[],
  modelFindings: Finding[] = [],
  modelConfidence = 0.95,
  subject: AutonomySubject = EVENT,
  retrievedUrls: ReadonlySet<string> = new Set([source.url]),
) {
  return decideAutonomy({
    subject,
    retrievedUrls,
    decision,
    modelConfidence,
    systemFindings,
    modelFindings,
    autoApproveThreshold: THRESHOLD,
    searchBudgetSpent: false,
  });
}

const venue = (verdict: Finding["verdict"]) =>
  heuristic("venue_exists", verdict);
/** The capacity check ends as `capacity_far_above_venue` when it fails. */
function capacity(
  verdict: Finding["verdict"],
  sources: Finding["sources"] = [source],
): SystemFinding {
  const check =
    verdict === "fail" ? "capacity_far_above_venue" : "venue_capacity";
  const item = heuristic(check, verdict);
  return {
    ...item,
    finding: { ...item.finding, sources: verdict === "unknown" ? [] : sources },
  };
}

const cleanSystem = [
  rule("postal_code_province", "pass"),
  heuristic("service_fee", "pass"),
  venue("pass"),
  capacity("pass"),
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

  it("gives no weight to the model's own passes", () => {
    const verdict = decide(
      "approve",
      [rule("organizer_identity")],
      [model("organizer_identity", "pass"), model("impersonation", "pass")],
    );

    expect(verdict.autonomy).toBe("escalated");
  });
});

describe("approve needs venue evidence (ADR 0015)", () => {
  const checks = [rule("postal_code_province", "pass")];
  const event = (maxTicketsOnSale: number): AutonomySubject => ({
    type: "event",
    maxTicketsOnSale,
  });

  it.each([
    ["verified, capacity verified", [venue("pass"), capacity("pass")], 5000],
    [
      "verified, capacity unknown, at the exposure cap",
      [venue("pass"), capacity("unknown")],
      EXPOSURE_CAP_TICKETS,
    ],
  ])("resolves on its own: %s", (_, findings, tickets) => {
    expect(
      decide("approve", [...checks, ...findings], [], 0.95, event(tickets))
        .autonomy,
    ).toBe("auto_resolved");
  });

  it.each([
    [
      "capacity unknown above the exposure cap",
      [venue("pass"), capacity("unknown")],
      EXPOSURE_CAP_TICKETS + 1,
      `capacity unknown with ${String(EXPOSURE_CAP_TICKETS + 1)} tickets on sale in one session, above the exposure cap of ${String(EXPOSURE_CAP_TICKETS)}`,
    ],
    [
      "capacity between 1× and 2×",
      [venue("pass"), capacity("warn")],
      100,
      "deterministic checks flagged: venue_capacity",
    ],
    [
      "capacity at 2× or more",
      [venue("pass"), capacity("fail")],
      100,
      "deterministic checks flagged: capacity_far_above_venue",
    ],
    [
      "the venue not found",
      [venue("unknown"), capacity("unknown")],
      100,
      "venue not verified (unknown)",
    ],
    [
      "a residential address",
      [venue("fail"), capacity("unknown")],
      100,
      "deterministic checks flagged: venue_exists",
    ],
    ["no venue checks at all", [], 100, "venue not verified (not checked)"],
  ])("escalates with %s", (_, findings, tickets, reason) => {
    const verdict = decide(
      "approve",
      [...checks, ...findings],
      [],
      0.95,
      event(tickets),
    );
    expect(verdict.autonomy).toBe("escalated");
    expect(verdict.reasons).toContain(reason);
  });

  // An `unknown` finding's confidence is what the admin sees (#75); the
  // policy reads its verdict, so the confidence it carries changes nothing.
  it.each([
    ["auto-resolves", EXPOSURE_CAP_TICKETS],
    ["escalates", EXPOSURE_CAP_TICKETS + 1],
  ])(
    "%s an unknown capacity the same whatever confidence it carries",
    (_, tickets) => {
      const withConfidence = (confidence: number) => {
        const item = capacity("unknown");
        return { ...item, finding: { ...item.finding, confidence } };
      };
      const [asShown, asBefore] = [0, 1].map((confidence) =>
        decide(
          "approve",
          [...checks, venue("pass"), withConfidence(confidence)],
          [],
          0.95,
          event(tickets),
        ),
      );
      expect(capacity("unknown").finding.confidence).toBe(0);
      expect(asShown).toEqual(asBefore);
    },
  );
});

describe("the exposure cap depends on the venue type (#78)", () => {
  const checks = [rule("postal_code_province", "pass"), venue("pass")];
  const unknownAt = (venueType?: string): SystemFinding => ({
    ...capacity("unknown"),
    ...(venueType === undefined ? {} : { venueType }),
  });
  const approve = (finding: SystemFinding, tickets: number) =>
    decide("approve", [...checks, finding], [], 0.95, {
      type: "event",
      maxTicketsOnSale: tickets,
    });

  it("lets a park of unknown capacity resolve with 6,000 tickets in a session", () => {
    expect(approve(unknownAt("leisure=park"), 6000).autonomy).toBe(
      "auto_resolved",
    );
  });

  it.each(["leisure=recreation_ground", "place=square"])(
    "treats %s as an open space",
    (venueType) => {
      expect(approve(unknownAt(venueType), 6000).autonomy).toBe(
        "auto_resolved",
      );
    },
  );

  it("escalates a park above the open-space cap", () => {
    const verdict = approve(unknownAt("leisure=park"), 10_001);
    expect(OPEN_SPACE_EXPOSURE_CAP_TICKETS).toBe(10_000);
    expect(verdict.autonomy).toBe("escalated");
    expect(verdict.reasons).toContain(
      "capacity unknown with 10001 tickets on sale in one session, above the exposure cap of 10000",
    );
  });

  it.each([
    ["a pub", "amenity=pub"],
    ["no venue type", undefined],
  ])("keeps the default cap for %s", (_, venueType) => {
    const verdict = approve(unknownAt(venueType), 301);
    expect(EXPOSURE_CAP_TICKETS).toBe(300);
    expect(verdict.reasons).toContain(
      "capacity unknown with 301 tickets on sale in one session, above the exposure cap of 300",
    );
  });
});

describe("web search can hold back, never let through (ADR 0015)", () => {
  it("never counts a sourced model pass towards an approval", () => {
    const verdict = decide(
      "approve",
      [rule("postal_code_province", "pass")],
      [model("organizer_web_presence", "pass", [source])],
    );
    expect(verdict.autonomy).toBe("escalated");
    expect(verdict.reasons).toContain("venue not verified (not checked)");
  });

  it("escalates an approval on a sourced model warning", () => {
    expect(
      decide("approve", cleanSystem, [
        model("artist_availability", "warn", [source]),
      ]).autonomy,
    ).toBe("escalated");
  });
});

describe("a spent search budget (ADR 0015 amendment, #31)", () => {
  const spent = (
    decision: "approve" | "reject",
    systemFindings: SystemFinding[],
  ) =>
    decideAutonomy({
      subject: EVENT,
      retrievedUrls: new Set(),
      decision,
      modelConfidence: 0.95,
      systemFindings,
      modelFindings: [],
      autoApproveThreshold: THRESHOLD,
      searchBudgetSpent: true,
    });

  it("escalates an approval that would otherwise resolve on its own", () => {
    expect(spent("approve", cleanSystem)).toMatchObject({
      autonomy: "escalated",
      reasons: ["web search budget spent"],
    });
  });

  it("keeps the other reasons an approval escalates for", () => {
    expect(
      spent("approve", [...cleanSystem, rule("postal_code_province")]),
    ).toMatchObject({
      autonomy: "escalated",
      reasons: [
        "web search budget spent",
        "deterministic checks flagged: postal_code_province",
      ],
    });
  });

  it("leaves a rejection on a hard signal alone", () => {
    expect(spent("reject", [rule("off_platform_payment")]).autonomy).toBe(
      "auto_resolved",
    );
  });
});

describe("a web search that failed in the run (#82)", () => {
  const unavailable = (
    decision: "approve" | "reject" | "request_info",
    systemFindings: SystemFinding[],
  ) =>
    decideAutonomy({
      subject: EVENT,
      retrievedUrls: new Set(),
      decision,
      modelConfidence: 0.95,
      systemFindings,
      modelFindings: [],
      autoApproveThreshold: THRESHOLD,
      searchBudgetSpent: false,
      searchUnavailable: true,
    });

  it("escalates an approval that would otherwise resolve on its own", () => {
    expect(unavailable("approve", cleanSystem)).toMatchObject({
      autonomy: "escalated",
      reasons: ["web search unavailable"],
    });
  });

  it("leaves a rejection on a hard signal alone", () => {
    expect(unavailable("reject", [rule("off_platform_payment")]).autonomy).toBe(
      "auto_resolved",
    );
  });

  it("leaves a mechanical request alone", () => {
    expect(
      unavailable("request_info", [
        rule("postal_code_province"),
        heuristic("service_fee", "pass"),
      ]).autonomy,
    ).toBe("auto_resolved");
  });
});

describe("organizer reviews (ADR 0015, amendment of #79)", () => {
  it("resolve a request backed only by rule findings on their own", () => {
    expect(
      decide(
        "request_info",
        [rule("organizer_identity"), heuristic("organizer_history", "pass")],
        [],
        0.95,
        ORGANIZER,
      ),
    ).toMatchObject({
      autonomy: "auto_resolved",
      reasons: ["mechanical request: organizer_identity"],
    });
  });

  it("escalate a request with a heuristic finding", () => {
    expect(
      decide(
        "request_info",
        [rule("organizer_identity"), heuristic("organizer_history")],
        [],
        0.95,
        ORGANIZER,
      ).autonomy,
    ).toBe("escalated");
  });

  it.each(["approve", "reject"] as const)(
    "never resolve a %s on their own",
    (decision) => {
      expect(
        decide(
          decision,
          [rule("off_platform_payment"), rule("organizer_identity")],
          [],
          0.99,
          ORGANIZER,
        ),
      ).toMatchObject({
        autonomy: "escalated",
        reasons: [
          "organizer approvals and rejections always escalate (ADR 0015)",
        ],
      });
    },
  );
});

describe("reject", () => {
  it("resolves on its own on a deterministic hard signal", () => {
    expect(decide("reject", [rule("off_platform_payment")])).toMatchObject({
      autonomy: "auto_resolved",
      reasons: ["hard signals: off_platform_payment"],
    });
  });

  it("resolves on its own on a sourced capacity far above the venue's", () => {
    expect(decide("reject", [venue("pass"), capacity("fail")])).toMatchObject({
      autonomy: "auto_resolved",
      reasons: ["hard signals: capacity_far_above_venue"],
    });
  });

  it("doesn't resolve on an unsourced heuristic hard signal", () => {
    expect(decide("reject", [capacity("fail", [])]).autonomy).toBe("escalated");
  });

  it("doesn't count a source the model wrote itself (ADR 0015)", () => {
    const invented = {
      url: "https://example.test/invented",
      title: "Inventada",
    };
    expect(
      decide("reject", cleanSystem, [
        model("exact_duplicate_other_organizer", "fail", [invented]),
      ]),
    ).toMatchObject({
      autonomy: "escalated",
      reasons: ["rejection without a rule-based or sourced hard signal"],
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
    ).toMatchObject({
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
});

// Brief §5: expected decision and autonomy, with the system finding each
// case produces. The model is assumed to propose the expected decision.
// An organizer request resolves on its own only when it is mechanical (ADR
// 0015 amendment of #79); every other organizer review escalates (point 7).
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
    "1: 2,000 tickets in a bar of 140",
    "reject",
    [venue("pass"), capacity("fail")],
    "auto_resolved",
  ],
  [
    "2: 1,100 tickets in a room of 898",
    "request_info",
    [venue("pass"), capacity("warn")],
    "escalated",
  ],
  [
    "4: the coordinates fall in the sea",
    "request_info",
    [venue("fail"), capacity("unknown")],
    "escalated",
  ],
  [
    "21: owner with a rejected organization",
    "reject",
    [heuristic("organizer_history")],
    "escalated",
    ORGANIZER,
  ],
  [
    "22: tax id with a wrong checksum",
    "request_info",
    [rule("organizer_identity")],
    "auto_resolved",
    ORGANIZER,
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
] as const)("dataset case %s", (_, decision, system, expected, subject?) => {
  // 0.7 is what Haiku 5.5 reports when it's right (E015): the evidence
  // decides, so the model's number no longer escalates these (#77).
  it(`is ${expected}`, () => {
    expect(
      decide(decision, [...system], [], 0.7, subject ?? EVENT).autonomy,
    ).toBe(expected);
  });
});

describe("the confidence comes from the evidence tier (#77)", () => {
  // Haiku 5.5's usual number (E015): below the threshold, yet right.
  const haiku = 0.7;
  const approveAt = (threshold: number) =>
    decideAutonomy({
      subject: EVENT,
      retrievedUrls: new Set(),
      decision: "approve",
      modelConfidence: haiku,
      systemFindings: [venue("pass"), capacity("unknown")],
      modelFindings: [],
      autoApproveThreshold: threshold,
      searchBudgetSpent: false,
    });

  it.each([
    [
      "a request whose negatives are all rule findings",
      "request_info",
      [rule("postal_code_province"), heuristic("service_fee", "pass")],
      0.95,
    ],
    [
      "a rejection on a rule hard signal",
      "reject",
      [rule("off_platform_payment")],
      0.95,
    ],
    [
      "a rejection on a sourced hard signal",
      "reject",
      [venue("pass"), capacity("fail")],
      0.95,
    ],
    [
      "a clean approval with the capacity verified",
      "approve",
      cleanSystem,
      0.9,
    ],
    [
      "a clean approval under the exposure cap",
      "approve",
      [
        rule("postal_code_province", "pass"),
        venue("pass"),
        capacity("unknown"),
      ],
      0.85,
    ],
  ] as const)("gives %s its tier", (_, decision, system, tier) => {
    expect(decide(decision, [...system], [], haiku)).toMatchObject({
      autonomy: "auto_resolved",
      confidence: tier,
    });
  });

  it("reads the tier from the findings, not from the model's number", () => {
    const shown = [0.55, 0.99].map(
      (modelConfidence) =>
        decide("approve", cleanSystem, [], modelConfidence).confidence,
    );
    expect(shown).toEqual([0.9, 0.9]);
  });

  it("caps an escalated review below the threshold", () => {
    const verdict = decide(
      "request_info",
      [heuristic("service_fee")],
      [],
      0.97,
    );
    expect(verdict.autonomy).toBe("escalated");
    expect(verdict.confidence).toBe(0.84);
  });

  it("keeps an escalated review's lower number", () => {
    expect(
      decide("request_info", [heuristic("service_fee")], [], 0.6).confidence,
    ).toBe(0.6);
  });

  it("resolves a tier at the threshold", () => {
    expect(approveAt(0.85)).toMatchObject({
      autonomy: "auto_resolved",
      confidence: 0.85,
    });
  });

  it("escalates a tier below a stricter threshold, saying why", () => {
    expect(approveAt(0.9)).toEqual({
      autonomy: "escalated",
      reasons: ["evidence tier 0.85 below 0.9"],
      confidence: 0.7,
    });
  });

  it.each([
    ["approve", cleanSystem],
    ["reject", [rule("off_platform_payment")]],
    ["request_info", [rule("postal_code_province")]],
  ] as const)(
    "lets a model number below the floor hold back a %s",
    (decision, system) => {
      const below = 0.49;
      expect(decide(decision, [...system], [], below)).toEqual({
        autonomy: "escalated",
        reasons: ["model confidence 0.49 below 0.5"],
        confidence: below,
      });
    },
  );

  it("adds the floor only to a review that would otherwise resolve", () => {
    expect(
      decide("request_info", [heuristic("service_fee")], [], 0.3).reasons,
    ).toEqual([
      "no rule-based finding to ask about",
      "needs judgement: service_fee",
    ]);
  });

  it("resolves at the floor", () => {
    expect(MODEL_CONFIDENCE_FLOOR).toBe(0.5);
    expect(
      decide("approve", cleanSystem, [], MODEL_CONFIDENCE_FLOOR).autonomy,
    ).toBe("auto_resolved");
  });
});

describe("an escalation built outside the policy", () => {
  it("records its reasons and caps the model's number below the threshold", () => {
    expect(escalated(["run ended by max_tool_calls"], 0.97)).toEqual({
      autonomy: "escalated",
      reasons: ["run ended by max_tool_calls"],
      confidence: 0.84,
    });
  });

  it("keeps a lower model number", () => {
    expect(escalated(["run ended by max_tokens"], 0.4).confidence).toBe(0.4);
  });
});
