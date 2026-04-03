import type { AgentResult } from "../agents/shared.ts";
import type { MainResult } from "../main.ts";
import type { ToolState } from "../mcp/server.ts";
import { log } from "./cli.ts";
import { reportErrorToComment } from "./errorReport.ts";

export interface HandleAgentResultParams {
  result: AgentResult;
  toolState: ToolState;
  silent: boolean | undefined;
}

export async function handleAgentResult(ctx: HandleAgentResultParams): Promise<MainResult> {
  if (!ctx.result.success) {
    return {
      success: false,
      error: ctx.result.error || "Agent execution failed",
      output: ctx.result.output!,
    };
  }

  if (!ctx.toolState.wasUpdated && ctx.toolState.hadProgressComment && !ctx.silent) {
    const error = ctx.result.error || "agent completed without reporting progress";
    try {
      await reportErrorToComment({
        toolState: ctx.toolState,
        error,
        title: "Error",
      });
    } catch {}
    return {
      success: false,
      error,
      output: ctx.result.output || "",
    };
  }

  log.success("Task complete.");

  return {
    success: true,
    output: ctx.result.output || "",
  };
}
