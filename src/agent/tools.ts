import { z } from "zod";

import type { ToolDefinition } from "../providers/types.js";

/**
 * A tool the agent can call. Its input is a Zod schema: the same schema
 * becomes the provider-neutral JSON Schema the model sees and validates the
 * arguments the model sends back (CLAUDE.md §3).
 */
export interface AgentTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  /** Web searches count against `AGENT_MAX_WEB_SEARCHES` (brief §4.2). */
  kind: "satella" | "deterministic" | "web_search" | "external";
  execute(input: Input): Promise<Output>;
  /**
   * URLs the output retrieved: the only sources a model finding may cite and
   * have the policy count (ADR 0015 point 6).
   */
  sources?(output: Output): string[];
}

/** Erases the input type so tools of different shapes fit in one list. */
export type AnyAgentTool = AgentTool<never>;

export function defineTool<Input, Output>(
  tool: AgentTool<Input, Output>,
): AnyAgentTool {
  return tool as unknown as AnyAgentTool;
}

export function toToolDefinition(tool: {
  name: string;
  description: string;
  input: z.ZodType;
}): ToolDefinition {
  const schema: Record<string, unknown> = z.toJSONSchema(tool.input, {
    target: "draft-7",
    io: "input",
  });
  // Providers want the bare schema, without the dialect marker.
  delete schema.$schema;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema,
  };
}
