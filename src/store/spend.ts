/**
 * The day's spend as both stores keep it (ADR 0016 point 5): one entry per
 * run, a hold with its expiry until the run settles, then its actual cost.
 * Settling overwrites the entry, so a retried settle can't count twice. Pure,
 * so the in-memory and Firestore stores share every rule.
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

const counts = (entry: SpendEntry, now: Date) =>
  entry.expiresAt === null || Date.parse(entry.expiresAt) > now.getTime();

export function totalOf(day: string, entries: DayEntries, now: Date): DaySpend {
  let settledMicros = 0;
  let heldMicros = 0;
  for (const entry of Object.values(entries)) {
    if (entry.expiresAt === null) settledMicros += entry.micros;
    else if (counts(entry, now)) heldMicros += entry.micros;
  }
  return { day, settledMicros, heldMicros };
}

/** Expired holds are dropped on every write: the document stays small. */
function withoutExpired(
  entries: DayEntries,
  now: Date,
): Record<string, SpendEntry> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => counts(entry, now)),
  );
}

export function reserve(
  day: string,
  entries: DayEntries,
  input: ReserveSpendInput,
  now: Date,
): { reservation: Reservation; entries: Record<string, SpendEntry> | null } {
  // A retried reservation replaces the run's own hold, not adds to it.
  const others = Object.fromEntries(
    Object.entries(entries).filter(([runId]) => runId !== input.runId),
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
      ...withoutExpired(others, now),
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
    ...withoutExpired(entries, now),
    [hold.runId]: { micros: actualMicros, expiresAt: null },
  };
}
