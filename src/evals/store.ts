/**
 * Recordings on disk: `<root>/<provider>/<model-slug>/<id>-<slug>.json`, one
 * per case and model, plus the venue providers' responses, one per case.
 * Committed so CI can replay them. Every file is validated on load:
 * a hand-edited recording that doesn't parse fails loudly.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Recording, recordingSchema } from "./recording.js";
import { type ToolRecording, toolRecordingSchema } from "./tool-recording.js";
import type { EvalCase } from "./types.js";

export interface RecordingSet {
  provider: string;
  model: string;
  /** By case id. */
  recordings: Map<string, Recording>;
}

/** `qwen/qwen3.5-9b` → `qwen-qwen3.5-9b`: one directory level per model. */
export function modelSlug(model: string): string {
  return model.replace(/[^\w.-]+/g, "-");
}

export function recordingPath(
  root: string,
  recording: Pick<Recording, "provider" | "model">,
  evalCase: Pick<EvalCase, "id" | "slug">,
): string {
  return join(
    root,
    modelSlug(recording.provider),
    modelSlug(recording.model),
    `${evalCase.id}-${evalCase.slug}.json`,
  );
}

export function writeRecording(
  root: string,
  evalCase: Pick<EvalCase, "id" | "slug">,
  recording: Recording,
): void {
  const path = recordingPath(root, recording, evalCase);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`);
}

export function loadRecordingSets(root: string): RecordingSet[] {
  const sets: RecordingSet[] = [];
  for (const provider of subdirectories(root)) {
    for (const model of subdirectories(join(root, provider))) {
      const dir = join(root, provider, model);
      const recordings = readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .sort()
        .map((file) =>
          recordingSchema.parse(
            JSON.parse(readFileSync(join(dir, file), "utf8")),
          ),
        );
      const first = recordings[0];
      if (first === undefined) continue;
      sets.push({
        provider: first.provider,
        model: first.model,
        recordings: new Map(recordings.map((r) => [r.caseId, r])),
      });
    }
  }
  return sets;
}

function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    // No recordings yet.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** `<root>/<id>-<slug>.json`: one per case, shared by every recording set. */
export function writeToolRecording(
  root: string,
  evalCase: Pick<EvalCase, "id" | "slug">,
  recording: ToolRecording,
): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, `${evalCase.id}-${evalCase.slug}.json`),
    `${JSON.stringify(recording, null, 2)}\n`,
  );
}

/** By case id; validated like the model recordings. */
export function loadToolRecordings(root: string): Map<string, ToolRecording> {
  let files: string[];
  try {
    files = readdirSync(root).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const recordings = files
    .sort()
    .map((file) =>
      toolRecordingSchema.parse(
        JSON.parse(readFileSync(join(root, file), "utf8")),
      ),
    );
  return new Map(recordings.map((recording) => [recording.caseId, recording]));
}
