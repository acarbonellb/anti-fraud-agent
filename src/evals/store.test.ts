// Checks the recordings on disk with repeated runs (#42): run 1 keeps the
// file name every set already has, later runs sit next to it, and a set loads
// as one map of recordings per run. Writes to a temporary directory; fakes
// nothing else.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import type { Recording } from "./recording.js";
import { loadRecordingSets, writeRecording } from "./store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "recordings-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function recording(caseId: string, run?: number): Recording {
  return {
    caseId,
    provider: "anthropic",
    model: "claude-haiku-5-5",
    ...(run === undefined ? {} : { run }),
    promptVersion: "review-v4",
    clock: "2026-11-04T10:00:00.000Z",
    calls: [],
    searches: [],
  };
}

const bar = { id: "01", slug: "bar" };
const clean = { id: "N1", slug: "clean" };

it("keeps run 1 at the case's file and puts later runs next to it", () => {
  writeRecording(root, bar, recording("01"));
  writeRecording(root, bar, recording("01", 2));
  writeRecording(root, bar, recording("01", 3));

  expect(readdirSync(join(root, "anthropic", "claude-haiku-5-5"))).toEqual([
    "01-bar.json",
    "01-bar.run-2.json",
    "01-bar.run-3.json",
  ]);
});

it("loads a set as one map of recordings per run, by case id", () => {
  writeRecording(root, bar, recording("01"));
  writeRecording(root, bar, recording("01", 2));
  writeRecording(root, clean, recording("N1"));

  const [set, ...others] = loadRecordingSets(root);
  expect(others).toEqual([]);
  expect(set?.runs.map((run) => [...run.keys()].sort())).toEqual([
    ["01", "N1"],
    ["01"],
  ]);
  expect(set?.runs[1]?.get("01")?.run).toBe(2);
});

it("loads a set recorded before repeats as one run", () => {
  writeRecording(root, bar, recording("01"));
  expect(loadRecordingSets(root)[0]?.runs).toHaveLength(1);
});
