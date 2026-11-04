/**
 * A deterministic rule on clones (brief §5 case 7, ADR 0012): another
 * organizer's published event with the same title, the same venue and a
 * session on the same day. Satella's similar events carry all three, so the
 * check runs in code before the model instead of resting on the model's word.
 *
 * It only ever fails. A pass would silence a model finding on the same check
 * (system findings win), and the model can find a clone on another site with
 * `web_search`: the platform's list proves a clone, not originality.
 */
import type {
  EventReviewContext,
  SimilarEvent,
} from "../satella-client/schemas.js";
import { type SystemFinding, systemFinding } from "./types.js";

export function exactCloneCheck(
  context: EventReviewContext,
  similar: readonly SimilarEvent[],
): SystemFinding[] {
  const sessionDays = new Set(
    context.sessions.map((session) => madridDayKey(session.startsAt)),
  );
  const clone = similar.find(
    (other) =>
      other.titleSimilarity === 1 &&
      other.sharesVenueName &&
      sessionDays.has(madridDayKey(other.firstSessionInWindow)),
  );
  if (clone === undefined) return [];
  return [
    systemFinding(
      "rule",
      "exact_duplicate_other_organizer",
      "fail",
      `Regla de clon: otro organizador ya publica «${clone.title}» en ${clone.venueName} el ${madridDay(clone.firstSessionInWindow)}, mismo título, recinto y día.`,
    ),
  ];
}

/**
 * The calendar day in Europe/Madrid, where the admin and the venue are
 * (CLAUDE.md §5), as `YYYY-MM-DD`: a key that doesn't rest on display format.
 */
function madridDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "Europe/Madrid",
  });
}

/** The same day as the admin reads it. */
function madridDay(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
