/**
 * Builders for the eval cases' Satella fixtures. Every date is relative to
 * the run's clock (CODING_STANDARDS «Time-relative fixtures»), ids are
 * hashes of the case's seed so nothing in a subject hints at its case, and
 * every organizer and artist is invented (CLAUDE.md §5). Venues are real, so
 * the venue checks can verify them (ADR 0015), except where not existing is
 * the case's point (04, N5).
 */
import { createHash } from "node:crypto";

import type {
  Decision,
  EventReviewContext,
  OrganizerReviewContext,
  PriceBenchmark,
  PriceBenchmarkQuery,
  ReviewStatus,
  SimilarEvent,
} from "../src/satella-client/schemas.js";
import { benchmarkQuery } from "../src/checks/price-benchmark.js";
import type { BenchmarkFixture, CaseFixtures } from "../src/evals/types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A stable id that names no case: `evt_3fa94c1b2e`. */
export function stableId(prefix: string, seed: string): string {
  return `${prefix}_${hash(seed).slice(0, 10)}`;
}

function hash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/** The clock floored to the hour, so fixture times read like typed ones. */
function anchor(clock: Date): number {
  return Math.floor(clock.getTime() / HOUR_MS) * HOUR_MS;
}

const iso = (epochMs: number) => new Date(epochMs).toISOString();

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type ServiceFee = EventReviewContext["event"]["serviceFee"];

export interface TicketSpec {
  name: string;
  priceCents: number;
  capacity: number;
  taken?: number;
  description?: string;
  kind?: "standard" | "guest_list";
  serviceFee?: ServiceFee;
}

export interface SessionSpec {
  /** Hours after publishing, or an exact instant (see `madridTime`). */
  startsInHours: number | { at: number };
  durationHours?: number;
  ticketTypes: TicketSpec[];
}

export interface VenueSpec {
  name: string;
  address: string | null;
  city: string;
  province: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  sameNameOtherOrganizers?: number;
}

export interface EventSpec {
  /** Unique per case; ids and the version derive from it. */
  seed: string;
  title: string;
  description: string;
  genre: string | null;
  terms?: string | null;
  artists?: { name: string; headliner?: boolean }[];
  venue: VenueSpec;
  sessions: SessionSpec[];
  serviceFee?: ServiceFee;
  /** Hours before the clock, or an exact instant (see `madridTime`). */
  publishedHoursAgo?: number | { at: number };
  /** Hours after publishing that the organizer last edited it. */
  editedHoursAfterPublishing?: number;
  imageUrls?: string[];
  collaborators?: string[];
}

export const DEFAULT_TERMS =
  "Si el evento se cancela, se devolverá el importe de la entrada. No se admiten cambios de titular.";

