/**
 * Deterministic checks over an event's review context (brief §4.1:
 * `checkPostalCodeProvince`, `scanTextForRiskSignals`, `checkPricingSanity`).
 * They run in code before the model, and their findings are authoritative
 * (ADR 0012). Each `detail` names its rule in Spanish, for the admin.
 *
 * Heuristic thresholds are provisional: the eval cases exercise them, and
 * real reviews will tune them (#6).
 */
import type { EventReviewContext } from "../satella-client/schemas.js";
import { provinceCode, provinceName } from "./provinces.js";
import {
  scanTexts,
  type TextSignal,
  type TextSignalKind,
} from "./text-signals.js";
import { type SystemFinding, systemFinding } from "./types.js";

/** Service fee above this percent of the ticket price is suspicious (case 15). */
export const SERVICE_FEE_MAX_PERCENT = 20;
/** A first session sooner than this after publishing is imminent (case 17). */
export const IMMINENT_HOURS = 12;
/** A session further than this after publishing is suspiciously far (case 18). */
export const DISTANT_DAYS = 548;
/**
 * An active discount above this percent with no usage limit is suspicious:
 * it can sell the whole event at a fraction of its price. A 2x1 (exactly
 * 50 %) is a common legitimate promotion, and a large discount with a limit
 * is a normal one (#71, slice 2).
 */
export const UNLIMITED_DISCOUNT_MAX_PERCENT = 50;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function runEventChecks(
  context: EventReviewContext,
  now: Date,
): SystemFinding[] {
  return [
    postalCodeProvince(context),
    ...textSignals(context),
    vipBelowGeneral(context),
    serviceFee(context),
    discounts(context),
    ...sessionDates(context, now),
  ];
}

function postalCodeProvince(context: EventReviewContext): SystemFinding {
  const check = "postal_code_province";
  const postalCode = context.venue?.postalCode ?? null;
  const province = context.venue?.province ?? null;
  if (postalCode === null || province === null) {
    return systemFinding(
      "rule",
      check,
      "unknown",
      "El recinto no tiene código postal o provincia.",
    );
  }
  if (!/^\d{5}$/.test(postalCode)) {
    return systemFinding(
      "rule",
      check,
      "fail",
      `El código postal ${postalCode} no tiene 5 cifras.`,
    );
  }
  const expected = provinceName(postalCode.slice(0, 2));
  if (expected === null) {
    return systemFinding(
      "rule",
      check,
      "fail",
      `El código postal ${postalCode} no corresponde a ninguna provincia (prefijo 01–52).`,
    );
  }
  const declared = provinceCode(province);
  if (declared === null) {
    return systemFinding(
      "rule",
      check,
      "unknown",
      `No se reconoce la provincia «${province}».`,
    );
  }
  return declared === postalCode.slice(0, 2)
    ? systemFinding(
        "rule",
        check,
        "pass",
        `El código postal ${postalCode} corresponde a ${expected}.`,
      )
    : systemFinding(
        "rule",
        check,
        "fail",
        `Regla CP↔provincia: el código postal ${postalCode} es de ${expected}, pero la provincia declarada es «${province}».`,
      );
}

const TEXT_CHECKS: Record<
  TextSignalKind,
  { certainty: SystemFinding["certainty"]; rule: string; clean: string }
> = {
  off_platform_payment: {
    certainty: "rule",
    rule: "Regla de pago fuera de la plataforma: el texto pide pagar por un canal externo",
    clean: "Los textos no piden pagar fuera de la plataforma.",
  },
  external_ticketing_link: {
    certainty: "heuristic",
    rule: "El texto enlaza a otra ticketera o a un acortador de URL",
    clean: "Los textos no enlazan a otras ticketeras ni a acortadores.",
  },
  abusive_terms: {
    certainty: "rule",
    rule: "Regla de cláusula abusiva: niega la devolución incluso si se cancela el evento",
    clean: "Las condiciones no niegan la devolución en caso de cancelación.",
  },
  minors_alcohol: {
    certainty: "rule",
    rule: "Regla de alcohol y menores: el texto ofrece alcohol a menores de edad",
    clean: "Los textos no ofrecen alcohol a menores.",
  },
  prompt_injection: {
    certainty: "heuristic",
    rule: "El texto intenta dar instrucciones al revisor",
    clean: "Los textos no intentan dar instrucciones al revisor.",
  },
};

const FIELD_NAMES: Record<string, string> = {
  title: "el título",
  description: "la descripción",
  terms: "las condiciones",
};

