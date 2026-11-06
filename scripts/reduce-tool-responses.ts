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
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  reduceToolRecording,
  toolRecordingSchema,
} from "../src/evals/tool-recording.js";

const TOOL_RESPONSES = fileURLToPath(
  new URL("../evals/tool-responses", import.meta.url),
);

let changed = 0;
for (const file of readdirSync(TOOL_RESPONSES).filter((name) =>
  name.endsWith(".json"),
)) {
  const path = join(TOOL_RESPONSES, file);
  const before = readFileSync(path, "utf8");
  const recording = toolRecordingSchema.parse(JSON.parse(before));
  // Same format as the store writes, so an unchanged file stays byte-identical.
  const after = `${JSON.stringify(reduceToolRecording(recording), null, 2)}\n`;
  if (after !== before) {
    writeFileSync(path, after);
    changed += 1;
  }
}
console.log(`${String(changed)} tool response file(s) reduced`);
