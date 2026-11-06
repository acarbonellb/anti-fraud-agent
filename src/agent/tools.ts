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
  /**
   * Calls with the same key in one run ask the same thing: the loop answers
   * a repeat without running it or spending the budget (#31).
   */
  repeatKey?(input: Input): string;
}

/**
 * A tool with its input and output types erased, so tools of different shapes
 * fit in one list. The erasure happens inside `bind`'s closure, after the
 * tool's own schema checked the arguments: the compiler still ties each
 * schema to its executor, and no cast is needed.
 */
export interface AnyAgentTool {
  readonly name: string;
  readonly description: string;
  readonly kind: AgentTool["kind"];
  readonly input: z.ZodType;
  bind(args: unknown): BindResult;
}

export type BindResult =
  { ok: true; call: BoundCall } | { ok: false; error: z.ZodError };

/** Arguments that passed the tool's schema, ready to run. */
export interface BoundCall {
  /** See `AgentTool.repeatKey`. */
  readonly repeatKey: string | undefined;
  run(): Promise<{ output: unknown; sources: string[] }>;
}

export function defineTool<Input, Output>(
  tool: AgentTool<Input, Output>,
): AnyAgentTool {
  return {
    name: tool.name,
    description: tool.description,
    kind: tool.kind,
    input: tool.input,
    bind(args) {
      const parsed = tool.input.safeParse(args);
      if (!parsed.success) return { ok: false, error: parsed.error };
      const input = parsed.data;
      return {
        ok: true,
        call: {
          repeatKey: tool.repeatKey?.(input),
          async run() {
            const output = await tool.execute(input);
            return { output, sources: tool.sources?.(output) ?? [] };
          },
        },
      };
    },
  };
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