function textSignals(context: EventReviewContext): SystemFinding[] {
  const { event } = context;
  const texts = [
    { field: "title", text: event.title },
    { field: "description", text: event.description ?? "" },
    { field: "terms", text: event.terms ?? "" },
    ...context.sessions.flatMap((session) =>
      session.ticketTypes.map((ticketType) => ({
        field: `ticketType:${ticketType.name}`,
        text: `${ticketType.name}\n${ticketType.description ?? ""}`,
      })),
    ),
  ];
  const signals = scanTexts(texts);

  return (Object.keys(TEXT_CHECKS) as TextSignalKind[]).map((kind) => {
    const { certainty, rule, clean } = TEXT_CHECKS[kind];
    const found = signals.filter((signal) => signal.kind === kind);
    if (found.length === 0)
      return systemFinding(certainty, kind, "pass", clean);
    const verdict = certainty === "rule" ? "fail" : "warn";
    return systemFinding(
      certainty,
      kind,
      verdict,
      `${rule}: ${describe(found)}.`,
    );
  });
}

function describe(signals: readonly TextSignal[]): string {
  return signals
    .slice(0, 3)
    .map((signal) => {
      const where = signal.field.startsWith("ticketType:")
        ? `el tipo de entrada «${signal.field.slice("ticketType:".length)}»`
        : (FIELD_NAMES[signal.field] ?? signal.field);
      return `«${signal.match}» en ${where}`;
    })
    .join("; ");
}

function vipBelowGeneral(context: EventReviewContext): SystemFinding {
  const check = "price_sanity";
  for (const session of context.sessions) {
    const paid = session.ticketTypes.filter(
      (ticketType) =>
        ticketType.kind === "standard" && ticketType.priceCents > 0,
    );
    const vip = paid.filter((ticketType) => /\bvip\b/i.test(ticketType.name));
    const general = paid.filter((ticketType) =>
      /\bgeneral\b/i.test(ticketType.name),
    );
    for (const cheap of vip) {
      const dearer = general.find(
        (ticketType) => ticketType.priceCents > cheap.priceCents,
      );
      if (dearer !== undefined) {
        return systemFinding(
          "rule",
          check,
          "fail",
          `Regla VIP↔General: «${cheap.name}» (${euros(cheap.priceCents)}) cuesta menos que «${dearer.name}» (${euros(dearer.priceCents)}).`,
        );
      }
    }
  }
  return systemFinding(
    "rule",
    check,
    "pass",
    "Ninguna entrada VIP cuesta menos que una general.",
  );
}

function serviceFee(context: EventReviewContext): SystemFinding {
  const check = "service_fee";
  // Shares compare by cross-multiplying, like the price benchmark: no float
  // decides, neither the threshold nor which ticket is worst
  // (CODING_STANDARDS). The percent is computed for the message only.
  let worst: { name: string; share: FeeShare } | null = null;
  for (const session of context.sessions) {
    for (const ticketType of session.ticketTypes) {
      if (ticketType.priceCents === 0) continue;
      const share = feeShare(
        ticketType.serviceFee ?? context.event.serviceFee,
        ticketType.priceCents,
      );
      if (share === null || !above(share, SERVICE_FEE_MAX_SHARE)) continue;
      if (worst === null || above(share, worst.share)) {
        worst = { name: ticketType.name, share };
      }
    }
  }
  if (worst === null) {
    return systemFinding(
      "heuristic",
      check,
      "pass",
      `Los gastos de gestión no superan el ${String(SERVICE_FEE_MAX_PERCENT)} % del precio.`,
    );
  }
  const percent = Math.round((100 * worst.share.fee) / worst.share.of);
  return systemFinding(
    "heuristic",
    check,
    "warn",
    `Los gastos de gestión de «${worst.name}» son el ${String(percent)} % del precio (umbral: ${String(SERVICE_FEE_MAX_PERCENT)} %).`,
  );
}

function discounts(context: EventReviewContext): SystemFinding {
  const check = "discounts";
  const worst = context.discounts
    .filter(
      (discount) =>
        discount.active &&
        discount.maxUses === null &&
        discount.percent > UNLIMITED_DISCOUNT_MAX_PERCENT,
    )
    .sort((a, b) => b.percent - a.percent)[0];
  if (worst === undefined) {
    return systemFinding(
      "heuristic",
      check,
      "pass",
      `Ningún descuento activo de más del ${String(UNLIMITED_DISCOUNT_MAX_PERCENT)} % carece de límite de usos.`,
    );
  }
  return systemFinding(
    "heuristic",
    check,
    "warn",
    `Hay un descuento activo del ${String(worst.percent)} % sin límite de usos (umbral: ${String(UNLIMITED_DISCOUNT_MAX_PERCENT)} %).`,
  );
}