export function buildEvent(
  clock: Date,
  organizerId: string,
  spec: EventSpec,
): EventReviewContext {
  const eventId = stableId("evt", spec.seed);
  const published = spec.publishedHoursAgo ?? 2;
  const publishedAt =
    typeof published === "number"
      ? anchor(clock) - published * HOUR_MS
      : published.at;
  const updatedAt =
    publishedAt + (spec.editedHoursAfterPublishing ?? 0) * HOUR_MS;
  return {
    version: `v1-${hash(`${spec.seed}:version`).slice(0, 8)}`,
    event: {
      id: eventId,
      slug: slugify(spec.title),
      title: spec.title,
      description: spec.description,
      genre: spec.genre,
      status: "published",
      terms: spec.terms === undefined ? DEFAULT_TERMS : spec.terms,
      coverUrl: `https://images.example.test/covers/${eventId}.jpg`,
      imageUrls: spec.imageUrls ?? [],
      mapImageUrls: [],
      artists: (spec.artists ?? []).map((artist, index) => ({
        name: artist.name,
        headliner: artist.headliner ?? index === 0,
        hasPhoto: true,
      })),
      collaborators: spec.collaborators ?? [],
      serviceFee: spec.serviceFee ?? { type: "fixed", value: 100 },
      serviceFeePerTicketType: spec.sessions.some((session) =>
        session.ticketTypes.some((ticket) => ticket.serviceFee !== undefined),
      ),
      publishedAt: iso(publishedAt),
      updatedAt: iso(updatedAt),
    },
    venue: {
      id: stableId("ven", spec.seed),
      ...spec.venue,
      country: "ES",
      sameNameOtherOrganizers: spec.venue.sameNameOtherOrganizers ?? 0,
    },
    sessions: spec.sessions.map((session, index) => {
      const startsAt =
        typeof session.startsInHours === "number"
          ? publishedAt + session.startsInHours * HOUR_MS
          : session.startsInHours.at;
      return {
        id: stableId("ses", `${spec.seed}:${String(index)}`),
        startsAt: iso(startsAt),
        endsAt: iso(startsAt + (session.durationHours ?? 3) * HOUR_MS),
        doorsOpenAt: iso(startsAt - HOUR_MS),
        status: "scheduled" as const,
        ticketTypes: session.ticketTypes.map((ticket, ticketIndex) => ({
          id: stableId(
            "tt",
            `${spec.seed}:${String(index)}:${String(ticketIndex)}`,
          ),
          name: ticket.name,
          description: ticket.description ?? null,
          kind: ticket.kind ?? ("standard" as const),
          priceCents: ticket.priceCents,
          capacity: ticket.capacity,
          capacityTaken: ticket.taken ?? 0,
          serviceFee: ticket.serviceFee ?? null,
        })),
      };
    }),
    discounts: [],
    moderation: { canUnpublish: false },
    organizerId,
  };
}

/**
 * The instant a Madrid wall clock shows `hh:mm`, `dayOffset` days after the
 * clock's Madrid date. For cases whose story is told in local time (case 17:
 * published at 23:00 for 09:00 the next day), whatever the clock and the DST.
 */
export function madridTime(
  clock: Date,
  dayOffset: number,
  hours: number,
  minutes = 0,
): { at: number } {
  const [year, month, day] = madridParts(clock.getTime());
  const wall = Date.UTC(year, month - 1, day + dayOffset, hours, minutes);
  // Madrid is UTC+1 or UTC+2: start from the wall time read as UTC and
  // subtract the offset Madrid has at that moment.
  const offset = (instant: number) => {
    const [y, mo, d, h, mi] = madridParts(instant);
    return (
      Date.UTC(y, mo - 1, d, h, mi) - Math.floor(instant / 60_000) * 60_000
    );
  };
  const guess = wall - offset(wall);
  return { at: wall - offset(guess) };
}

function madridParts(
  instant: number,
): [number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  return [
    part("year"),
    part("month"),
    part("day"),
    part("hour"),
    part("minute"),
  ];
}

/** Starting at 20:00 or so a few weeks out: nothing imminent, nothing far. */
export const IN_THREE_WEEKS = 21 * 24;

/**
 * A session's day as an authored web page writes it, in Europe/Madrid
 * («14 de diciembre de 2026»), so a page can announce the same date.
 */
export function pageDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface OrganizerSpec {
  seed: string;
  name: string;
  description: string | null;
  status?: OrganizerReviewContext["organizer"]["status"];
  legalName?: string | null;
  taxId?: Partial<OrganizerReviewContext["fiscal"]["taxId"]>;
  city: string;
  postalCode: string;
  createdDaysAgo?: number;
  accountAgeDays?: number;
  emailVerified?: boolean;
  otherOrganizers?: {
    status: OrganizerReviewContext["organizer"]["status"];
    createdDaysAgo: number;
  }[];
  events?: { published: number; cancelled: number; ended: number };
  unpublishedByAdmin?: number;
  contentReports?: OrganizerReviewContext["history"]["contentReports"];
  previousAgentReviews?: {
    subject: { type: "event" | "organizer"; id: string };
    decision: Decision;
    status: ReviewStatus;
    createdDaysAgo: number;
  }[];
}

