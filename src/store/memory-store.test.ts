// Runs the AgentStore contract against the in-memory store, with the
// contract's injected clock. Fakes nothing else: there is nothing below it.
import { createMemoryStore } from "./memory-store.js";
import { describeAgentStore } from "./store-contract.js";

describeAgentStore("in-memory store", (now) => ({
  store: createMemoryStore({ now }),
}));
