/**
 * The Satella agent API contract (`/api/agent/v1`) as Zod schemas: the single
 * source for the client, the mock server and the fixtures (CODING_STANDARDS
 * "One source for the contract").
 *
 * Source of truth: the v1 API as Satella shipped it (its ADR 0018, SAT-345),
 * which refines brief §13 in field names and shapes. Where the two differ,
 * the shipped API wins: it is what the agent talks to.
 *
 * No schema carries PII: Satella sends signals, never the personal data (D7).
 */
import { z } from "zod";

/** Dates travel as ISO 8601 in UTC; presentation in Europe/Madrid happens elsewhere. */
export const isoDate = z.iso.datetime();
/** Money in integer cents, EUR (CLAUDE.md §5). */
export const cents = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const count = z.number().int().nonnegative();
const id = z.string().min(1).max(64);

export const decisionSchema = z.enum(["approve", "reject", "request_info"]);
export type Decision = z.infer<typeof decisionSchema>;

export const subjectTypeSchema = z.enum(["event", "organizer"]);
export type SubjectType = z.infer<typeof subjectTypeSchema>;

export const subjectSchema = z.object({ type: subjectTypeSchema, id });
export type Subject = z.infer<typeof subjectSchema>;

export const reviewStatusSchema = z.enum([
  "pending_admin",
  "auto_resolved",
  "accepted",
  "dismissed",
  "superseded",
]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

// ── Feed ──

export const feedItemTypeSchema = z.enum([
  "event.published",
  "event.content_updated",
  "event.ticket_type_capacity_set",
  "event.service_fee_set",
  "event.ticket_type_service_fee_set",
  "organizer.registered",
  "organizer.profile_updated",
  "content_report.created",
  "agent_review.resolved",
]);
export type FeedItemType = z.infer<typeof feedItemTypeSchema>;

export const feedItemSchema = z.object({
  /** Stable event id: the agent deduplicates on it. */
  id,
  type: feedItemTypeSchema,
  subject: subjectSchema,
  occurredAt: isoDate,
  /** On `event.content_updated` and `organizer.profile_updated`. */
  changedFields: z.array(z.string()).optional(),
  /**
   * Before and after of the changed fields that keep a value, while Satella
   * retains the revision (90 days). Fiscal data and images only ever appear
   * in `changedFields`. Values are organizer-written: untrusted data (D9).
   */
  changes: z
    .record(z.string(), z.object({ before: z.unknown(), after: z.unknown() }))
    .optional(),
  /** On `agent_review.resolved`: the resolved recommendation. */
  reviewId: id.optional(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const FEED_DEFAULT_LIMIT = 50;
export const FEED_MAX_LIMIT = 200;

export const feedPageSchema = z.object({
  items: z.array(feedItemSchema),
  /**
   * The last item's cursor, or the one sent when nothing is new. Null when
   * starting from the beginning of an empty feed.
   */
  nextCursor: z.string().min(1).nullable(),
});
export type FeedPage = z.infer<typeof feedPageSchema>;

// ── Event review context ──

const serviceFeeSchema = z.object({
  type: z.enum(["none", "fixed", "percent"]),
  value: z.number().nonnegative(),
});

export const eventReviewContextSchema = z.object({
  /** Hash of what is reviewable; does not change with sales. */
  version: z.string().min(1).max(128),
  event: z.object({
    id,
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    genre: z.string().nullable(),
    status: z.enum(["draft", "published", "cancelled", "ended"]),
    terms: z.string().nullable(),
    coverUrl: z.string().nullable(),
    imageUrls: z.array(z.string()),
    mapImageUrls: z.array(z.string()),
    artists: z.array(
      z.object({
        name: z.string(),
        headliner: z.boolean(),
        hasPhoto: z.boolean(),
      }),
    ),
    collaborators: z.array(z.string()),
    serviceFee: serviceFeeSchema,
    /** Whether ticket types carry their own fee rule. */
    serviceFeePerTicketType: z.boolean(),
    publishedAt: isoDate.nullable(),
    updatedAt: isoDate,
  }),
  venue: z
    .object({
      id,
      name: z.string(),
      address: z.string().nullable(),
      city: z.string(),
      province: z.string(),
      postalCode: z.string().nullable(),
      country: z.string(),
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
      /** Venues of other organizers with the same folded name: a "borrowed venue" signal. */
      sameNameOtherOrganizers: count,
    })
    .nullable(),
  sessions: z.array(
    z.object({
      id,
      startsAt: isoDate,
      endsAt: isoDate,
      doorsOpenAt: isoDate.nullable(),
      status: z.enum(["scheduled", "cancelled"]),
      ticketTypes: z.array(
        z.object({
          id,
          name: z.string(),
          description: z.string().nullable(),
          kind: z.enum(["standard", "guest_list"]),
          priceCents: cents,
          capacity: z.number().int().positive(),
          /** Seats taken from capacity; refunds don't give them back. */
          capacityTaken: count,
          /** Null: inherits the event's rule. */
          serviceFee: serviceFeeSchema.nullable(),
        }),
      ),
    }),
  ),
  discounts: z.array(
    z.object({
      scope: z.enum(["event", "organizer"]),
      percent: z.number().min(0).max(100),
      maxUses: z.number().int().positive().nullable(),
      timesUsed: count,
      active: z.boolean(),
    }),
  ),
  moderation: z.object({ canUnpublish: z.boolean() }),
  organizerId: id,
});
export type EventReviewContext = z.infer<typeof eventReviewContextSchema>;

// ── Organizer review context ──

const organizerStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "suspended",
]);

export const contentReportCategorySchema = z.enum([
  "fraud",
  "illegal",
  "rights",
  "minors",
  "other",
]);

export const organizerReviewContextSchema = z.object({
  /** Changes with the profile and fiscal data, not with team or history. */
  version: z.string().min(1).max(128),
  organizer: z.object({
    id,
    slug: z.string(),
    name: z.string(),
    status: organizerStatusSchema,
    createdAt: isoDate,
    description: z.string().nullable(),
    hasLogo: z.boolean(),
    hasCover: z.boolean(),
    termsAcceptedAt: isoDate.nullable(),
  }),
  /** Signals only: never the tax id or the fiscal address. */
  fiscal: z.object({
    legalName: z.string().nullable(),
    taxId: z.object({
      present: z.boolean(),
      kind: z.enum(["NIF", "NIE", "CIF", "unknown"]),
      checksumValid: z.boolean().nullable(),
    }),
    addressPresent: z.boolean(),
    city: z.string().nullable(),
    postalCode: z.string().nullable(),
  }),
  /** No email, name or id. */
  owner: z.object({
    accountAgeDays: count,
    emailVerified: z.boolean(),
    otherOrganizers: z.array(
      z.object({ status: organizerStatusSchema, createdAt: isoDate }),
    ),
  }),
  team: z.object({ owner: count, manager: count, scanner: count }),
  history: z.object({
    events: z.object({ published: count, cancelled: count, ended: count }),
    unpublishedByAdmin: count,
    substantialChanges: count,
    contentReports: z.array(
      z.object({
        category: contentReportCategorySchema,
        status: z.enum(["pending", "actioned", "dismissed"]),
        count,
      }),
    ),
    /** The latest 20 recommendations about the organizer and its events. */
    previousAgentReviews: z
      .array(
        z.object({
          subject: subjectSchema,
          decision: decisionSchema,
          status: reviewStatusSchema,
          createdAt: isoDate,
        }),
      )
      .max(20),
  }),
});
export type OrganizerReviewContext = z.infer<
  typeof organizerReviewContextSchema
>;

// ── Similar events ──

export const SIMILAR_DEFAULT_WINDOW_DAYS = 7;
export const SIMILAR_MAX_WINDOW_DAYS = 60;

/** Published events of other organizers in the same province. */
export const similarEventSchema = z.object({
  id,
  slug: z.string(),
  title: z.string(),
  firstSessionInWindow: isoDate,
  venueName: z.string(),
  /** Trigram similarity; Satella only returns ≥ 0.3. */
  titleSimilarity: ratio,
  sharesVenueName: z.boolean(),
});
export type SimilarEvent = z.infer<typeof similarEventSchema>;

export const similarEventsPageSchema = z.object({
  items: z.array(similarEventSchema).max(10),
});

// ── Price benchmark ──

export const capacityBandSchema = z.enum([
  "lt300",
  "300to1000",
  "1000to5000",
  "gt5000",
]);
export type CapacityBand = z.infer<typeof capacityBandSchema>;

export interface PriceBenchmarkQuery {
  genre?: string;
  province?: string;
  capacityBand?: CapacityBand;
}

/**
 * Percentiles are null with fewer than 5 prices in the sample. Satella still
 * sends `maxCents` then (a known mismatch it plans to fix), so `maxCents`
 * carries no weight when `p50Cents` is null.
 */
export const priceBenchmarkSchema = z.object({
  sampleSize: count,
  p10Cents: cents.nullable(),
  p50Cents: cents.nullable(),
  p90Cents: cents.nullable(),
  maxCents: cents.nullable(),
});
export type PriceBenchmark = z.infer<typeof priceBenchmarkSchema>;

// ── Reviews ──

/** Satella only links `http(s)`. */
const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

const findingSchema = z.object({
  check: z.string().min(1).max(60),
  verdict: z.enum(["pass", "warn", "fail", "unknown"]),
  detail: z.string().max(1000),
  confidence: ratio,
  sources: z
    .array(z.object({ url: httpUrl, title: z.string().max(200) }))
    .max(10),
});
export type Finding = z.infer<typeof findingSchema>;

const infoRequestSchema = z.object({
  questions: z.array(z.string().min(1).max(300)).min(1).max(10),
  /** A draft only: Satella never sends it to the organizer by itself. */
  draft: z.string().max(2000),
});

const reviewSubjectSchema = subjectSchema.extend({
  /** The `version` of the context that was reviewed. */
  version: z.string().min(1).max(128),
});

/** Size limits are Satella's; validating here turns a 400 into a local error. */
export const createReviewRequestSchema = z.object({
  subject: reviewSubjectSchema,
  decision: decisionSchema,
  autonomy: z.enum(["auto_resolved", "escalated"]),
  confidence: ratio,
  /** In Spanish, for the admin. */
  rationale: z.string().min(1).max(4000),
  findings: z.array(findingSchema).max(30),
  infoRequest: infoRequestSchema.nullable().optional(),
  agentRunId: z.string().min(1).max(128),
  promptVersion: z.string().min(1).max(64),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
});
export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>;

/** `POST /reviews` and `GET /reviews/{id}` return the same shape. */
export const agentReviewSchema = createReviewRequestSchema.extend({
  id,
  infoRequest: infoRequestSchema.nullable(),
  status: reviewStatusSchema,
  createdAt: isoDate,
  /** Outcome and date only: never who resolved it or their note. */
  resolution: z
    .object({
      outcome: z.enum(["accepted", "dismissed"]),
      resolvedAt: isoDate,
    })
    .nullable(),
});
export type AgentReview = z.infer<typeof agentReviewSchema>;

/** Printable ASCII, 1–200 characters. */
export const idempotencyKeySchema = z.string().regex(/^[\x21-\x7E]{1,200}$/);

// ── Errors ──

/** Every error body: `{ error: { code, message } }`, message in es-ES. */
export const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