export function buildOrganizer(
  clock: Date,
  spec: OrganizerSpec,
): OrganizerReviewContext {
  const now = anchor(clock);
  const createdDaysAgo = spec.createdDaysAgo ?? 400;
  const createdAt = iso(now - createdDaysAgo * DAY_MS);
  return {
    version: `org-v1-${hash(`${spec.seed}:version`).slice(0, 8)}`,
    organizer: {
      id: stableId("org", spec.seed),
      slug: slugify(spec.name),
      name: spec.name,
      status: spec.status ?? "approved",
      createdAt,
      description: spec.description,
      hasLogo: true,
      hasCover: true,
      termsAcceptedAt: createdAt,
    },
    fiscal: {
      legalName:
        spec.legalName === undefined ? `${spec.name} S.L.` : spec.legalName,
      taxId: { present: true, kind: "CIF", checksumValid: true, ...spec.taxId },
      addressPresent: true,
      city: spec.city,
      postalCode: spec.postalCode,
    },
    owner: {
      accountAgeDays: spec.accountAgeDays ?? createdDaysAgo + 30,
      emailVerified: spec.emailVerified ?? true,
      otherOrganizers: (spec.otherOrganizers ?? []).map((other) => ({
        status: other.status,
        createdAt: iso(now - other.createdDaysAgo * DAY_MS),
      })),
    },
    team: { owner: 1, manager: 1, scanner: 2 },
    history: {
      events: spec.events ?? { published: 6, cancelled: 0, ended: 5 },
      unpublishedByAdmin: spec.unpublishedByAdmin ?? 0,
      substantialChanges: 0,
      contentReports: spec.contentReports ?? [],
      previousAgentReviews: (spec.previousAgentReviews ?? []).map((review) => ({
        subject: review.subject,
        decision: review.decision,
        status: review.status,
        createdAt: iso(now - review.createdDaysAgo * DAY_MS),
      })),
    },
  };
}

/** A promoter with years of uneventful history: the default for event cases. */
export function establishedOrganizer(
  clock: Date,
  seed: string,
  name: string,
  city: string,
  postalCode: string,
): OrganizerReviewContext {
  return buildOrganizer(clock, {
    seed: `${seed}:organizer`,
    name,
    description: `Promotora de conciertos y espectáculos en ${city}.`,
    city,
    postalCode,
    createdDaysAgo: 900,
    events: { published: 14, cancelled: 0, ended: 12 },
  });
}

export const TYPICAL_BENCHMARK: PriceBenchmark = {
  sampleSize: 42,
  p10Cents: 1000,
  p50Cents: 1800,
  p90Cents: 3500,
  maxCents: 8000,
};

/**
 * The mock answers a benchmark only for the exact query, and the model
 * chooses which filters to send: register the benchmark under every subset
 * of the event's genre, province and capacity band.
 */
export function benchmarksFor(
  context: EventReviewContext,
  benchmark: PriceBenchmark = TYPICAL_BENCHMARK,
): BenchmarkFixture[] {
  // The same query the agent's price check sends, and every subset of it.
  const filters = benchmarkQuery(context);
  const keys = Object.keys(filters) as (keyof PriceBenchmarkQuery)[];
  return Array.from({ length: 2 ** keys.length }, (_, mask) => ({
    query: Object.fromEntries(
      keys
        .filter((_key, bit) => (mask & (1 << bit)) !== 0)
        .map((key) => [key, filters[key]]),
    ),
    benchmark,
  }));
}

/** The usual shape of an event case: one event, its organizer, benchmarks. */
export function eventFixtures(
  event: EventReviewContext,
  organizer: OrganizerReviewContext,
  extra: {
    similar?: SimilarEvent[];
    benchmark?: PriceBenchmark;
  } = {},
): CaseFixtures {
  return {
    event,
    organizer,
    similar: extra.similar ?? [],
    benchmarks: benchmarksFor(event, extra.benchmark),
  };
}

export function similarEvent(
  seed: string,
  spec: {
    title: string;
    startsAt: string;
    venueName: string;
    titleSimilarity: number;
    sharesVenueName: boolean;
  },
): SimilarEvent {
  const { startsAt, ...rest } = spec;
  return {
    id: stableId("evt", seed),
    slug: slugify(spec.title),
    firstSessionInWindow: startsAt,
    ...rest,
  };
}
