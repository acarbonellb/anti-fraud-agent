/**
 * The Satella agent API contract (`/api/agent/v1`) as Zod schemas: the single
 * source for the client, the mock server and the fixtures (CODING_STANDARDS
 * "One source for the contract"). Source of truth: brief §13 over §3.2.
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
const id = z.string().min(1);

export const decisionSchema = z.enum(["approve", "reject", "request_info"]);
export type Decision = z.infer<typeof decisionSchema>;

export const subjectSchema = z.object({
  type: z.enum(["event", "organizer"]),
  id,
});
export type Subject = z.infer<typeof subjectSchema>;

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

export const feedItemSchema = z.object({
  /** Stable event id: the agent deduplicates on it. */
  id,
  type: feedItemTypeSchema,
  subject: subjectSchema,
  occurredAt: isoDate,
  /** Only on `event.content_updated` and `organizer.profile_updated`. */
  changedFields: z.array(z.string()).optional(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const FEED_DEFAULT_LIMIT = 50;
export const FEED_MAX_LIMIT = 200;

export const feedPageSchema = z.object({
  items: z.array(feedItemSchema),
  /**
   * The last item's cursor, or the one sent when nothing is new. Null only
   * when starting from the beginning of an empty feed.
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
  /** Hash of what is reviewable; does not change with sales (§13). */
  version: z.string().min(1),
  event: z.object({
    id,
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    genre: z.string().nullable(),
    status: z.enum(["draft", "published", "cancelled", "ended"]),
    terms: z.string().nullable(),
    coverUrl: z.url().nullable(),
    imageUrls: z.array(z.url()),
    mapImageUrls: z.array(z.url()),
    artists: z.array(
      z.object({
        name: z.string(),
        headliner: z.boolean(),
        hasPhoto: z.boolean(),
      }),
    ),
    collaborators: z.array(z.string()),
    serviceFee: serviceFeeSchema,
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
      lat: z.number().min(-90).max(90).nullable(),
      lng: z.number().min(-180).max(180).nullable(),
      /** Other organizers with a venue of the same name: a "borrowed venue" signal. */
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
          kind: z.enum(["standard", "guest_list"]),
          priceCents: cents,
          capacity: z.number().int().positive(),
          /** Seats taken from capacity; refunds don't give them back. */
          capacityTaken: count,
          serviceFee: serviceFeeSchema.nullable(),
        }),
      ),
    }),
  ),
  discounts: z.array(
    z.object({
      percent: z.number().min(0).max(100),
      maxUses: z.number().int().positive().nullable(),
      active: z.boolean(),
    }),
  ),
  moderation: z.object({ canUnpublish: z.boolean() }),
  organizerId: id,
});
export type EventReviewContext = z.infer<typeof eventReviewContextSchema>;

// ── Similar events ──

export const SIMILAR_DEFAULT_WINDOW_DAYS = 7;
export const SIMILAR_MAX_WINDOW_DAYS = 60;

/** Published events of other organizers in the same province (§13). */
export const similarEventSchema = z.object({
  eventId: id,
  slug: z.string(),
  title: z.string(),
  /** First session inside the window. */
  startsAt: isoDate,
  venueName: z.string().nullable(),
  titleSimilarity: ratio,
  sameVenueName: z.boolean(),
});
export type SimilarEvent = z.infer<typeof similarEventSchema>;

export const similarEventsSchema = z.array(similarEventSchema).max(10);

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

/** Percentiles are null with fewer than 5 prices in the sample (§13). */
export const priceBenchmarkSchema = z.object({
  sampleSize: count,
  p10: cents.nullable(),
  p50: cents.nullable(),
  p90: cents.nullable(),
  max: cents.nullable(),
});
export type PriceBenchmark = z.infer<typeof priceBenchmarkSchema>;

// ── Reviews ──

export const reviewStatusSchema = z.enum([
  "pending_admin",
  "auto_resolved",
  "accepted",
  "dismissed",
  "superseded",
]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

const httpUrl = z.url({ protocol: /^https?$/ });

/** Size limits are Satella's (§13); validating here turns a 400 into a local error. */
export const createReviewRequestSchema = z.object({
  subject: subjectSchema,
  /** The `version` of the context that was reviewed. */
  subjectVersion: z.string().min(1),
  decision: decisionSchema,
  autonomy: z.enum(["auto_resolved", "escalated"]),
  confidence: ratio,
  /** In Spanish, for the admin. */
  rationale: z.string().min(1).max(4000),
  findings: z
    .array(
      z.object({
        check: z.string().min(1).max(60),
        verdict: z.enum(["pass", "warn", "fail", "unknown"]),
        detail: z.string().max(1000),
        confidence: ratio,
        sources: z
          .array(
            z.object({
              url: httpUrl,
              title: z.string().max(200).optional(),
            }),
          )
          .max(10),
      }),
    )
    .max(30),
  /** A draft only: Satella never sends it by itself. */
  infoRequest: z
    .object({
      questions: z.array(z.string().min(1).max(300)).min(1).max(10),
      draftMessageToOrganizer: z.string().max(2000),
    })
    .optional(),
  agent: z.object({
    runId: id,
    promptVersion: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
  }),
});
export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>;

export const createReviewResponseSchema = z.object({
  reviewId: id,
  status: reviewStatusSchema,
});
export type CreateReviewResponse = z.infer<typeof createReviewResponseSchema>;
