/**
 * A deterministic heuristic on price (brief §4.1 `checkPricingSanity`, ADR
 * 0012): a ticket far above what comparable events charge, by Satella's
 * price benchmark for the event's genre, province and capacity band. It runs
 * in code before the model because the model's doubt was the only thing
 * catching it, and that doubt vanished once the venue checks verified the
 * venue (E002, case 13).
 *
 * Only the high side: a lure price would need its own threshold, and no
 * brief §5 case has one. The factor is provisional until the evals tune it.
 */
import type {
  CapacityBand,
  EventReviewContext,
  PriceBenchmark,
  PriceBenchmarkQuery,
} from "../satella-client/schemas.js";
import { euros } from "./event-checks.js";
import { type SystemFinding, systemFinding } from "./types.js";

/** A ticket above this many times the benchmark's p90 is an outlier (case 13). */
export const PRICE_OUTLIER_FACTOR = 3;

/** Satella's bands, by the largest session's total capacity. */
export function capacityBand(context: EventReviewContext): CapacityBand {
  const largest = Math.max(
    0,
    ...context.sessions.map((session) =>
      session.ticketTypes.reduce((total, ticket) => total + ticket.capacity, 0),
    ),
  );
  if (largest < 300) return "lt300";
  if (largest <= 1000) return "300to1000";
  if (largest <= 5000) return "1000to5000";
  return "gt5000";
}

/** The most specific comparison Satella offers for this event. */
export function benchmarkQuery(
  context: EventReviewContext,
): PriceBenchmarkQuery {
  return {
    ...(context.event.genre === null ? {} : { genre: context.event.genre }),
    ...(context.venue === null ? {} : { province: context.venue.province }),
    capacityBand: capacityBand(context),
  };
}

/** `benchmark` is null when Satella couldn't be asked. */
export function priceBenchmarkCheck(
  context: EventReviewContext,
  benchmark: PriceBenchmark | null,
): SystemFinding {
  const check = "price_benchmark";
  if (benchmark === null) {
    return systemFinding(
      "heuristic",
      check,
      "unknown",
      "No se pudo consultar el benchmark de precios.",
    );
  }
  const { p90Cents } = benchmark;
  if (p90Cents === null) {
    return systemFinding(
      "heuristic",
      check,
      "unknown",
      `El benchmark de precios no tiene muestra suficiente (${String(benchmark.sampleSize)} precios).`,
    );
  }
  let worst: { name: string; priceCents: number } | null = null;
  for (const session of context.sessions) {
    for (const ticketType of session.ticketTypes) {
      if (ticketType.kind !== "standard") continue;
      if (worst === null || ticketType.priceCents > worst.priceCents) {
        worst = { name: ticketType.name, priceCents: ticketType.priceCents };
      }
    }
  }
  const of = `el p90 (${euros(p90Cents)}) de ${String(benchmark.sampleSize)} eventos comparables (${comparison(context)})`;
  // Integer cents compared with an integer factor: no float decides.
  if (worst === null || worst.priceCents <= PRICE_OUTLIER_FACTOR * p90Cents) {
    return systemFinding(
      "heuristic",
      check,
      "pass",
      `Ningún precio supera ${String(PRICE_OUTLIER_FACTOR)} veces ${of}.`,
    );
  }
  const factor = (worst.priceCents / p90Cents).toFixed(1).replace(".", ",");
  return systemFinding(
    "heuristic",
    check,
    "warn",
    `Heurística de precio: «${worst.name}» cuesta ${euros(worst.priceCents)}, ${factor} veces ${of} (umbral: ${String(PRICE_OUTLIER_FACTOR)} veces).`,
  );
}

function comparison(context: EventReviewContext): string {
  const query = benchmarkQuery(context);
  return [
    ...(query.genre === undefined ? [] : [`género ${query.genre}`]),
    ...(query.province === undefined ? [] : [query.province]),
    `aforo ${query.capacityBand ?? ""}`,
  ].join(", ");
}
