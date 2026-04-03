import { type } from "arktype";
import { apiFetch } from "../utils/apiFetch.ts";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

const UpdateLearningsParams = type({
  learnings: type.string.describe(
    "the FULL merged learnings as a flat bullet list. each line starts with `- `. one discrete, actionable fact per bullet. combine existing bullets from the prompt with your new discoveries. deduplicate — if an existing bullet covers the same fact, update it in place rather than adding a new one. drop bullets that are clearly wrong or no longer relevant to the current codebase. keep the list focused and concise."
  ),
});

export function UpdateLearningsTool(ctx: ToolContext) {
  return tool({
    name: "update_learnings",
    description:
      "persist operational learnings about this repository (setup steps, test commands, key conventions, patterns). ONLY call this when you have high confidence the information is correct and broadly useful for future runs — not for one-off findings or uncertain observations. format: flat bullet list (`- ` per line, one fact per bullet). pass the FULL merged list — combine existing learnings from the prompt with new discoveries. deduplicate, and drop bullets that are clearly wrong or no longer relevant to the current codebase.",
    parameters: UpdateLearningsParams,
    execute: execute(async (params) => {
      const response = await apiFetch({
        path: `/api/repo/${ctx.repo.owner}/${ctx.repo.name}/learnings`,
        method: "PATCH",
        headers: {
          authorization: `Bearer ${ctx.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          learnings: params.learnings,
          model: ctx.toolState.model,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`failed to update learnings: ${error}`);
      }

      return { success: true };
    }),
  });
}
