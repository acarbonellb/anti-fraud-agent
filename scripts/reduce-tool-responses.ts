/**
 * Rewrites the committed tool responses with the reduction recording applies
 * (#85), so files recorded before it hold only what the code reads. Request
 * hashes are untouched: replay keys stay valid, and `pnpm eval:replay --check`
 * proves no decision moved. Idempotent; offline.
 *
 * Kept for when a reducer changes: re-run it rather than re-record (a paid,
 * networked step).
 *
 *   pnpm tsx scripts/reduce-tool-responses.ts
 */
import { fileURLToPath } from "node:url";

import { EVAL_CASES } from "../evals/cases/index.js";
import { loadToolRecordings, writeToolRecording } from "../src/evals/store.js";
import { reduceToolRecording } from "../src/evals/tool-recording.js";

const TOOL_RESPONSES = fileURLToPath(
  new URL("../evals/tool-responses", import.meta.url),
);

let reduced = 0;
for (const [caseId, recording] of loadToolRecordings(TOOL_RESPONSES)) {
  const evalCase = EVAL_CASES.find((c) => c.id === caseId);
  // The store names files by case, so a recording without one has no path.
  if (evalCase === undefined) {
    throw new Error(`No eval case for tool recording ${caseId}`);
  }
  writeToolRecording(TOOL_RESPONSES, evalCase, reduceToolRecording(recording));
  reduced += 1;
}
console.log(`${String(reduced)} tool response file(s) rewritten`);
