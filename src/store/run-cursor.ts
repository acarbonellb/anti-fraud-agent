/**
 * The page cursor of `listRuns`: the last run's start and id, opaque to
 * callers. Runs order by start, newest first, then by id, so two runs that
 * start at the same instant still page in a stable order.
 */
import { z } from "zod";

import { isoDate } from "../satella-client/schemas.js";
import { runIdSchema } from "./run-document.js";
import { StoreError } from "./types.js";

export interface RunPosition {
  startedAt: string;
  runId: string;
}

const positionSchema = z.object({ startedAt: isoDate, runId: runIdSchema });

/** Negative when `a` comes first. */
export function newestFirst(a: RunPosition, b: RunPosition): number {
  // ISO strings in UTC with the same precision sort as their instants.
  if (a.startedAt !== b.startedAt) return a.startedAt > b.startedAt ? -1 : 1;
  if (a.runId === b.runId) return 0;
  return a.runId > b.runId ? -1 : 1;
}

export function encodeRunCursor(run: RunPosition): string {
  return Buffer.from(
    JSON.stringify({ startedAt: run.startedAt, runId: run.runId }),
  ).toString("base64url");
}

export function decodeRunCursor(cursor: string): RunPosition {
  try {
    return positionSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch (error) {
    throw new StoreError("STORE_BAD_CURSOR", null, { cause: error });
  }
}
