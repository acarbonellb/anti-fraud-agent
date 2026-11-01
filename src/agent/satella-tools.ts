/**
 * The agent's read tools over Satella's agent API (brief §4.1, "Satella").
 * Thin on purpose: the client already validates every response.
 */
import { z } from "zod";

import type { SatellaClient } from "../satella-client/index.js";
import {
  capacityBandSchema,
  SIMILAR_MAX_WINDOW_DAYS,
} from "../satella-client/schemas.js";
import { type AnyAgentTool, defineTool } from "./tools.js";

export function satellaTools(client: SatellaClient): AnyAgentTool[] {
  return [
    defineTool({
      name: "get_organizer_context",
      description:
        "Signals about an organizer: account age, fiscal data checks, team, " +
        "past events, content reports and previous recommendations.",
      kind: "satella",
      input: z.object({ organizerId: z.string().min(1) }),
      execute: ({ organizerId }) => client.getOrganizerContext(organizerId),
    }),
    defineTool({
      name: "find_similar_events",
      description:
        "Published events of other organizers in the same province with a " +
        "similar title, near the event's dates. Use it to spot clones.",
      kind: "satella",
      input: z.object({
        eventId: z.string().min(1),
        windowDays: z
          .number()
          .int()
          .min(1)
          .max(SIMILAR_MAX_WINDOW_DAYS)
          .optional(),
      }),
      execute: ({ eventId, windowDays }) =>
        client.findSimilarEvents(
          eventId,
          windowDays === undefined ? {} : { windowDays },
        ),
    }),
    defineTool({
      name: "get_price_benchmark",
      description:
        "Price percentiles in cents of published standard tickets, by genre, " +
        "province and capacity band. Percentiles are null with fewer than 5 " +
        "prices; then maxCents means nothing either.",
      kind: "satella",
      input: z.object({
        genre: z.string().min(1).optional(),
        province: z.string().min(1).optional(),
        capacityBand: capacityBandSchema.optional(),
      }),
      execute: ({ genre, province, capacityBand }) =>
        client.getPriceBenchmark({
          ...(genre === undefined ? {} : { genre }),
          ...(province === undefined ? {} : { province }),
          ...(capacityBand === undefined ? {} : { capacityBand }),
        }),
    }),
  ];
}
