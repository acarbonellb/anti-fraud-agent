// Checks each gated fraud case's `decidedBy` against what the fooled model
// actually gets on it (#82): a case declared code-decided must not resolve
// as an approval with the web as recorded or down, and one declared
// model-decided must, or its declaration overstates the dependence on the
// model. Runs the real review with the committed venue responses and the
// code's recorded searches; fakes only the model.
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { fooledDecidedBy } from "../../src/evals/gate.js";
import { fooledSet, isGatedFraud } from "../../src/evals/runner.js";
import {
  loadRecordingSets,
  loadToolRecordings,
} from "../../src/evals/store.js";
import { EVAL_CASES } from "./index.js";

const dir = (name: string) =>
  fileURLToPath(new URL(`../${name}`, import.meta.url));

it("declares who decides each gated fraud case as the fooled model finds it", async () => {
  const results = await fooledSet(
    EVAL_CASES,
    loadRecordingSets(dir("recordings")),
    loadToolRecordings(dir("tool-responses")),
  );
  expect(
    Object.fromEntries(results.map((r) => [r.caseId, r.decidedBy])),
  ).toEqual(
    Object.fromEntries(results.map((r) => [r.caseId, fooledDecidedBy(r)])),
  );
});

it("declares it on the gated fraud cases only", () => {
  expect(
    EVAL_CASES.filter((c) => c.decidedBy !== undefined).map((c) => c.id),
  ).toEqual(EVAL_CASES.filter(isGatedFraud).map((c) => c.id));
});
