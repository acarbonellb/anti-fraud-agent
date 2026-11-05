/**
 * The subjects whose last review failed for a reason that can pass: the
 * model or Satella was down, or rate limited (#57). The pass reviews them
 * again on later passes, a bounded number of times, instead of leaving them
 * unreviewed until their next change. Ids and codes only, like a run's
 * error (CLAUDE.md §4, minimal logs).
 */
import { z } from "zod";

import { subjectTypeSchema } from "../satella-client/schemas.js";
import { StoreError } from "./types.js";

export const pendingRetrySchema = z.object({
  subject: z.object({ type: subjectTypeSchema, id: z.string().min(1) }),
  /** The failed reviews so far, the first one included. */
  failures: z.number().int().positive(),
  /** The last failure's stable code. */
  code: z.string().min(1),
});
export type PendingRetry = z.infer<typeof pendingRetrySchema>;

export const retryQueueSchema = z.array(pendingRetrySchema);

/** A queue the store can keep, or a typed error that quotes no value. */
export function validRetryQueue(
  retries: readonly PendingRetry[],
): PendingRetry[] {
  const parsed = retryQueueSchema.safeParse(retries);
  if (!parsed.success) throw new StoreError("STORE_INVALID_INPUT");
  return parsed.data;
}
