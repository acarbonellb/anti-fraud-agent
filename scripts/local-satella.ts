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

export async function startLocalSatella(
  correlationId: string,
): Promise<{ client: SatellaClient; close: () => Promise<void> }> {
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
