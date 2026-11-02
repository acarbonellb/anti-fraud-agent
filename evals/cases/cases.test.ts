// Checks the brief §5 dataset as built: all 31 cases are there, each named
// by its file; their contexts parse with the contract schemas at any clock;
// no field leaks the answer; and each fixture triggers exactly the
// deterministic findings it is meant to, so a case tests the agent and not a
// typo in its fixture. Fakes nothing: builds every case and runs the checks.
import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runEventChecks } from "../../src/checks/event-checks.js";
import { runOrganizerChecks } from "../../src/checks/organizer-checks.js";
import {
  eventReviewContextSchema,
  organizerReviewContextSchema,
  priceBenchmarkSchema,
  similarEventSchema,
} from "../../src/satella-client/schemas.js";
import { EVAL_CASES } from "./index.js";

const CLOCKS = [
  new Date("2026-11-02T10:17:00.000Z"),
  new Date("2031-06-30T23:59:00.000Z"),
];

const IDS = [
  ...Array.from({ length: 26 }, (_, i) => String(i + 1).padStart(2, "0")),
  "N1",
  "N2",
  "N3",
  "N4",
  "N5",
];

it("holds the 31 cases of brief §5 in order, one file each", () => {
  expect(EVAL_CASES.map((c) => c.id)).toEqual(IDS);
  const files = readdirSync(new URL(".", import.meta.url))
    .filter((file) => /^(\d\d|N\d)-.+\.ts$/.test(file))
    .sort();
  expect(files).toEqual(EVAL_CASES.map((c) => `${c.id}-${c.slug}.ts`).sort());
});

it("tags the cases that need the external tools (#7)", () => {
  expect(
    EVAL_CASES.filter((c) => c.requires?.includes("external")).map((c) => c.id),
  ).toEqual(["01", "02", "04", "05", "06", "08", "09", "20", "N5"]);
});

describe.each(EVAL_CASES.map((c) => [`${c.id} ${c.slug}`, c] as const))(
  "case %s",
  (_, evalCase) => {
    it.each(CLOCKS)("parses with the contract schemas at %s", (clock) => {
      const fixtures = evalCase.build(clock);
      organizerReviewContextSchema.parse(fixtures.organizer);
      fixtures.similar?.forEach((item) => similarEventSchema.parse(item));
      fixtures.benchmarks?.forEach(({ benchmark }) =>
        priceBenchmarkSchema.parse(benchmark),
      );
      if (evalCase.subject === "event") {
        const event = eventReviewContextSchema.parse(fixtures.event);
        expect(event.organizerId).toBe(fixtures.organizer.organizer.id);
      } else {
        expect(fixtures.event).toBeUndefined();
      }
    });

    it("builds its dates from the clock", () => {
      const [first, second] = CLOCKS.map((clock) =>
        JSON.stringify(evalCase.build(clock)),
      );
      expect(first).not.toBe(second);
      expect(JSON.stringify(evalCase.build(CLOCKS[0] ?? new Date()))).toBe(
        first,
      );
    });

    it("leaks no answer in any field", () => {
      const fixtures = evalCase.build(CLOCKS[0] ?? new Date());
      for (const text of strings(fixtures)) {
        expect(text).not.toMatch(/\beval\b/i);
        expect(text).not.toMatch(/\b(?:case|caso)\s*#?\s*\d/i);
        expect(text).not.toMatch(
          /\b(?:approve|reject|request_info|auto_resolved|escalated)\b/i,
        );
        expect(text).not.toContain(evalCase.slug);
      }
    });
  },
);

// What the deterministic checks flag in each case (ADR 0012): the rule
// findings let a request resolve on its own, the heuristic ones escalate.
const EXPECTED_FLAGS: Record<string, string[]> = {
  "03": ["rule postal_code_province"],
  "10": ["rule off_platform_payment"],
  "11": ["heuristic external_ticketing_link"],
  "12": ["rule abusive_terms"],
  "14": ["rule price_sanity"],
  "15": ["heuristic service_fee"],
  "17": ["heuristic session_timing"],
  "18": ["heuristic session_timing"],
  "19": ["rule session_dates"],
  "21": ["heuristic organizer_history"],
  "22": ["rule organizer_identity"],
  "24": ["rule minors_alcohol"],
  "25": ["heuristic prompt_injection"],
  "26": ["rule off_platform_payment"],
};

it.each(EVAL_CASES.map((c) => [c.id, c] as const))(
  "case %s triggers exactly its deterministic findings",
  (id, evalCase) => {
    const clock = CLOCKS[0] ?? new Date();
    const fixtures = evalCase.build(clock);
    const findings =
      fixtures.event === undefined
        ? runOrganizerChecks(fixtures.organizer)
        : runEventChecks(fixtures.event, clock);
    const flagged = findings
      .filter(({ finding }) => finding.verdict !== "pass")
      .map(({ certainty, finding }) => `${certainty} ${finding.check}`);
    expect(flagged).toEqual(EXPECTED_FLAGS[id] ?? []);
  },
);

/** Every string value, except the contract's enums (`fraud` is a category, `approve` a past decision). */
function strings(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    return ["category", "decision", "status", "kind", "type"].includes(key)
      ? []
      : [value];
  }
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([inner, item]) =>
      strings(item, inner),
    );
  }
  return [];
}

// Case 17's story is told in Madrid time; the clocks above fall in winter
// (UTC+1) and in summer (UTC+2).
it.each(CLOCKS)(
  "case 17 is published at 23:00 for 09:00 the next day, Madrid time, at %s",
  (clock) => {
    const evalCase = EVAL_CASES.find((c) => c.id === "17");
    const event = evalCase?.build(clock).event;
    const madrid = (iso: string | null | undefined) =>
      new Date(iso ?? "").toLocaleString("en-GB", {
        timeZone: "Europe/Madrid",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    const published = madrid(event?.event.publishedAt);
    const starts = madrid(event?.sessions[0]?.startsAt);
    expect(published).toMatch(/ 23:00$/);
    expect(starts).toMatch(/ 09:00$/);
    expect(starts.slice(0, 3)).not.toBe(published.slice(0, 3));
  },
);
