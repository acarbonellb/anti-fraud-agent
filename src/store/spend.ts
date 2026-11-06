/**
 * The day's spend as both stores keep it (ADR 0016 point 5): one entry per
 * run, a hold with its expiry until the run settles, then its actual cost.
 * Settling overwrites the entry, so a retried settle can't count twice. A hold
 * that expires unsettled is charged at its reserved amount. Pure, so the
 * in-memory and Firestore stores share every rule.
 */
import {
  type DaySpend,
  type Reservation,
  type ReserveSpendInput,
  SPEND_HOLD_TTL_MS,
  type SpendHold,
} from "./types.js";

export interface SpendEntry {
  micros: number;
  /** Null once settled: the actual cost no longer expires. */
  expiresAt: string | null;
}

/** By `runId`. */
export type DayEntries = Readonly<Record<string, SpendEntry>>;

const expired = (entry: SpendEntry, now: Date) =>
  entry.expiresAt !== null && Date.parse(entry.expiresAt) <= now.getTime();

/**
 * A hold past its expiry that was never settled belongs to a run killed
 * mid-pass (a task timeout, an out-of-memory kill): its real cost is unknown
 * and may be its whole worst case, so it becomes settled spend at the amount
 * it reserved (ADR 0017, amendment of #88). Settled entries never expire, so
 * a later read finds nothing to charge again. Null when nothing expired: no
 * write is needed.
 */
export function chargeExpired(
  entries: DayEntries,
  now: Date,
): Record<string, SpendEntry> | null {
  if (!Object.values(entries).some((entry) => expired(entry, now))) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(entries).map(([runId, entry]) => [
      runId,
      expired(entry, now) ? { micros: entry.micros, expiresAt: null } : entry,
    ]),
  );
}

export function totalOf(day: string, entries: DayEntries, now: Date): DaySpend {
  let settledMicros = 0;
  let heldMicros = 0;
  for (const entry of Object.values(chargeExpired(entries, now) ?? entries)) {
    if (entry.expiresAt === null) settledMicros += entry.micros;
    else heldMicros += entry.micros;
  }
  return { day, settledMicros, heldMicros };
}

export function reserve(
  day: string,
  entries: DayEntries,
  input: ReserveSpendInput,
  now: Date,
): { reservation: Reservation; entries: Record<string, SpendEntry> | null } {
  // A retried reservation replaces the run's own hold, not adds to it.
  const others = Object.fromEntries(
    Object.entries(chargeExpired(entries, now) ?? entries).filter(
      ([runId]) => runId !== input.runId,
    ),
  );
  const spend = totalOf(day, others, now);
  if (
    spend.settledMicros + spend.heldMicros + input.micros >
    input.budgetMicros
  ) {
    return { reservation: { ok: false, spend }, entries: null };
  }
  const hold: SpendHold = {
    runId: input.runId,
    day,
    micros: input.micros,
    expiresAt: new Date(now.getTime() + SPEND_HOLD_TTL_MS).toISOString(),
  };
  return {
    reservation: { ok: true, hold },
    entries: {
      ...others,
      [hold.runId]: { micros: hold.micros, expiresAt: hold.expiresAt },
    },
  };
}

export function settle(
  entries: DayEntries,
  hold: SpendHold,
  actualMicros: number,
  now: Date,
): Record<string, SpendEntry> {
  return {
    ...(chargeExpired(entries, now) ?? entries),
    // A slow run settling after its hold was charged replaces the charge.
    [hold.runId]: { micros: actualMicros, expiresAt: null },
  };
}
