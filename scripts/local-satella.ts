/**
 * The in-process Satella mock with its fictitious fixtures, for the scripts
 * that run on this machine (`pnpm pass --mock`, `pnpm review:local`).
 */
import {
  createSatellaClient,
  type SatellaClient,
} from "../src/satella-client/client.js";
import { fixtures } from "../src/satella-client/fixtures.js";
import { startMockSatella } from "../src/satella-client/mock-server.js";

const TOKEN = "local";

/** A Satella to review against, and how to let it go when done. */
export interface SatellaConnection {
  client: SatellaClient;
  close: () => Promise<void>;
}

export async function startLocalSatella(
  correlationId: string,
): Promise<SatellaConnection> {
  const mock = await startMockSatella({
    fixtures: {
      feed: fixtures.feed,
      events: [fixtures.eventContext],
      organizers: [fixtures.organizerContext],
      similar: { [fixtures.eventContext.event.id]: fixtures.similarEvents },
    },
    tokens: { [TOKEN]: ["agent:read", "agent:recommend"] },
  });
  return {
    client: createSatellaClient({
      baseUrl: mock.baseUrl,
      getAccessToken: () => Promise.resolve(TOKEN),
      correlationId,
    }),
    close: () => mock.close(),
  };
}