/** A fee as a share of the price, `fee / of`, kept as two numbers. */
interface FeeShare {
  fee: number;
  of: number;
}

const SERVICE_FEE_MAX_SHARE: FeeShare = {
  fee: SERVICE_FEE_MAX_PERCENT,
  of: 100,
};

function feeShare(
  rule: EventReviewContext["event"]["serviceFee"],
  priceCents: number,
): FeeShare | null {
  switch (rule.type) {
    case "none":
      return null;
    case "percent":
      return { fee: rule.value, of: 100 };
    case "fixed":
      // Both in cents: the share stays a ratio of integers.
      return { fee: rule.value, of: priceCents };
  }
}

function above(a: FeeShare, b: FeeShare): boolean {
  return a.fee * b.of > b.fee * a.of;
}

function sessionDates(context: EventReviewContext, now: Date): SystemFinding[] {
  const sessions = context.sessions
    .filter((session) => session.status === "scheduled")
    .map((session) => ({
      start: Date.parse(session.startsAt),
      end: Date.parse(session.endsAt),
      // A guest list isn't sold: places left on one don't put a session on
      // sale.
      onSale: session.ticketTypes.some(
        (type) =>
          type.kind === "standard" && type.capacityTaken < type.capacity,
      ),
    }))
    .sort((a, b) => a.start - b.start);
  const reference =
    context.event.publishedAt === null
      ? now.getTime()
      : Date.parse(context.event.publishedAt);

  const overlap = sessions.findIndex(
    (session, index) =>
      index > 0 && session.start < (sessions[index - 1]?.end ?? 0),
  );
  const overlapFinding =
    overlap > 0
      ? systemFinding(
          "rule",
          "session_dates",
          "fail",
          `Regla de solape: dos sesiones del evento se solapan (la que empieza el ${madrid(sessions[overlap]?.start ?? 0)} empieza antes de que acabe la anterior).`,
        )
      : systemFinding(
          "rule",
          "session_dates",
          "pass",
          "Las sesiones no se solapan.",
        );

  const first = sessions[0];
  const last = sessions.at(-1);
  const timing: SystemFinding[] = [];
  // "Hours after publishing" only reads right for a session after it: an
  // unpublished event measures from now, and a past session there is the
  // review-time warning's below.
  if (
    first !== undefined &&
    first.start >= reference &&
    first.start - reference < IMMINENT_HOURS * HOUR_MS
  ) {
    timing.push(
      systemFinding(
        "heuristic",
        "session_timing",
        "warn",
        `La primera sesión (${madrid(first.start)}) empieza menos de ${String(IMMINENT_HOURS)} h después de publicarse.`,
      ),
    );
  }
  if (last !== undefined && last.start - reference > DISTANT_DAYS * DAY_MS) {
    timing.push(
      systemFinding(
        "heuristic",
        "session_timing",
        "warn",
        `Hay una sesión (${madrid(last.start)}) a más de ${String(DISTANT_DAYS)} días de la publicación.`,
      ),
    );
  }
  // Against the review time, not publication: a past event still in the
  // feed is for the admin to fix, so it escalates but is no fraud evidence
  // (#71). A festival halfway through stays quiet while its started days
  // have nothing left on sale.
  const startedOnSale = sessions.find(
    (session) => session.start <= now.getTime() && session.onSale,
  );
  const allPast =
    last !== undefined &&
    sessions.every((session) => session.end <= now.getTime());
  if (allPast) {
    timing.push(
      systemFinding(
        "heuristic",
        "session_timing",
        "warn",
        `Todas las sesiones ya han terminado (la última fue el ${madrid(last.start)})${startedOnSale === undefined ? "" : " y aún hay entradas a la venta"}.`,
      ),
    );
  } else if (startedOnSale !== undefined) {
    timing.push(
      systemFinding(
        "heuristic",
        "session_timing",
        "warn",
        `La sesión del ${madrid(startedOnSale.start)} ya ha empezado y aún tiene entradas a la venta.`,
      ),
    );
  }
  if (timing.length === 0) {
    timing.push(
      systemFinding(
        "heuristic",
        "session_timing",
        "pass",
        "Las sesiones no son inminentes ni lejanas, y ninguna ya celebrada sigue a la venta.",
      ),
    );
  }
  return [overlapFinding, ...timing];
}

export function euros(cents: number): string {
  return `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Dates are UTC inside; the admin reads them in Europe/Madrid (CLAUDE.md §5). */
function madrid(epochMs: number): string {
  return new Date(epochMs).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    dateStyle: "short",
    timeStyle: "short",
  });
}
